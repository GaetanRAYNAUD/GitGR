//! Remotes d'un dépôt, et profil de chacun.
//!
//! Le **profil du dépôt** donne l'identité des commits ; chaque **remote** a son propre profil
//! pour la clé SSH (et, plus tard, le compte de l'API) : celui choisi à la main, sinon celui
//! que désignent les règles de remote des profils sur son URL, sinon le profil du dépôt.
//!
//! Clé par remote : une commande réseau reçoit `GIT_SSH_COMMAND="ssh -F <config générée>"`.
//! La config a un bloc `Host` par hôte de remote (`IdentityFile`, `IdentitiesOnly yes`), puis
//! inclut la configuration habituelle de l'utilisateur : `fetch --all`, pull et push prennent
//! la bonne clé, quel que soit le remote visé. Limite : deux remotes du même dépôt sur le même
//! hôte avec deux clés (il faudrait un alias d'hôte) — le premier l'emporte.
//!
//! Les règles sont aussi interprétées par l'interface (`src/lib/profiles.ts`, pour afficher le
//! profil de chaque remote) : les deux côtés partagent les mêmes cas de test
//! (`src/lib/remoteRules.cases.json`).

use crate::git::{expand_home, repo_key, run};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, OnceLock, RwLock};

// ---------------------------------------------------------------------------
// Remotes du dépôt
// ---------------------------------------------------------------------------

#[derive(Serialize, Debug, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Remote {
    pub name: String,
    /// URL de fetch (`url.<base>.insteadOf` appliqué) ; `None` si le remote n'en a pas.
    pub url: Option<String>,
    /// URL de push, quand elle diffère de celle de fetch.
    pub push_url: Option<String>,
}

/// Remotes du dépôt, dans l'ordre de `git remote` (alphabétique).
pub fn list(path: &Path) -> Vec<Remote> {
    run(Some(path), &["remote", "-v"]).map(|out| parse_remotes(&out)).unwrap_or_default()
}

/// Sortie de `git remote -v` : `nom<TAB>url (fetch)` puis `nom<TAB>url (push)`, parfois suivis
/// d'un filtre (` [blob:none]` pour un clone partiel).
fn parse_remotes(out: &str) -> Vec<Remote> {
    let mut remotes: Vec<Remote> = Vec::new();
    for line in out.lines() {
        let (name, rest) = line.split_once('\t').unwrap_or((line, ""));
        if name.is_empty() {
            continue;
        }
        let index = remotes.iter().position(|r| r.name == name).unwrap_or_else(|| {
            remotes.push(Remote { name: name.to_string(), ..Default::default() });
            remotes.len() - 1
        });
        let remote = &mut remotes[index];
        if let Some(end) = rest.rfind(" (fetch)") {
            remote.url = Some(rest[..end].to_string());
        } else if let Some(end) = rest.rfind(" (push)") {
            let url = &rest[..end];
            if remote.push_url.is_none() && remote.url.as_deref() != Some(url) {
                remote.push_url = Some(url.to_string());
            }
        }
    }
    remotes
}

// ---------------------------------------------------------------------------
// Gérer les remotes (ajouter, renommer, changer l'URL, supprimer)
// ---------------------------------------------------------------------------

/// Nom de remote acceptable : un nom de ref valide, jamais pris pour une option.
fn check_name(path: &Path, name: &str) -> Result<(), String> {
    let plain = !name.is_empty() && !name.starts_with('-') && name.trim() == name && !name.contains(char::is_whitespace);
    if !plain || run(Some(path), &["check-ref-format", &format!("refs/remotes/{name}/x")]).is_err() {
        return Err("invalid_remote_name".into());
    }
    Ok(())
}

/// URL (ou chemin) non vide, sur une ligne, jamais prise pour une option.
fn check_url(url: &str) -> Result<(), String> {
    if url.is_empty() || url.starts_with('-') || url.trim() != url || url.contains(['\n', '\r']) {
        return Err("invalid_remote_url".into());
    }
    Ok(())
}

fn exists(path: &Path, name: &str) -> bool {
    list(path).iter().any(|r| r.name == name)
}

fn check_exists(path: &Path, name: &str) -> Result<(), String> {
    if exists(path, name) { Ok(()) } else { Err("remote_not_found".into()) }
}

/// Erreurs de `git remote …` : codes connus, sinon le message de git.
fn classify(e: String) -> String {
    crate::git::classify_error(&e).map(str::to_string).unwrap_or(e)
}

pub fn add(path: &Path, name: &str, url: &str) -> Result<(), String> {
    crate::history::check_dir(path)?;
    check_name(path, name)?;
    check_url(url)?;
    if exists(path, name) {
        return Err("remote_exists".into());
    }
    run(Some(path), &["remote", "add", "--", name, url]).map(|_| ()).map_err(classify)
}

/// Renomme un remote ; ses branches distantes et le suivi des branches locales le suivent.
pub fn rename(path: &Path, old: &str, new: &str) -> Result<(), String> {
    crate::history::check_dir(path)?;
    check_exists(path, old)?;
    check_name(path, new)?;
    if old == new {
        return Ok(());
    }
    if exists(path, new) {
        return Err("remote_exists".into());
    }
    run(Some(path), &["remote", "rename", "--", old, new]).map(|_| ()).map_err(classify)
}

/// Change l'URL d'un remote. Une URL de push distincte (`pushurl`), réglée à la main, n'est pas
/// touchée : sans elle, la nouvelle URL sert aussi au push.
pub fn set_url(path: &Path, name: &str, url: &str) -> Result<(), String> {
    crate::history::check_dir(path)?;
    check_exists(path, name)?;
    check_url(url)?;
    run(Some(path), &["remote", "set-url", "--", name, url]).map(|_| ()).map_err(classify)
}

/// Supprime un remote, avec ses branches distantes et le suivi des branches locales.
pub fn remove(path: &Path, name: &str) -> Result<(), String> {
    crate::history::check_dir(path)?;
    check_exists(path, name)?;
    run(Some(path), &["remote", "remove", "--", name]).map(|_| ()).map_err(classify)
}

// ---------------------------------------------------------------------------
// URL d'un remote
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
pub struct RemoteUrl {
    /// Hôte tel qu'il est écrit dans l'URL : celui que git donne à ssh.
    pub raw_host: String,
    /// En minuscules, sans `www.` (comparé aux règles).
    pub host: String,
    /// Chemin sur le serveur, en minuscules, sans `/` autour ni `.git` : `mon-org/mon-depot`.
    pub path: String,
    /// La connexion passe par ssh (`ssh://…`, `git@hôte:chemin`).
    pub ssh: bool,
}

/// Hôte et chemin d'une URL de remote (`https://…`, `ssh://user@hôte:port/…`, `git@hôte:…`) ;
/// `None` pour un chemin local. Même lecture que `parseRemote` (lib/profiles.ts).
pub fn parse_url(url: &str) -> Option<RemoteUrl> {
    let url = url.trim();
    let (raw_host, path, ssh) = parse_scheme_url(url).or_else(|| parse_scp_url(url))?;
    if raw_host.eq_ignore_ascii_case("file") {
        return None;
    }
    let lower = raw_host.to_lowercase();
    let host = lower.strip_prefix("www.").unwrap_or(&lower).to_string();
    let path = path.trim_matches('/');
    let path = match path.len().checked_sub(4) {
        Some(cut) if path.is_char_boundary(cut) && path[cut..].eq_ignore_ascii_case(".git") => &path[..cut],
        _ => path,
    };
    Some(RemoteUrl { raw_host, host, path: path.to_lowercase(), ssh })
}

/// Schéma d'URL : une lettre, puis des lettres, chiffres, `+`, `.` ou `-`.
fn is_scheme(s: &str) -> bool {
    let mut chars = s.chars();
    chars.next().is_some_and(|c| c.is_ascii_alphabetic()) && chars.all(|c| c.is_ascii_alphanumeric() || "+.-".contains(c))
}

/// `schéma://[user@]hôte[:port][/chemin]` → (hôte, chemin, ssh).
fn parse_scheme_url(url: &str) -> Option<(String, String, bool)> {
    let (scheme, rest) = url.split_once("://")?;
    if !is_scheme(scheme) {
        return None;
    }
    let (authority, path) = rest.split_once('/').unwrap_or((rest, ""));
    let host_port = match authority.split_once('@') {
        Some((user, after)) if !user.is_empty() => after,
        _ => authority,
    };
    let host = match host_port.split_once(':') {
        Some((host, port)) if !port.is_empty() && port.bytes().all(|b| b.is_ascii_digit()) => host,
        Some(_) => return None,
        None => host_port,
    };
    if host.is_empty() {
        return None;
    }
    let ssh = ["ssh", "git+ssh", "ssh+git"].iter().any(|s| scheme.eq_ignore_ascii_case(s));
    Some((host.to_string(), path.to_string(), ssh))
}

/// Syntaxe scp `[user@]hôte:chemin` (hôte de 2 caractères au moins : pas `C:\…`).
fn parse_scp_url(url: &str) -> Option<(String, String, bool)> {
    let host_path = |s: &str| {
        let (host, path) = s.split_once(':')?;
        (host.chars().count() >= 2 && !host.contains(['/', '\\']) && !path.starts_with('/')).then(|| (host.to_string(), path.to_string(), true))
    };
    let after_user = url.split_once('@').filter(|(user, _)| !user.is_empty() && !user.contains(['/', '\\'])).map(|(_, rest)| rest);
    after_user.and_then(host_path).or_else(|| host_path(url))
}

// ---------------------------------------------------------------------------
// Règles de remote des profils (mêmes résultats que lib/profiles.ts)
// ---------------------------------------------------------------------------

/// Règle « dossier » (`~/work`, `C:\work`, `/srv/x`) : elle ne concerne pas les remotes.
fn rule_is_folder(rule: &str) -> bool {
    let r = rule.trim();
    let b = r.as_bytes();
    r.starts_with(['~', '/', '\\']) || (b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':') || r.contains('\\')
}

enum Tok {
    Lit(char),
    /// `*` dans un chemin : un nom quelconque, sans `/`.
    Name,
    /// `*` dans un hôte, `**` dans un chemin : n'importe quoi.
    Any,
}

/// Le texte entier correspond-il au motif ?
fn glob(tokens: &[Tok], text: &[char]) -> bool {
    match tokens.split_first() {
        None => text.is_empty(),
        Some((Tok::Lit(c), rest)) => text.first() == Some(c) && glob(rest, &text[1..]),
        Some((Tok::Name, rest)) => (0..=text.len()).take_while(|&i| i == 0 || text[i - 1] != '/').any(|i| glob(rest, &text[i..])),
        Some((Tok::Any, rest)) => (0..=text.len()).any(|i| glob(rest, &text[i..])),
    }
}

/// L'hôte correspond-il ? `*` : n'importe quelle suite de caractères (`*.exemple.fr`).
fn match_host(pattern: &str, host: &str) -> bool {
    let pattern = pattern.trim().to_lowercase();
    let pattern = pattern.strip_prefix("www.").unwrap_or(&pattern);
    if pattern.is_empty() || host.is_empty() {
        return false;
    }
    let tokens: Vec<Tok> = pattern.chars().map(|c| if c == '*' { Tok::Any } else { Tok::Lit(c) }).collect();
    glob(&tokens, &host.chars().collect::<Vec<_>>())
}

/// Le chemin (ou un de ses sous-chemins) correspond-il ? `*` : un nom quelconque (sans `/`),
/// `**` : n'importe quoi ; `/*` ou `/**` final facultatif.
fn match_path(pattern: &str, path: &str) -> bool {
    let mut p = pattern;
    while let Some(shorter) = p.strip_suffix("/**").or_else(|| p.strip_suffix("/*")) {
        p = shorter;
    }
    if p.is_empty() {
        return true;
    }
    let mut tokens = Vec::new();
    for (i, part) in p.split('/').enumerate() {
        if i > 0 {
            tokens.push(Tok::Lit('/'));
        }
        if part == "**" {
            tokens.push(Tok::Any);
        } else {
            tokens.extend(part.chars().map(|c| if c == '*' { Tok::Name } else { Tok::Lit(c) }));
        }
    }
    let text: Vec<char> = path.chars().collect();
    if glob(&tokens, &text) {
        return true;
    }
    // Sous-chemin : `mon-org` vaut pour `mon-org/depot`.
    tokens.extend([Tok::Lit('/'), Tok::Any]);
    glob(&tokens, &text)
}

/// Le remote correspond-il à cette règle ? `github.com`, `*.exemple.fr`, `github.com/mon-org/*`,
/// `https://www.github.com/mon-org`, `git@github.com:mon-org` : schéma, utilisateur, port et
/// `www.` ignorés, casse ignorée.
pub fn match_remote(rule: &str, remote: &RemoteUrl) -> bool {
    let lower = rule.trim().to_lowercase();
    let mut r = lower.as_str();
    if let Some((scheme, rest)) = r.split_once("://") {
        if is_scheme(scheme) {
            r = rest;
        }
    }
    if let Some((user, rest)) = r.split_once('@') {
        if !user.is_empty() && !user.contains('/') {
            r = rest;
        }
    }
    // `hôte:chemin` (scp) → `hôte/chemin` ; un port (`hôte:2222/…`) est retiré.
    let mut r = r.to_string();
    if let Some(colon) = r.find(['/', ':']).filter(|&i| i > 0 && r.as_bytes()[i] == b':') {
        let after = &r[colon + 1..];
        let digits = after.bytes().take_while(u8::is_ascii_digit).count();
        let rest = &after[digits..];
        r = if digits > 0 && (rest.is_empty() || rest.starts_with('/')) {
            format!("{}{}", &r[..colon], rest)
        } else {
            format!("{}/{}", &r[..colon], after)
        };
    }
    let r = r.strip_suffix(".git").unwrap_or(&r);
    let (host_pattern, path_pattern) = r.split_once('/').unwrap_or((r, ""));
    match_host(host_pattern, &remote.host) && match_path(path_pattern.trim_matches('/'), &remote.path)
}

/// Ce que la couche git sait d'un profil pour choisir la clé d'un remote.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct KeyProfile {
    pub id: String,
    pub rules: Vec<String>,
    /// Clé SSH privée (`~` accepté).
    pub ssh_key: Option<String>,
}

/// Profil que les règles de remote désignent pour cette URL : la règle la plus précise (la plus
/// longue : `github.com/mon-org` avant `github.com`), le premier profil à égalité.
fn suggest<'a>(profiles: &'a [KeyProfile], url: &RemoteUrl) -> Option<&'a KeyProfile> {
    let mut best = None;
    let mut best_score = 0;
    for p in profiles {
        // Longueur comme en JavaScript (unités UTF-16) : même classement des deux côtés.
        let score = p.rules.iter().filter(|r| !rule_is_folder(r) && match_remote(r, url)).map(|r| 1000 + r.encode_utf16().count()).max().unwrap_or(0);
        if score > best_score {
            (best, best_score) = (Some(p), score);
        }
    }
    best
}

// ---------------------------------------------------------------------------
// Profil de chaque remote
// ---------------------------------------------------------------------------

/// Profils et choix par remote, tenus à jour par `commands` (comme les identités de `git`).
#[derive(Debug, Default)]
pub struct Table {
    /// Dans l'ordre de la liste des profils.
    pub profiles: Vec<KeyProfile>,
    /// Profil choisi à la main pour un remote, par dépôt ([`repo_key`]) puis par nom de remote ;
    /// `None` : aucun profil (ssh garde sa configuration habituelle).
    pub choices: HashMap<String, HashMap<String, Option<String>>>,
}

static TABLE: LazyLock<RwLock<Table>> = LazyLock::new(Default::default);

pub fn set_table(table: Table) {
    *TABLE.write().unwrap() = table;
}

/// Clé SSH du profil d'un remote : profil choisi à la main, sinon celui que les règles
/// désignent pour son URL, sinon le profil du dépôt (`repo_profile_key`). Un profil sans clé
/// laisse ssh faire comme d'habitude.
fn remote_key<'a>(table: &'a Table, repo: &str, remote: &Remote, repo_profile_key: Option<&'a str>) -> Option<&'a str> {
    let key_of = |p: &'a KeyProfile| p.ssh_key.as_deref().map(str::trim).filter(|k| !k.is_empty());
    match table.choices.get(repo).and_then(|c| c.get(&remote.name)) {
        Some(None) => return None,
        // Profil supprimé entre-temps : comme sans choix.
        Some(Some(id)) => {
            if let Some(p) = table.profiles.iter().find(|p| &p.id == id) {
                return key_of(p);
            }
        }
        None => {}
    }
    match remote.url.as_deref().and_then(parse_url).and_then(|url| suggest(&table.profiles, &url)) {
        Some(p) => key_of(p),
        None => repo_profile_key,
    }
}

/// Hôte utilisable tel quel dans un bloc `Host` (ni motif, ni espace).
fn plain_host(host: &str) -> bool {
    !host.is_empty() && host.chars().all(|c| c.is_ascii_alphanumeric() || ".-_".contains(c))
}

/// Clé à présenter à chaque hôte ssh des remotes du dépôt (URL de fetch et de push). Un hôte
/// commun à deux remotes garde le choix du premier, même si c'est « pas de clé ».
fn host_keys(table: &Table, repo: &str, remotes: &[Remote], repo_profile_key: Option<&str>) -> Vec<(String, String)> {
    let mut hosts: Vec<(String, Option<&str>)> = Vec::new();
    for remote in remotes {
        let key = remote_key(table, repo, remote, repo_profile_key);
        for url in [&remote.url, &remote.push_url].into_iter().flatten().filter_map(|u| parse_url(u)) {
            // Tel qu'il est écrit dans l'URL : git le donne ainsi à ssh, qui compare les blocs
            // `Host` en respectant la casse.
            let host = url.raw_host;
            if url.ssh && plain_host(&host) && !hosts.iter().any(|(h, _)| *h == host) {
                hosts.push((host, key));
            }
        }
    }
    hosts
        .into_iter()
        // Un chemin qui ne s'écrit pas entre guillemets dans la config : pas de bloc.
        .filter_map(|(host, key)| Some((host, key.filter(|k| !k.contains(['"', '\n', '\r']))?.to_string())))
        .collect()
}

// ---------------------------------------------------------------------------
// Configuration ssh générée
// ---------------------------------------------------------------------------

/// Chemin d'une clé comme ssh le lit (`~` développé, `/` partout).
fn key_path(key: &str) -> String {
    expand_home(key).to_string_lossy().replace('\\', "/")
}

/// Config ssh : un bloc par hôte, puis la configuration habituelle. `-F` remplace la config de
/// l'utilisateur **et** celle du système : elles sont incluses à la suite (`Include config` :
/// relatif à `~/.ssh`, tel que ssh le résout ; un fichier absent est ignoré). Les valeurs
/// posées ici passent d'abord ; `Match all` sort du dernier bloc `Host`.
fn config_text(hosts: &[(String, String)]) -> String {
    let mut text = String::from("# Genere par GitGR : cle SSH de chaque remote du depot (profil du remote).\n# Ne pas modifier : reecrit a chaque commande reseau.\n");
    for (host, key) in hosts {
        // `%` introduit un jeton (`%h`, `%u`…) dans IdentityFile.
        let path = key_path(key).replace('%', "%%");
        text.push_str(&format!("Host {host}\n  IdentityFile \"{path}\"\n  IdentitiesOnly yes\n"));
    }
    text.push_str("Match all\n  Include config\n  Include /etc/ssh/ssh_config\n");
    text
}

static CONFIG_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Dossier des configs ssh générées (dans le dossier de config de l'app). Celles des jours
/// précédents sont retirées : une config est réécrite dès qu'elle manque.
pub fn set_config_dir(dir: PathBuf) {
    let day = std::time::Duration::from_secs(24 * 3600);
    for entry in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
        let old = entry.metadata().and_then(|m| m.modified()).is_ok_and(|t| t.elapsed().is_ok_and(|age| age > day));
        if old && entry.file_name().to_string_lossy().starts_with("config-") {
            let _ = std::fs::remove_file(entry.path());
        }
    }
    let _ = CONFIG_DIR.set(dir);
}

fn config_dir() -> PathBuf {
    CONFIG_DIR.get().cloned().unwrap_or_else(|| std::env::temp_dir().join("gitgr-ssh"))
}

/// Écrit la config (fichier nommé d'après son contenu : deux commandes en parallèle ne se
/// marchent pas dessus) et renvoie son chemin.
fn write_config(text: &str) -> Option<PathBuf> {
    use std::hash::{Hash, Hasher};
    use std::sync::atomic::{AtomicU64, Ordering};
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    text.hash(&mut hasher);
    let name = format!("config-{:016x}", hasher.finish());
    let dir = config_dir();
    let file = dir.join(&name);
    if std::fs::read_to_string(&file).is_ok_and(|current| current == text) {
        return Some(file);
    }
    std::fs::create_dir_all(&dir).ok()?;
    // Écrite à côté puis renommée : ssh ne lit jamais un fichier à moitié écrit.
    let tmp = dir.join(format!("{name}.{}-{}.tmp", std::process::id(), SEQ.fetch_add(1, Ordering::Relaxed)));
    std::fs::write(&tmp, text).ok()?;
    if std::fs::rename(&tmp, &file).is_err() {
        let _ = std::fs::remove_file(&tmp);
        // Renommage refusé parce qu'une autre commande vient d'écrire le même fichier.
        if !file.is_file() {
            return None;
        }
    }
    Some(file)
}

/// Ce qu'une commande réseau reçoit pour s'authentifier avec la clé de chaque remote.
#[derive(Debug, PartialEq)]
pub struct SshSetup {
    /// Valeur de `GIT_SSH_COMMAND`.
    pub command: String,
    /// Clés dont ssh peut demander la phrase de passe (askpass), chemins développés.
    pub keys: Vec<String>,
}

/// Réglage ssh d'une commande réseau lancée dans `cwd` ; `repo_profile_key` : clé du profil du
/// dépôt. `None` si aucun remote ssh n'a de clé : ssh garde sa configuration habituelle.
pub fn ssh_setup(cwd: &Path, repo_profile_key: Option<&str>) -> Option<SshSetup> {
    let fallback = repo_profile_key.map(str::trim).filter(|k| !k.is_empty());
    let has_key = |p: &KeyProfile| p.ssh_key.as_deref().is_some_and(|k| !k.trim().is_empty());
    // Aucune clé nulle part : inutile de lire les remotes.
    if fallback.is_none() && !TABLE.read().unwrap().profiles.iter().any(has_key) {
        return None;
    }
    let remotes = list(cwd);
    let hosts = host_keys(&TABLE.read().unwrap(), &repo_key(cwd), &remotes, fallback);
    if hosts.is_empty() {
        return None;
    }
    let file = write_config(&config_text(&hosts))?;
    // Interprétée par un shell (celui de Git pour Windows aussi) : chemin entre apostrophes,
    // avec des `/` (un `\` y serait un échappement).
    let path = file.to_string_lossy().replace('\\', "/").replace('\'', r"'\''");
    let mut keys: Vec<String> = Vec::new();
    for (_, key) in &hosts {
        let key = expand_home(key).to_string_lossy().to_string();
        if !keys.contains(&key) {
            keys.push(key);
        }
    }
    Some(SshSetup { command: format!("ssh -F '{path}'"), keys })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::git::tests::temp_repo;

    /// Ajoute des profils et les choix d'un dépôt à la table (les tests tournent en parallèle :
    /// la remplacer effacerait ce que les autres y ont mis).
    pub(crate) fn add_to_table(profiles: Vec<KeyProfile>, repo: &Path, choices: HashMap<String, Option<String>>) {
        let mut table = TABLE.write().unwrap();
        table.profiles.extend(profiles);
        table.choices.insert(repo_key(repo), choices);
    }

    fn profile(id: &str, rules: &[&str], key: Option<&str>) -> KeyProfile {
        KeyProfile { id: id.into(), rules: rules.iter().map(|r| r.to_string()).collect(), ssh_key: key.map(str::to_string) }
    }

    fn remote(name: &str, url: &str) -> Remote {
        Remote { name: name.into(), url: Some(url.into()), push_url: None }
    }

    #[test]
    fn parses_remote_listing() {
        let out = "client\tssh://git@gitlab.client.fr/g/r.git (fetch)\nclient\tssh://git@gitlab.client.fr/g/r.git (push)\n\
                   origin\tgit@gitlab.exemple.fr:g/r.git (fetch) [blob:none]\norigin\thttps://gitlab.exemple.fr/g/r.git (push)\nsans-url";
        assert_eq!(
            parse_remotes(out),
            [
                remote("client", "ssh://git@gitlab.client.fr/g/r.git"),
                Remote { name: "origin".into(), url: Some("git@gitlab.exemple.fr:g/r.git".into()), push_url: Some("https://gitlab.exemple.fr/g/r.git".into()) },
                Remote { name: "sans-url".into(), url: None, push_url: None },
            ]
        );
        assert_eq!(parse_remotes(""), []);
    }

    #[test]
    fn lists_remotes_of_a_repo() {
        let repo = temp_repo();
        let p = repo.path();
        assert_eq!(list(p), []);
        run(Some(p), &["remote", "add", "origin", "git@gitlab.exemple.fr:g/r.git"]).unwrap();
        run(Some(p), &["remote", "add", "client", "C:/depots/un depot.git"]).unwrap();
        run(Some(p), &["remote", "set-url", "--push", "origin", "git@gitlab.exemple.fr:g/autre.git"]).unwrap();
        assert_eq!(
            list(p),
            [
                remote("client", "C:/depots/un depot.git"),
                Remote { name: "origin".into(), url: Some("git@gitlab.exemple.fr:g/r.git".into()), push_url: Some("git@gitlab.exemple.fr:g/autre.git".into()) },
            ]
        );
    }

    #[test]
    fn add_rename_set_url_and_remove() {
        let repo = temp_repo();
        let p = repo.path();
        add(p, "origin", "git@gitlab.exemple.fr:g/r.git").unwrap();
        assert_eq!(add(p, "origin", "git@autre.fr:g/r.git").unwrap_err(), "remote_exists");
        for bad in ["", "-x", "a b", " x", "a..b", "x.lock", "a:b"] {
            assert_eq!(add(p, bad, "git@exemple.fr:r.git").unwrap_err(), "invalid_remote_name", "{bad}");
        }
        for bad in ["", "--upload-pack=x", " git@exemple.fr:r.git", "a\nb"] {
            assert_eq!(add(p, "autre", bad).unwrap_err(), "invalid_remote_url", "{bad}");
        }

        // Renommer : la branche locale suit toujours son remote.
        run(Some(p), &["config", "branch.main.remote", "origin"]).unwrap();
        run(Some(p), &["config", "branch.main.merge", "refs/heads/main"]).unwrap();
        rename(p, "origin", "entreprise").unwrap();
        assert_eq!(list(p), [remote("entreprise", "git@gitlab.exemple.fr:g/r.git")]);
        assert_eq!(run(Some(p), &["config", "branch.main.remote"]).unwrap(), "entreprise");
        rename(p, "entreprise", "entreprise").unwrap();
        add(p, "client", "C:/depots/un depot.git").unwrap();
        assert_eq!(rename(p, "client", "entreprise").unwrap_err(), "remote_exists");
        assert_eq!(rename(p, "absent", "x").unwrap_err(), "remote_not_found");

        // Nouvelle URL, pour fetch et push ; une URL de push réglée à part n'est pas touchée.
        set_url(p, "client", "ssh://git@gitlab.client.fr/g/r.git").unwrap();
        assert_eq!(list(p)[0], remote("client", "ssh://git@gitlab.client.fr/g/r.git"));
        run(Some(p), &["remote", "set-url", "--push", "client", "C:/depots/push.git"]).unwrap();
        set_url(p, "client", "ssh://git@gitlab.client.fr/g/autre.git").unwrap();
        let client = Remote { name: "client".into(), url: Some("ssh://git@gitlab.client.fr/g/autre.git".into()), push_url: Some("C:/depots/push.git".into()) };
        assert_eq!(list(p)[0], client);
        assert_eq!(set_url(p, "absent", "x").unwrap_err(), "remote_not_found");
        assert_eq!(set_url(p, "client", "-x").unwrap_err(), "invalid_remote_url");

        remove(p, "client").unwrap();
        assert_eq!(list(p).len(), 1);
        assert_eq!(remove(p, "client").unwrap_err(), "remote_not_found");
    }

    /// Cas partagés avec l'interface (lib/profiles.test.ts) : mêmes résultats des deux côtés.
    #[test]
    fn rules_match_like_the_interface() {
        let cases: serde_json::Value = serde_json::from_str(include_str!("../../src/lib/remoteRules.cases.json")).unwrap();
        let text = |v: &serde_json::Value, key: &str| v[key].as_str().map(str::to_string);

        for case in cases["parse"].as_array().unwrap() {
            let url = text(case, "url").unwrap();
            let parsed = parse_url(&url);
            match text(case, "host") {
                None => assert_eq!(parsed, None, "{url}"),
                Some(host) => {
                    let parsed = parsed.unwrap_or_else(|| panic!("{url} : URL non reconnue"));
                    assert_eq!((parsed.host, parsed.path, parsed.ssh), (host, text(case, "path").unwrap(), case["ssh"].as_bool().unwrap()), "{url}");
                }
            }
        }

        for case in cases["match"].as_array().unwrap() {
            let (rule, url) = (text(case, "rule").unwrap(), text(case, "url").unwrap());
            let matched = parse_url(&url).is_some_and(|u| match_remote(&rule, &u));
            assert_eq!(matched, case["match"].as_bool().unwrap(), "règle « {rule} » / {url}");
        }

        for case in cases["suggest"].as_array().unwrap() {
            let profiles: Vec<KeyProfile> = case["profiles"]
                .as_array()
                .unwrap()
                .iter()
                .map(|p| KeyProfile { id: text(p, "id").unwrap(), rules: p["rules"].as_array().unwrap().iter().map(|r| r.as_str().unwrap().to_string()).collect(), ssh_key: None })
                .collect();
            let url = text(case, "url").unwrap();
            let pick = parse_url(&url).and_then(|u| suggest(&profiles, &u)).map(|p| p.id.clone());
            assert_eq!(pick, text(case, "pick"), "{url}");
        }
    }

    #[test]
    fn raw_host_is_kept_for_ssh() {
        let url = parse_url("ssh://git@WWW.Exemple.fr:2222/g/r.git").unwrap();
        assert_eq!((url.raw_host.as_str(), url.host.as_str()), ("WWW.Exemple.fr", "exemple.fr"));
    }

    #[test]
    fn each_remote_gets_the_key_of_its_profile() {
        let table = Table {
            profiles: vec![
                profile("entreprise", &["gitlab.entreprise.fr"], Some("~/.ssh/entreprise")),
                profile("client", &["gitlab.client.fr", "~/work"], Some("/k/client")),
                profile("sans-cle", &["github.com/sans-cle"], None),
            ],
            choices: HashMap::from([(
                "/r".to_string(),
                HashMap::from([("force".to_string(), Some("client".to_string())), ("aucun".to_string(), None), ("disparu".to_string(), Some("supprimé".to_string()))]),
            )]),
        };
        let key = |name: &str, url: &str| remote_key(&table, "/r", &remote(name, url), Some("/k/depot"));
        // Règles sur l'URL du remote.
        assert_eq!(key("origin", "git@gitlab.entreprise.fr:g/r.git"), Some("~/.ssh/entreprise"));
        assert_eq!(key("client", "ssh://git@gitlab.client.fr/g/r.git"), Some("/k/client"));
        // Aucune règle : le profil du dépôt.
        assert_eq!(key("autre", "git@github.com:x/y.git"), Some("/k/depot"));
        assert_eq!(remote_key(&table, "/r", &remote("autre", "git@github.com:x/y.git"), None), None);
        // Le profil désigné n'a pas de clé : ssh fait comme d'habitude (pas la clé du dépôt).
        assert_eq!(key("perso", "git@github.com:sans-cle/y.git"), None);
        // Choix fait à la main : il l'emporte sur les règles ; « aucun profil » aussi.
        assert_eq!(key("force", "git@gitlab.entreprise.fr:g/r.git"), Some("/k/client"));
        assert_eq!(key("aucun", "git@gitlab.entreprise.fr:g/r.git"), None);
        // Profil choisi puis supprimé : comme sans choix.
        assert_eq!(key("disparu", "git@gitlab.entreprise.fr:g/r.git"), Some("~/.ssh/entreprise"));
        // Les choix d'un dépôt ne valent pas pour un autre.
        assert_eq!(remote_key(&table, "/autre", &remote("force", "git@gitlab.entreprise.fr:g/r.git"), None), Some("~/.ssh/entreprise"));
    }

    #[test]
    fn hosts_of_ssh_remotes_only() {
        let table = Table { profiles: vec![profile("client", &["gitlab.client.fr"], Some("/k/client"))], choices: HashMap::new() };
        let remotes = [
            remote("a", "git@gitlab.entreprise.fr:g/r.git"),
            Remote { name: "b".into(), url: Some("https://gitlab.client.fr/g/r.git".into()), push_url: Some("ssh://git@push.client.fr:2222/g/r.git".into()) },
            // Même hôte qu'un remote précédent : le premier l'emporte.
            remote("c", "ssh://git@gitlab.entreprise.fr/autre.git"),
            remote("local", "C:/depots/r.git"),
            // Jamais de motif dans un bloc `Host`.
            remote("piege", "ssh://*/x"),
        ];
        let s = |a: &str, b: &str| (a.to_string(), b.to_string());
        assert_eq!(host_keys(&table, "/r", &remotes, Some("/k/depot")), [s("gitlab.entreprise.fr", "/k/depot"), s("push.client.fr", "/k/client")]);
        assert_eq!(host_keys(&table, "/r", &remotes, None), [s("push.client.fr", "/k/client")]);
        // Sans clé pour le premier remote d'un hôte, celle d'un autre remote n'est pas prise.
        let choices = HashMap::from([("/r".to_string(), HashMap::from([("a".to_string(), None), ("c".to_string(), Some("client".to_string()))]))]);
        let table = Table { choices, ..table };
        assert_eq!(host_keys(&table, "/r", &remotes, Some("/k/depot")), [s("push.client.fr", "/k/client")]);
        // La casse de l'URL est gardée (ssh la respecte dans `Host`).
        assert_eq!(host_keys(&table, "/r", &[remote("x", "git@GitLab.Exemple.fr:g/r.git")], Some("/k/depot")), [s("GitLab.Exemple.fr", "/k/depot")]);
    }

    #[test]
    fn config_has_one_block_per_host_then_the_usual_config() {
        let hosts = [("gitlab.entreprise.fr".to_string(), r"C:\Users\A B\.ssh\100%".to_string()), ("gitlab.client.fr".to_string(), "/k/client".to_string())];
        let text = config_text(&hosts);
        let lines: Vec<&str> = text.lines().filter(|l| !l.starts_with('#')).collect();
        assert_eq!(
            lines,
            [
                "Host gitlab.entreprise.fr",
                "  IdentityFile \"C:/Users/A B/.ssh/100%%\"",
                "  IdentitiesOnly yes",
                "Host gitlab.client.fr",
                "  IdentityFile \"/k/client\"",
                "  IdentitiesOnly yes",
                "Match all",
                "  Include config",
                "  Include /etc/ssh/ssh_config",
            ]
        );
    }

    /// `ssh` du PATH ou, à défaut, celui de Git pour Windows.
    fn ssh_program() -> Option<PathBuf> {
        let works = |p: &Path| crate::git::quiet_command(p).arg("-V").output().is_ok_and(|o| o.status.success());
        [Some(PathBuf::from("ssh")), crate::git::git_for_windows_tool("ssh")].into_iter().flatten().find(|p| works(p))
    }

    #[test]
    fn ssh_reads_the_generated_config() {
        let Some(ssh) = ssh_program() else {
            eprintln!("ssh introuvable : test sauté");
            return;
        };
        let dir = tempfile::tempdir().unwrap();
        let key = dir.path().join("cle du profil");
        let hosts = [("gitlab.entreprise.fr".to_string(), key.to_string_lossy().to_string())];
        let file = dir.path().join("config");
        std::fs::write(&file, config_text(&hosts)).unwrap();
        // `-G` : ssh écrit la configuration qu'il appliquerait à cet hôte, sans se connecter.
        let effective = |host: &str| {
            let out = crate::git::quiet_command(&ssh).arg("-F").arg(&file).args(["-G", host]).output().unwrap();
            assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
            String::from_utf8_lossy(&out.stdout).to_lowercase()
        };
        let ours = effective("gitlab.entreprise.fr");
        assert!(ours.contains("identitiesonly yes"), "{ours}");
        let first_identity = ours.lines().find(|l| l.starts_with("identityfile ")).unwrap();
        assert!(first_identity.ends_with("cle du profil"), "{first_identity}");
        // Un autre hôte n'est pas concerné (ssh respecte la casse : c'en est un autre).
        let other = effective("GitLab.Entreprise.fr");
        assert!(!other.contains("cle du profil"), "{other}");
    }

    #[test]
    fn network_commands_get_the_generated_config() {
        let repo = temp_repo();
        let p = repo.path();
        let other = temp_repo();
        let id = std::process::id();
        let host = format!("gitlab-{id}.exemple.fr");
        run(Some(p), &["remote", "add", "origin", &format!("git@{host}:g/r.git")]).unwrap();
        run(Some(p), &["remote", "add", "client", &format!("ssh://git@client-{id}.exemple.fr/g/r.git")]).unwrap();
        run(Some(p), &["remote", "add", "web", "https://github.com/x/y.git"]).unwrap();
        run(Some(other.path()), &["remote", "add", "origin", "https://github.com/x/y.git"]).unwrap();
        add_to_table(
            vec![profile(&format!("entreprise-{id}"), &[&host], Some("/k/entreprise")), profile(&format!("client-{id}"), &[], Some("/k/client"))],
            p,
            HashMap::from([("client".to_string(), Some(format!("client-{id}")))]),
        );

        let setup = ssh_setup(p, Some("/k/depot")).unwrap();
        assert_eq!(setup.keys, ["/k/client", "/k/entreprise"].map(|k| expand_home(k).to_string_lossy().to_string()));
        let file = setup.command.strip_prefix("ssh -F '").and_then(|c| c.strip_suffix('\'')).unwrap();
        assert!(!file.contains('\\'), "{file}");
        let text = std::fs::read_to_string(file).unwrap();
        assert!(text.contains(&format!("Host {host}\n  IdentityFile \"{}\"", key_path("/k/entreprise"))), "{text}");
        assert!(text.contains(&format!("Host client-{id}.exemple.fr\n  IdentityFile \"{}\"", key_path("/k/client"))), "{text}");
        // Même contenu : même fichier.
        assert_eq!(ssh_setup(p, Some("/k/depot")).unwrap(), setup);
        // Un dépôt sans remote ssh : ssh garde sa configuration.
        assert_eq!(ssh_setup(other.path(), Some("/k/depot")), None);
    }
}
