//! Avatars des propriétaires de dépôts (utilisateur, organisation GitHub, groupe GitLab) :
//! devant chaque remote de la barre latérale et dans la fenêtre de clone.
//!
//! L'adresse de l'image est demandée à l'API du provider (avec le token du compte s'il y en a
//! un : un groupe privé n'est visible qu'ainsi), l'image téléchargée puis gardée en data URL
//! dans le dossier de config (`avatars/`), un jour. Le token ne part jamais vers un autre hôte
//! que celui de l'instance (les images de GitHub sont servies par `avatars.githubusercontent.com`).

use crate::providers::{agent, instance, Kind};
use base64::Engine;
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::Duration;

/// Durée de validité d'un avatar en cache.
const TTL: Duration = Duration::from_secs(24 * 3600);
/// Image au-delà de laquelle on renonce (un avatar fait quelques Ko).
const MAX_IMAGE: u64 = 512 * 1024;
/// Marque d'un propriétaire sans avatar (introuvable) : pas de nouvel essai avant un jour.
const NONE: &str = "none";

static DIR: OnceLock<PathBuf> = OnceLock::new();

/// Dossier du cache (dans le dossier de config de l'app).
pub fn set_cache_dir(dir: PathBuf) {
    let _ = DIR.set(dir);
}

/// Fichier du cache. Avec ou sans token, deux entrées : un groupe privé introuvable sans
/// compte ne doit pas le rester une fois le compte connecté.
fn cache_file(kind: Kind, url: &str, owner: &str, authed: bool) -> Option<PathBuf> {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    (kind.as_str(), url, owner.to_lowercase(), authed).hash(&mut hasher);
    Some(DIR.get()?.join(format!("{:016x}.txt", hasher.finish())))
}

fn read_cache(file: &PathBuf) -> Option<Option<String>> {
    let fresh = std::fs::metadata(file).and_then(|m| m.modified()).ok()?.elapsed().is_ok_and(|age| age < TTL);
    if !fresh {
        return None;
    }
    let text = std::fs::read_to_string(file).ok()?;
    Some((text != NONE).then_some(text))
}

fn write_cache(file: &PathBuf, value: Option<&str>) {
    if let Some(dir) = file.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(file, value.unwrap_or(NONE));
}

/// Nom de propriétaire utilisable dans un chemin d'API : `org`, `groupe/sous-groupe`.
fn valid_owner(owner: &str) -> bool {
    !owner.is_empty() && !owner.starts_with('/') && !owner.ends_with('/') && owner.split('/').all(|p| !p.is_empty() && p != "." && p != ".." && p.bytes().all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b)))
}

/// `GET` JSON sur l'API, avec le token s'il y en a un. `Ok(None)` : propriétaire introuvable.
fn api_get(kind: Kind, api: &str, path: &str, token: Option<&str>) -> Result<Option<serde_json::Value>, String> {
    let mut request = agent().get(format!("{api}{path}"));
    if let Some(token) = token.filter(|t| !t.is_empty() && t.chars().all(|c| c.is_ascii_graphic())) {
        request = crate::providers::headers(kind, request, token);
    }
    let mut response = request.call().map_err(|_| "provider_unreachable".to_string())?;
    match response.status().as_u16() {
        200..=299 => {}
        404 => return Ok(None),
        401 => return Err("token_invalid".into()),
        403 => return Err("token_forbidden".into()),
        _ => return Err("provider_error".into()),
    }
    let body = response.body_mut().with_config().limit(1024 * 1024).read_to_string().map_err(|_| "provider_unexpected".to_string())?;
    serde_json::from_str(&body).map(Some).map_err(|_| "provider_unexpected".into())
}

/// Adresse de l'avatar du propriétaire : GitHub `/users/<owner>` (utilisateur comme
/// organisation), GitLab `/namespaces/<chemin>` (groupe, sous-groupe ou utilisateur).
fn avatar_url(kind: Kind, instance_url: &str, api: &str, owner: &str, token: Option<&str>) -> Result<Option<String>, String> {
    let path = match kind {
        Kind::GitHub => format!("/users/{owner}"),
        Kind::GitLab => format!("/namespaces/{}", owner.replace('/', "%2F")),
    };
    let Some(body) = api_get(kind, api, &path, token)? else { return Ok(None) };
    let Some(url) = body["avatar_url"].as_str().map(str::trim).filter(|u| !u.is_empty()) else { return Ok(None) };
    // GitLab donne parfois un chemin relatif à l'instance (`/uploads/-/system/group/avatar/…`).
    let url = if url.starts_with('/') { format!("{instance_url}{url}") } else { url.to_string() };
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Ok(None);
    }
    // Petite taille demandée à GitHub (l'image d'origine fait 460 px).
    Ok(Some(match kind {
        Kind::GitHub => format!("{url}{}s=64", if url.contains('?') { '&' } else { '?' }),
        Kind::GitLab => url,
    }))
}

fn host_of(url: &str) -> String {
    url.split_once("://").map_or(url, |(_, rest)| rest).split(['/', '?', '#']).next().unwrap_or("").to_ascii_lowercase()
}

/// Télécharge l'image en data URL. Le token n'est joint que pour l'hôte de l'instance (avatar
/// d'un groupe d'une instance privée) ; les redirections ne sont suivies que sans token.
fn download(url: &str, instance_url: &str, kind: Kind, token: Option<&str>) -> Result<Option<String>, String> {
    let same_host = host_of(url) == host_of(instance_url);
    let response = match token.filter(|_| same_host) {
        Some(token) => crate::providers::headers(kind, agent().get(url), token).call(),
        None => ureq::Agent::config_builder()
            .timeout_global(Some(Duration::from_secs(20)))
            .http_status_as_error(false)
            .tls_config(ureq::tls::TlsConfig::builder().root_certs(ureq::tls::RootCerts::PlatformVerifier).build())
            .user_agent(concat!("GitGR/", env!("CARGO_PKG_VERSION")))
            .build()
            .new_agent()
            .get(url)
            .call(),
    };
    let mut response = response.map_err(|_| "provider_unreachable".to_string())?;
    if !response.status().is_success() {
        return Ok(None);
    }
    let mime = response.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("").split(';').next().unwrap_or("").trim().to_ascii_lowercase();
    if !mime.starts_with("image/") || mime.contains("svg") {
        // Une image SVG pourrait porter du script : écartée.
        return Ok(None);
    }
    let bytes = response.body_mut().with_config().limit(MAX_IMAGE).read_to_vec().map_err(|_| "provider_unexpected".to_string())?;
    Ok(Some(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes))))
}

/// Avatar du propriétaire `owner` sur l'instance `url` du provider `kind`, en data URL ;
/// `None` s'il n'en a pas. `token` : celui du compte qui voit ce propriétaire, s'il y en a un.
pub fn owner_avatar(kind: &str, url: &str, owner: &str, token: Option<&str>) -> Result<Option<String>, String> {
    let kind = Kind::parse(kind)?;
    let inst = instance(kind, url)?;
    if !valid_owner(owner) {
        return Ok(None);
    }
    let file = cache_file(kind, &inst.url, owner, token.is_some());
    if let Some(cached) = file.as_ref().and_then(read_cache) {
        return Ok(cached);
    }
    let found = match avatar_url(kind, &inst.url, &inst.api, owner, token)? {
        Some(image) => download(&image, &inst.url, kind, token)?,
        None => None,
    };
    // Seuls un avatar trouvé et un propriétaire introuvable sont gardés : une erreur (réseau,
    // token) sera réessayée.
    if let Some(file) = &file {
        write_cache(file, found.as_deref());
    }
    Ok(found)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::tests::serve;

    #[test]
    fn owner_names() {
        for ok in ["octo", "WikiForge-fr", "groupe/sous.groupe", "a_b"] {
            assert!(valid_owner(ok), "{ok}");
        }
        for bad in ["", "/x", "x/", "a//b", "..", "a/../b", "a b", "a?b", "a%2Fb"] {
            assert!(!valid_owner(bad), "{bad}");
        }
    }

    #[test]
    fn github_avatar_url_is_resized() {
        let (url, requests) = serve(vec![(200, r#"{"login":"octo","avatar_url":"https://avatars.githubusercontent.com/u/1?v=4"}"#)]);
        let got = avatar_url(Kind::GitHub, &url, &format!("{url}/api/v3"), "octo", None).unwrap();
        assert_eq!(got.as_deref(), Some("https://avatars.githubusercontent.com/u/1?v=4&s=64"));
        let request = requests.recv().unwrap().to_lowercase();
        assert!(request.starts_with("get /api/v3/users/octo "), "{request}");
        // Sans compte : aucun token envoyé.
        assert!(!request.contains("authorization"), "{request}");
    }

    #[test]
    fn gitlab_namespace_avatar_can_be_relative() {
        let (url, requests) = serve(vec![(200, r#"{"full_path":"groupe/sous","avatar_url":"/uploads/-/system/group/avatar/7/a.png"}"#)]);
        let got = avatar_url(Kind::GitLab, &url, &format!("{url}/api/v4"), "groupe/sous", Some("glpat-x")).unwrap();
        assert_eq!(got, Some(format!("{url}/uploads/-/system/group/avatar/7/a.png")));
        let request = requests.recv().unwrap();
        assert!(request.starts_with("GET /api/v4/namespaces/groupe%2Fsous "), "{request}");
        assert!(request.to_lowercase().contains("authorization: bearer glpat-x"), "{request}");
    }

    #[test]
    fn unknown_owner_has_no_avatar() {
        let (url, _r) = serve(vec![(404, r#"{"message":"Not Found"}"#), (200, r#"{"avatar_url":null}"#)]);
        assert_eq!(avatar_url(Kind::GitHub, &url, &url, "absent", None).unwrap(), None);
        assert_eq!(avatar_url(Kind::GitLab, &url, &url, "moi", None).unwrap(), None);
    }

    #[test]
    fn hosts_are_compared_without_scheme_or_path() {
        assert_eq!(host_of("https://GitLab.exemple.fr:8443/uploads/x.png"), "gitlab.exemple.fr:8443");
        assert_eq!(host_of("https://avatars.githubusercontent.com/u/1?v=4"), "avatars.githubusercontent.com");
        assert_ne!(host_of("https://avatars.githubusercontent.com/u/1"), host_of("https://github.com"));
    }
}
