//! Comptes providers : GitHub (github.com, GitHub Enterprise) et GitLab (gitlab.com, instances
//! self-hosted), connectés par **token personnel**.
//!
//! Un compte est lié à un profil (`store::Profile::accounts`) : dans un dépôt, chaque remote
//! utilise le compte de son propre profil dont l'instance est celle du remote. Le token est
//! rangé dans le trousseau de l'OS (`secrets`), jamais dans `state.json`.
//!
//! L'adresse d'instance est aussi lue par l'interface (`src/lib/providers.ts`, pour ouvrir la
//! page de création du token) : les deux côtés partagent les mêmes cas de test
//! (`src/lib/providerUrls.cases.json`).

use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Kind {
    GitHub,
    GitLab,
}

impl Kind {
    pub fn parse(kind: &str) -> Result<Self, String> {
        match kind {
            "github" => Ok(Self::GitHub),
            "gitlab" => Ok(Self::GitLab),
            _ => Err("unknown_provider".into()),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::GitHub => "github",
            Self::GitLab => "gitlab",
        }
    }
}

/// Un compte connecté. Le token n'est pas ici : il est dans le trousseau, sous `id`.
#[derive(Serialize, Deserialize, Clone, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Account {
    /// `<kind>|<url>|<login>` : le même compte lié à deux profils n'a qu'un token.
    pub id: String,
    /// "github" | "gitlab"
    pub kind: String,
    /// Adresse de l'instance (`https://github.com`, `https://gitlab.exemple.fr`).
    pub url: String,
    pub login: String,
    /// Nom affiché sur le provider, s'il est renseigné.
    pub name: Option<String>,
}

pub fn account_id(kind: Kind, url: &str, login: &str) -> String {
    format!("{}|{url}|{}", kind.as_str(), login.to_lowercase())
}

// ---------------------------------------------------------------------------
// Adresse de l'instance
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
pub struct Instance {
    /// Adresse de l'instance, sans `/` final (`https://gitlab.exemple.fr`).
    pub url: String,
    /// Racine de son API REST.
    pub api: String,
}

/// Lit l'adresse saisie : vide → github.com / gitlab.com ; `hôte`, `hôte:port`, `hôte/chemin`
/// (GitLab sous un sous-chemin) ou une URL `http(s)://…`. Sans schéma : https. Même lecture que
/// `instance` (lib/providers.ts).
pub fn instance(kind: Kind, input: &str) -> Result<Instance, String> {
    let invalid = || "invalid_instance_url".to_string();
    let input = input.trim();
    if input.is_empty() {
        return Ok(match kind {
            Kind::GitHub => Instance { url: "https://github.com".into(), api: "https://api.github.com".into() },
            Kind::GitLab => Instance { url: "https://gitlab.com".into(), api: "https://gitlab.com/api/v4".into() },
        });
    }
    // ASCII imprimable seulement (ni blanc, ni caractère de contrôle, ni accent).
    if input.contains(|c: char| !c.is_ascii_graphic() || "?#@\\".contains(c)) {
        return Err(invalid());
    }
    let (scheme, rest) = match input.split_once("://") {
        Some((scheme, rest)) => (scheme.to_ascii_lowercase(), rest),
        None => ("https".to_string(), input),
    };
    if scheme != "http" && scheme != "https" {
        return Err(invalid());
    }
    let (authority, path) = rest.split_once('/').unwrap_or((rest, ""));
    let authority = authority.to_ascii_lowercase();
    let (host, port) = match authority.split_once(':') {
        Some((host, port)) => (host, Some(port)),
        None => (authority.as_str(), None),
    };
    let host_ok = !host.is_empty() && host.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-');
    let port_ok = port.is_none_or(|p| !p.is_empty() && p.len() <= 5 && p.bytes().all(|b| b.is_ascii_digit()));
    if !host_ok || !port_ok {
        return Err(invalid());
    }
    let mut host = host.strip_prefix("www.").unwrap_or(host);
    if kind == Kind::GitHub && host == "api.github.com" {
        host = "github.com";
    }
    if host.is_empty() {
        return Err(invalid());
    }
    let authority = match port {
        Some(port) => format!("{host}:{port}"),
        None => host.to_string(),
    };
    // GitHub Enterprise n'est jamais sous un sous-chemin : un chemin collé avec l'adresse
    // (`github.com/moi`) est ignoré.
    let path = if kind == Kind::GitHub { "" } else { path.trim_matches('/') };
    let url = if path.is_empty() { format!("{scheme}://{authority}") } else { format!("{scheme}://{authority}/{path}") };
    let api = match kind {
        Kind::GitHub if authority == "github.com" => "https://api.github.com".to_string(),
        Kind::GitHub => format!("{url}/api/v3"),
        Kind::GitLab => format!("{url}/api/v4"),
    };
    Ok(Instance { url, api })
}

// ---------------------------------------------------------------------------
// Appels à l'API
// ---------------------------------------------------------------------------

/// Réponses lues en entier : au-delà, ce n'est pas l'API attendue.
const MAX_BODY: u64 = 1024 * 1024;

fn agent() -> ureq::Agent {
    use ureq::tls::{RootCerts, TlsConfig};
    ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(20)))
        // Les codes d'erreur sont lus ici (401 : token refusé…).
        .http_status_as_error(false)
        // Jamais de redirection suivie : le token ne part que vers l'adresse saisie.
        .max_redirects(0)
        .max_redirects_will_error(false)
        // Certificats du système : une instance d'entreprise signée par une autorité interne
        // est acceptée si l'OS lui fait confiance.
        .tls_config(TlsConfig::builder().root_certs(RootCerts::PlatformVerifier).build())
        .user_agent(concat!("GitGR/", env!("CARGO_PKG_VERSION")))
        .build()
        .into()
}

/// Token utilisable dans un en-tête : non vide, sans blanc ni caractère de contrôle.
fn check_token(token: &str) -> Result<(), String> {
    if token.is_empty() || !token.chars().all(|c| c.is_ascii_graphic()) {
        return Err("token_invalid".into());
    }
    Ok(())
}

/// `GET <api><path>` authentifié ; renvoie le JSON de la réponse.
fn get(kind: Kind, api: &str, path: &str, token: &str) -> Result<serde_json::Value, String> {
    get_limited(kind, api, path, token, MAX_BODY)
}

fn get_limited(kind: Kind, api: &str, path: &str, token: &str, limit: u64) -> Result<serde_json::Value, String> {
    check_token(token)?;
    let mut request = agent().get(format!("{api}{path}")).header("Authorization", format!("Bearer {token}"));
    request = match kind {
        Kind::GitHub => request.header("Accept", "application/vnd.github+json").header("X-GitHub-Api-Version", "2022-11-28"),
        Kind::GitLab => request.header("Accept", "application/json"),
    };
    let mut response = request.call().map_err(|_| "provider_unreachable".to_string())?;
    match response.status().as_u16() {
        200..=299 => {}
        401 => return Err("token_invalid".into()),
        403 => return Err("token_forbidden".into()),
        // Redirection ou page absente : ce n'est pas l'API de ce provider à cette adresse.
        300..=399 | 404 => return Err("provider_not_found".into()),
        _ => return Err("provider_error".into()),
    }
    let body = response.body_mut().with_config().limit(limit).read_to_string().map_err(|_| "provider_unexpected".to_string())?;
    serde_json::from_str(&body).map_err(|_| "provider_unexpected".into())
}

/// Utilisateur du token : (login, nom affiché).
fn fetch_user(kind: Kind, api: &str, token: &str) -> Result<(String, Option<String>), String> {
    let user = get(kind, api, "/user", token)?;
    let text = |key: &str| user[key].as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
    let login = text(match kind {
        Kind::GitHub => "login",
        Kind::GitLab => "username",
    })
    .ok_or("provider_unexpected")?;
    Ok((login, text("name")))
}

/// Vérifie le token auprès de l'instance, sans rien enregistrer.
fn verify(kind: Kind, input: &str, token: &str) -> Result<Account, String> {
    let instance = instance(kind, input)?;
    let (login, name) = fetch_user(kind, &instance.api, token.trim())?;
    Ok(Account { id: account_id(kind, &instance.url, &login), kind: kind.as_str().into(), url: instance.url, login, name })
}

/// Connecte un compte : le token est vérifié (il donne le compte), puis rangé dans le trousseau.
pub fn connect(kind: &str, url: &str, token: &str) -> Result<Account, String> {
    let account = verify(Kind::parse(kind)?, url, token)?;
    crate::secrets::set_token(&account.id, token.trim())?;
    Ok(account)
}

/// Le token enregistré ouvre-t-il encore ce compte ? Renvoie le compte, nom à jour.
/// `token_missing` : plus de token dans le trousseau ; `token_invalid` : refusé, ou devenu
/// celui d'un autre compte.
pub fn check(account: &Account) -> Result<Account, String> {
    let token = crate::secrets::token(&account.id).ok_or("token_missing")?;
    let fresh = verify(Kind::parse(&account.kind)?, &account.url, &token)?;
    if fresh.id != account.id {
        return Err("token_invalid".into());
    }
    Ok(fresh)
}

// ---------------------------------------------------------------------------
// Dépôts d'un compte (à cloner)
// ---------------------------------------------------------------------------

/// Un dépôt du compte, tel que la fenêtre de clone le liste.
#[derive(Serialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProviderRepo {
    /// `propriétaire/nom` (GitLab : avec les sous-groupes).
    pub full_name: String,
    pub name: String,
    pub description: Option<String>,
    pub private: bool,
    pub fork: bool,
    pub archived: bool,
    pub http_url: String,
    pub ssh_url: Option<String>,
    /// Dernière activité (ISO 8601).
    pub updated_at: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct RepoList {
    pub repos: Vec<ProviderRepo>,
    /// Plus de dépôts que ceux lus (limite de pages atteinte).
    pub truncated: bool,
}

/// Dépôts par page (maximum des deux API), et pages lues au plus.
const PER_PAGE: usize = 100;
const MAX_PAGES: usize = 10;
/// Une page de 100 dépôts GitLab complets dépasse le Mo.
const MAX_LIST_BODY: u64 = 16 * 1024 * 1024;

fn parse_repo(kind: Kind, v: &serde_json::Value) -> Option<ProviderRepo> {
    let text = |key: &str| v[key].as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
    let repo = match kind {
        Kind::GitHub => ProviderRepo {
            full_name: text("full_name")?,
            name: text("name")?,
            description: text("description"),
            private: v["private"].as_bool().unwrap_or(false),
            fork: v["fork"].as_bool().unwrap_or(false),
            archived: v["archived"].as_bool().unwrap_or(false),
            http_url: text("clone_url")?,
            ssh_url: text("ssh_url"),
            updated_at: text("pushed_at").or_else(|| text("updated_at")),
        },
        Kind::GitLab => ProviderRepo {
            full_name: text("path_with_namespace")?,
            name: text("name")?,
            description: text("description"),
            private: text("visibility").is_some_and(|vis| vis != "public"),
            fork: v["forked_from_project"].is_object(),
            archived: v["archived"].as_bool().unwrap_or(false),
            http_url: text("http_url_to_repo")?,
            ssh_url: text("ssh_url_to_repo"),
            updated_at: text("last_activity_at"),
        },
    };
    Some(repo)
}

/// Dépôts accessibles au compte (les siens, ceux de ses organisations / groupes, ceux où il
/// collabore), les plus récemment actifs d'abord ; `MAX_PAGES` pages au plus.
fn list_repos_with(kind: Kind, api: &str, token: &str) -> Result<RepoList, String> {
    let mut list = RepoList::default();
    for page in 1..=MAX_PAGES {
        let path = match kind {
            Kind::GitHub => format!("/user/repos?per_page={PER_PAGE}&page={page}&sort=pushed&affiliation=owner,collaborator,organization_member"),
            Kind::GitLab => format!("/projects?membership=true&per_page={PER_PAGE}&page={page}&order_by=last_activity_at&sort=desc"),
        };
        let body = get_limited(kind, api, &path, token, MAX_LIST_BODY)?;
        let items = body.as_array().ok_or("provider_unexpected")?;
        list.repos.extend(items.iter().filter_map(|v| parse_repo(kind, v)));
        if items.len() < PER_PAGE {
            return Ok(list);
        }
    }
    list.truncated = true;
    Ok(list)
}

/// Dépôts du compte, avec son token du trousseau.
pub fn list_repos(account: &Account) -> Result<RepoList, String> {
    let token = crate::secrets::token(&account.id).ok_or("token_missing")?;
    let kind = Kind::parse(&account.kind)?;
    let instance = instance(kind, &account.url)?;
    list_repos_with(kind, &instance.api, &token)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::mpsc::{Receiver, channel};

    /// Faux provider : répond aux requêtes, dans l'ordre, par ces (code, corps) ; renvoie son
    /// adresse (`http://127.0.0.1:port`) et les requêtes reçues (ligne de requête et en-têtes).
    pub(crate) fn serve(responses: Vec<(u16, &'static str)>) -> (String, Receiver<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let (tx, rx) = channel();
        std::thread::spawn(move || {
            for (status, body) in responses {
                let Ok((mut stream, _)) = listener.accept() else { return };
                let mut request = Vec::new();
                let mut buf = [0u8; 1024];
                while !request.windows(4).any(|w| w == b"\r\n\r\n") {
                    match stream.read(&mut buf) {
                        Ok(n) if n > 0 => request.extend_from_slice(&buf[..n]),
                        _ => break,
                    }
                }
                let _ = tx.send(String::from_utf8_lossy(&request).to_string());
                let head = format!("HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
                let _ = stream.write_all(head.as_bytes());
                let _ = stream.write_all(body.as_bytes());
            }
        });
        (url, rx)
    }

    /// Cas partagés avec l'interface (lib/providers.test.ts) : mêmes résultats des deux côtés.
    #[test]
    fn instances_are_read_like_the_interface() {
        let cases: serde_json::Value = serde_json::from_str(include_str!("../../src/lib/providerUrls.cases.json")).unwrap();
        for case in cases["cases"].as_array().unwrap() {
            let kind = Kind::parse(case["kind"].as_str().unwrap()).unwrap();
            let input = case["input"].as_str().unwrap();
            let got = instance(kind, input);
            match case["url"].as_str() {
                None => assert_eq!(got, Err("invalid_instance_url".to_string()), "« {input} »"),
                Some(url) => assert_eq!(got, Ok(Instance { url: url.into(), api: case["api"].as_str().unwrap().into() }), "« {input} »"),
            }
        }
    }

    #[test]
    fn unknown_provider_is_refused() {
        assert_eq!(Kind::parse("bitbucket"), Err("unknown_provider".to_string()));
        assert_eq!(connect("bitbucket", "", "x"), Err("unknown_provider".to_string()));
    }

    #[test]
    fn github_token_gives_the_account() {
        let (url, requests) = serve(vec![(200, r#"{"login":"Octo-Demo","name":"Octo Démo","id":1}"#)]);
        let account = verify(Kind::GitHub, &url, " ghp_abc123 ").unwrap();
        assert_eq!(account, Account { id: format!("github|{url}|octo-demo"), kind: "github".into(), url: url.clone(), login: "Octo-Demo".into(), name: Some("Octo Démo".into()) });
        let request = requests.recv().unwrap().to_lowercase();
        // GitHub Enterprise : API sous /api/v3 ; token en en-tête, jamais dans l'URL.
        assert!(request.starts_with("get /api/v3/user http/1.1"), "{request}");
        assert!(request.contains("authorization: bearer ghp_abc123\r\n"), "{request}");
        assert!(request.contains("user-agent: gitgr/"), "{request}");
        assert!(request.contains("x-github-api-version: 2022-11-28"), "{request}");
    }

    #[test]
    fn gitlab_token_gives_the_account() {
        let (url, requests) = serve(vec![(200, r#"{"id":7,"username":"camille","name":""}"#)]);
        let account = verify(Kind::GitLab, &format!("{url}/"), "glpat-xyz").unwrap();
        assert_eq!(account, Account { id: format!("gitlab|{url}|camille"), kind: "gitlab".into(), url: url.clone(), login: "camille".into(), name: None });
        let request = requests.recv().unwrap().to_lowercase();
        assert!(request.starts_with("get /api/v4/user http/1.1"), "{request}");
        assert!(request.contains("authorization: bearer glpat-xyz\r\n"), "{request}");
    }

    #[test]
    fn refusals_are_classified() {
        let answer = |status: u16, body: &'static str| {
            let (url, _requests) = serve(vec![(status, body)]);
            verify(Kind::GitLab, &url, "glpat-xyz").unwrap_err()
        };
        assert_eq!(answer(401, r#"{"message":"401 Unauthorized"}"#), "token_invalid");
        assert_eq!(answer(403, r#"{"message":"403 Forbidden"}"#), "token_forbidden");
        assert_eq!(answer(404, "<html>introuvable</html>"), "provider_not_found");
        // Redirection (page de connexion d'un autre site) : jamais suivie.
        assert_eq!(answer(302, ""), "provider_not_found");
        assert_eq!(answer(500, "oups"), "provider_error");
        // Une page web répond 200 à cette adresse : ce n'est pas l'API.
        assert_eq!(answer(200, "<html>bonjour</html>"), "provider_unexpected");
        assert_eq!(answer(200, r#"{"login":"compte-github"}"#), "provider_unexpected");
    }

    #[test]
    fn nothing_is_sent_for_a_bad_token_or_address() {
        // Aucun serveur n'écoute : une requête donnerait `provider_unreachable`.
        assert_eq!(verify(Kind::GitHub, "http://127.0.0.1:9", "").unwrap_err(), "token_invalid");
        assert_eq!(verify(Kind::GitHub, "http://127.0.0.1:9", "a b").unwrap_err(), "token_invalid");
        assert_eq!(verify(Kind::GitHub, "http://127.0.0.1:9", "a\r\nX-Injecte: 1").unwrap_err(), "token_invalid");
        assert_eq!(verify(Kind::GitHub, "ftp://exemple.fr", "ghp_x").unwrap_err(), "invalid_instance_url");
    }

    #[test]
    fn unreachable_server() {
        // Port fermé : on vient de le libérer.
        let port = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        assert_eq!(verify(Kind::GitLab, &format!("http://127.0.0.1:{port}"), "glpat-xyz").unwrap_err(), "provider_unreachable");
    }

    #[test]
    fn connect_stores_the_token_and_check_reads_it() {
        if !crate::secrets::tests::keyring_available() {
            eprintln!("trousseau indisponible : test sauté");
            return;
        }
        let user = r#"{"username":"camille","name":"Camille"}"#;
        let (url, _requests) = serve(vec![(200, user), (200, r#"{"username":"camille","name":"Camille D."}"#), (401, "{}"), (200, r#"{"username":"autre"}"#)]);
        let _cleanup = crate::secrets::tests::ForgetToken(format!("gitlab|{url}|camille"));
        let account = connect("gitlab", &url, "glpat-xyz").unwrap();
        assert_eq!(crate::secrets::token(&account.id).as_deref(), Some("glpat-xyz"));
        // Nom à jour ; puis token révoqué ; puis token devenu celui d'un autre compte.
        assert_eq!(check(&account).unwrap().name.as_deref(), Some("Camille D."));
        assert_eq!(check(&account).unwrap_err(), "token_invalid");
        assert_eq!(check(&account).unwrap_err(), "token_invalid");
        crate::secrets::delete_token(&account.id).unwrap();
        assert_eq!(check(&account).unwrap_err(), "token_missing");
    }

    /// Corps de réponse fabriqué à l'exécution, gardé pour toute la durée des tests.
    fn leak(s: String) -> &'static str {
        Box::leak(s.into_boxed_str())
    }

    #[test]
    fn github_repos_are_listed_page_by_page() {
        let repo = |i: usize| format!(r#"{{"full_name":"octo/r{i}","name":"r{i}","private":{},"fork":false,"archived":false,"clone_url":"https://github.com/octo/r{i}.git","ssh_url":"git@github.com:octo/r{i}.git","pushed_at":"2026-11-01T10:00:00Z","description":null}}"#, i.is_multiple_of(2));
        let page1 = leak(format!("[{}]", (0..100).map(repo).collect::<Vec<_>>().join(",")));
        let page2 = leak(format!("[{},{{\"name\":\"sans-url\"}}]", repo(100)));
        let (url, requests) = serve(vec![(200, page1), (200, page2)]);
        let list = list_repos_with(Kind::GitHub, &format!("{url}/api/v3"), "ghp_x").unwrap();
        // Une entrée incomplète est écartée ; la page 2, plus courte, est la dernière.
        assert_eq!(list.repos.len(), 101);
        assert!(!list.truncated);
        assert_eq!(
            list.repos[0],
            ProviderRepo {
                full_name: "octo/r0".into(),
                name: "r0".into(),
                description: None,
                private: true,
                fork: false,
                archived: false,
                http_url: "https://github.com/octo/r0.git".into(),
                ssh_url: Some("git@github.com:octo/r0.git".into()),
                updated_at: Some("2026-11-01T10:00:00Z".into()),
            }
        );
        let first = requests.recv().unwrap();
        assert!(first.starts_with("GET /api/v3/user/repos?per_page=100&page=1&sort=pushed"), "{first}");
        assert!(requests.recv().unwrap().starts_with("GET /api/v3/user/repos?per_page=100&page=2&"));
    }

    #[test]
    fn gitlab_projects_are_listed() {
        let body = r#"[{"path_with_namespace":"groupe/sous/projet","name":"Projet","visibility":"internal","archived":true,"forked_from_project":{"id":1},
            "http_url_to_repo":"https://gitlab.exemple.fr/groupe/sous/projet.git","ssh_url_to_repo":"git@gitlab.exemple.fr:groupe/sous/projet.git","last_activity_at":"2026-10-01T00:00:00Z","description":" Un projet "},
            {"path_with_namespace":"moi/public","name":"public","visibility":"public","http_url_to_repo":"https://gitlab.exemple.fr/moi/public.git"}]"#;
        let (url, requests) = serve(vec![(200, body)]);
        let list = list_repos_with(Kind::GitLab, &format!("{url}/api/v4"), "glpat-x").unwrap();
        assert_eq!(list.repos.len(), 2);
        let p = &list.repos[0];
        assert_eq!((p.full_name.as_str(), p.private, p.fork, p.archived, p.description.as_deref()), ("groupe/sous/projet", true, true, true, Some("Un projet")));
        assert_eq!((list.repos[1].private, list.repos[1].ssh_url.as_deref()), (false, None));
        assert!(requests.recv().unwrap().starts_with("GET /api/v4/projects?membership=true&per_page=100&page=1&order_by=last_activity_at"));
    }

    #[test]
    fn repo_list_errors() {
        let (url, _r) = serve(vec![(401, "{}")]);
        assert_eq!(list_repos_with(Kind::GitHub, &url, "ghp_x").unwrap_err(), "token_invalid");
        let (url, _r) = serve(vec![(200, r#"{"message":"pas une liste"}"#)]);
        assert_eq!(list_repos_with(Kind::GitLab, &url, "glpat-x").unwrap_err(), "provider_unexpected");
    }

    #[test]
    fn repo_list_stops_after_max_pages() {
        let page = leak(format!("[{}]", (0..100).map(|i| format!(r#"{{"full_name":"o/r{i}","name":"r{i}","clone_url":"https://h/o/r{i}.git"}}"#)).collect::<Vec<_>>().join(",")));
        let (url, _r) = serve(vec![(200, page); MAX_PAGES]);
        let list = list_repos_with(Kind::GitHub, &url, "ghp_x").unwrap();
        assert_eq!((list.repos.len(), list.truncated), (100 * MAX_PAGES, true));
    }
}
