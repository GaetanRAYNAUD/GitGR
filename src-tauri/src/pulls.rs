//! Pull requests (GitHub) et merge requests (GitLab) : création (avec assignés, relecteurs et
//! étiquettes), branche par défaut du dépôt distant, brouillon du titre / de la description tiré
//! des commits et du modèle du dépôt, et personnes / étiquettes proposées (en cache, cf.
//! [`cached_options`]).
//!
//! Le compte (et son token) est celui du profil du remote cible (cf. `providers`) ; l'interface
//! dit quel dépôt (`propriétaire/nom`) et quelles branches.

use crate::git::run;
use crate::providers::{Kind, agent, check_token, headers, send_api};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

/// Réponses lues en entier : au-delà, ce n'est pas l'API attendue.
const MAX_BODY: u64 = 4 * 1024 * 1024;

/// Encode un segment d'URL (chemin d'un projet GitLab, nom de branche dans une requête).
fn enc(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"-._~".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// Chemin d'un dépôt dans l'API : `/repos/<o>/<r>` (GitHub), `/projects/<chemin encodé>` (GitLab).
fn project(kind: Kind, repo: &str) -> String {
    match kind {
        Kind::GitHub => format!("/repos/{repo}"),
        Kind::GitLab => format!("/projects/{}", enc(repo)),
    }
}

/// Dépôt `propriétaire/nom` (GitLab : `groupe/sous-groupe/nom`) : rien d'autre ne part dans l'URL.
fn check_repo(repo: &str) -> Result<(), String> {
    let ok = repo.contains('/')
        && repo.split('/').all(|p| !p.is_empty() && p != "." && p != ".." && p.bytes().all(|b| b.is_ascii_alphanumeric() || b"-._".contains(&b)));
    if ok { Ok(()) } else { Err("pull_repo_invalid".into()) }
}

#[derive(Clone, Copy)]
enum Method<'a> {
    Get,
    Post(&'a Value),
    Patch(&'a Value),
}

/// Réponse lue : code, JSON, et nombre de pages annoncé par le provider (listes paginées :
/// en-tête `Link` `rel="last"` chez GitHub, `X-Total-Pages` chez GitLab).
struct Reply {
    status: u16,
    json: Value,
    pages: Option<usize>,
    /// Une page suivante est annoncée (`rel="next"`, `X-Next-Page`).
    more: bool,
}

/// Dernière page annoncée par l'en-tête `Link` de GitHub (`<…&page=34>; rel="last"`).
fn last_page(link: &str) -> Option<usize> {
    link.split(',').find(|l| l.contains(r#"rel="last""#)).and_then(|l| {
        let url = l.split(';').next()?.trim().trim_start_matches('<').trim_end_matches('>');
        url.split(['?', '&']).find_map(|kv| kv.strip_prefix("page=")).and_then(|n| n.parse().ok())
    })
}

/// Appel à l'API (4xx compris, à lire par l'appelant).
fn request(kind: Kind, api: &str, path: &str, token: &str, method: Method) -> Result<Reply, String> {
    check_token(token)?;
    let url = format!("{api}{path}");
    let json_body = |b: &Value| b.to_string();
    let mut response = send_api(api, Some(token), || match method {
        Method::Get => headers(kind, agent().get(&url), token).call(),
        Method::Post(b) => headers(kind, agent().post(&url), token).header("Content-Type", "application/json").send(json_body(b)),
        Method::Patch(b) => headers(kind, agent().patch(&url), token).header("Content-Type", "application/json").send(json_body(b)),
    })?;
    let status = response.status().as_u16();
    let header = |name: &str| response.headers().get(name).and_then(|v| v.to_str().ok()).map(str::to_string);
    let pages = match kind {
        Kind::GitHub => header("link").as_deref().and_then(last_page),
        Kind::GitLab => header("x-total-pages").and_then(|n| n.trim().parse().ok()),
    };
    let more = match kind {
        Kind::GitHub => header("link").is_some_and(|l| l.contains(r#"rel="next""#)),
        Kind::GitLab => header("x-next-page").is_some_and(|n| !n.trim().is_empty()),
    };
    let text = response.body_mut().with_config().limit(MAX_BODY).read_to_string().unwrap_or_default();
    match status {
        401 => Err("token_invalid".into()),
        // Redirection : jamais suivie (le token ne part que vers l'instance).
        300..=399 => Err("provider_not_found".into()),
        200..=299 => {
            // Réponse vide (204) : rien à lire.
            let json = if text.trim().is_empty() { Value::Null } else { serde_json::from_str(&text).map_err(|_| "provider_unexpected".to_string())? };
            Ok(Reply { status, json, pages, more })
        }
        _ => Ok(Reply { status, json: serde_json::from_str(&text).unwrap_or(Value::String(text)), pages, more }),
    }
}

/// Appel à l'API ; renvoie le code et le JSON de la réponse (4xx compris, à lire par l'appelant).
fn call(kind: Kind, api: &str, path: &str, token: &str, body: Option<&Value>) -> Result<(u16, Value), String> {
    let method = body.map_or(Method::Get, Method::Post);
    request(kind, api, path, token, method).map(|r| (r.status, r.json))
}

/// Erreurs communes à toutes les réponses en échec.
fn refused(status: u16) -> String {
    match status {
        // Droits du token ou du compte sur le dépôt (GitHub répond aussi 404 à un dépôt invisible).
        403 => "pull_forbidden",
        404 => "pull_repo_not_found",
        _ => "provider_error",
    }
    .into()
}

/// Texte d'une réponse d'erreur, en minuscules (messages de validation).
fn message(v: &Value) -> String {
    v.to_string().to_lowercase()
}

/// Branche par défaut du dépôt distant (cible proposée d'office).
pub fn default_branch(kind: Kind, api: &str, repo: &str, token: &str) -> Result<String, String> {
    check_repo(repo)?;
    let (status, v) = call(kind, api, &project(kind, repo), token, None)?;
    if !(200..300).contains(&status) {
        return Err(refused(status));
    }
    v["default_branch"].as_str().filter(|s| !s.is_empty()).map(str::to_string).ok_or("provider_unexpected".into())
}

/// Demande de création, telle que l'interface la remplit.
#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NewPull {
    /// Dépôt où est poussée la branche source (un fork : différent de la cible).
    pub source_repo: String,
    pub source_branch: String,
    pub target_repo: String,
    pub target_branch: String,
    pub title: String,
    pub body: String,
    pub draft: bool,
    #[serde(default)]
    pub assignees: Vec<Person>,
    #[serde(default)]
    pub reviewers: Vec<Person>,
    /// Noms des étiquettes.
    #[serde(default)]
    pub labels: Vec<String>,
}

/// PR / MR créée, ou celle qui existait déjà pour ces branches (`existing`).
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Pull {
    /// Numéro (GitHub) ou `iid` (GitLab) : celui affiché sur le provider.
    pub number: u64,
    pub url: String,
    pub title: String,
    pub existing: bool,
    /// Ce qui n'a pas pu être posé après la création (`pull_meta_failed` : assignés /
    /// étiquettes, `pull_reviewers_failed` : relecteurs) ; la PR existe quand même.
    pub warnings: Vec<String>,
}

fn parse_pull(kind: Kind, v: &Value, existing: bool) -> Option<Pull> {
    let (number, url) = match kind {
        Kind::GitHub => (v["number"].as_u64()?, v["html_url"].as_str()?),
        Kind::GitLab => (v["iid"].as_u64()?, v["web_url"].as_str()?),
    };
    Some(Pull { number, url: url.into(), title: v["title"].as_str().unwrap_or_default().into(), existing, warnings: Vec::new() })
}

fn check_branch(b: &str) -> Result<(), String> {
    if b.is_empty() || b.starts_with('-') || b.chars().any(|c| c.is_control() || c == ' ') {
        return Err("pull_branch_invalid".into());
    }
    Ok(())
}

/// Crée la PR / MR. Si une PR / MR ouverte existe déjà pour ces branches, la renvoie
/// (`existing`) au lieu d'échouer.
pub fn create(kind: Kind, api: &str, token: &str, p: &NewPull) -> Result<Pull, String> {
    check_repo(&p.source_repo)?;
    check_repo(&p.target_repo)?;
    check_branch(&p.source_branch)?;
    check_branch(&p.target_branch)?;
    let title = p.title.trim();
    if title.is_empty() {
        return Err("pull_title_missing".into());
    }
    let same_repo = p.source_repo.eq_ignore_ascii_case(&p.target_repo);
    match kind {
        Kind::GitHub => {
            // Depuis un fork : `propriétaire:branche`.
            let owner = p.source_repo.rsplit_once('/').map_or("", |(o, _)| o);
            let head = if same_repo { p.source_branch.clone() } else { format!("{owner}:{}", p.source_branch) };
            let body = json!({ "title": title, "head": head, "base": p.target_branch, "body": p.body, "draft": p.draft });
            let (status, v) = call(kind, api, &format!("{}/pulls", project(kind, &p.target_repo)), token, Some(&body))?;
            if (200..300).contains(&status) {
                let mut pull = parse_pull(kind, &v, false).ok_or("provider_unexpected")?;
                pull.warnings = github_meta(api, token, &p.target_repo, pull.number, p);
                return Ok(pull);
            }
            let text = message(&v);
            if status == 422 && text.contains("already exists") {
                let query = format!("{}/pulls?state=open&head={}&base={}", project(kind, &p.target_repo), enc(&format!("{owner}:{}", p.source_branch)), enc(&p.target_branch));
                return existing(kind, api, token, &query, None);
            }
            if status == 422 && text.contains("no commits between") {
                return Err("pull_no_commits".into());
            }
            if status == 422 && text.contains("draft") {
                return Err("pull_draft_unsupported".into());
            }
            if status == 422 && (text.contains(r#""field":"head""#) || text.contains(r#""field":"base""#)) {
                return Err("pull_branch_not_found".into());
            }
            Err(refused(status))
        }
        Kind::GitLab => {
            // Brouillon : préfixe du titre (`Draft:`), compris par toutes les versions récentes.
            let title = if p.draft && !title.to_lowercase().starts_with("draft:") { format!("Draft: {title}") } else { title.to_string() };
            let mut body = json!({ "source_branch": p.source_branch, "target_branch": p.target_branch, "title": title, "description": p.body });
            let ids = |people: &[Person]| people.iter().map(|x| x.id).collect::<Vec<_>>();
            if !p.assignees.is_empty() {
                body["assignee_ids"] = ids(&p.assignees).into();
            }
            if !p.reviewers.is_empty() {
                body["reviewer_ids"] = ids(&p.reviewers).into();
            }
            if !p.labels.is_empty() {
                body["labels"] = p.labels.join(",").into();
            }
            if !same_repo {
                // Depuis un fork : créée sur le projet source, vers l'identifiant du projet cible.
                body["target_project_id"] = project_id(kind, api, token, &p.target_repo)?.into();
            }
            let (status, v) = call(kind, api, &format!("{}/merge_requests", project(kind, &p.source_repo)), token, Some(&body))?;
            if (200..300).contains(&status) {
                return parse_pull(kind, &v, false).ok_or("provider_unexpected".into());
            }
            let text = message(&v);
            if status == 409 || text.contains("already exists") {
                // Les MR sont rangées sur le projet cible ; depuis un fork, seule celle qui part du
                // projet source compte (un autre fork peut avoir une branche du même nom).
                let query = format!(
                    "{}/merge_requests?state=opened&source_branch={}&target_branch={}",
                    project(kind, &p.target_repo),
                    enc(&p.source_branch),
                    enc(&p.target_branch)
                );
                let from = if same_repo { None } else { Some(project_id(kind, api, token, &p.source_repo)?) };
                return existing(kind, api, token, &query, from);
            }
            if (status == 400 || status == 422) && text.contains("branch") {
                return Err("pull_branch_not_found".into());
            }
            Err(refused(status))
        }
    }
}

/// Assignés et étiquettes (sur l'issue de la PR), puis relecteurs demandés. Un échec ne défait
/// pas la PR : il est rendu en avertissement.
fn github_meta(api: &str, token: &str, repo: &str, number: u64, p: &NewPull) -> Vec<String> {
    let kind = Kind::GitHub;
    let ok = |r: Result<Reply, String>| r.is_ok_and(|r| (200..300).contains(&r.status));
    let logins = |people: &[Person]| people.iter().map(|x| x.login.clone()).collect::<Vec<_>>();
    let mut warnings = Vec::new();
    if !p.assignees.is_empty() || !p.labels.is_empty() {
        let mut meta = json!({});
        if !p.assignees.is_empty() {
            meta["assignees"] = logins(&p.assignees).into();
        }
        if !p.labels.is_empty() {
            meta["labels"] = p.labels.clone().into();
        }
        if !ok(request(kind, api, &format!("{}/issues/{number}", project(kind, repo)), token, Method::Patch(&meta))) {
            warnings.push("pull_meta_failed".into());
        }
    }
    if !p.reviewers.is_empty() {
        let body = json!({ "reviewers": logins(&p.reviewers) });
        if !ok(request(kind, api, &format!("{}/pulls/{number}/requested_reviewers", project(kind, repo)), token, Method::Post(&body))) {
            warnings.push("pull_reviewers_failed".into());
        }
    }
    warnings
}

/// Identifiant numérique d'un projet GitLab.
fn project_id(kind: Kind, api: &str, token: &str, repo: &str) -> Result<u64, String> {
    let (status, v) = call(kind, api, &project(kind, repo), token, None)?;
    if !(200..300).contains(&status) {
        return Err(refused(status));
    }
    v["id"].as_u64().ok_or("provider_unexpected".into())
}

/// La PR / MR ouverte que décrit cette requête de liste (la première ; `from` : la première
/// qui part de ce projet GitLab).
fn existing(kind: Kind, api: &str, token: &str, query: &str, from: Option<u64>) -> Result<Pull, String> {
    let (status, v) = call(kind, api, query, token, None)?;
    if !(200..300).contains(&status) {
        return Err(refused(status));
    }
    v.as_array()
        .and_then(|list| list.iter().find(|m| from.is_none_or(|id| m["source_project_id"].as_u64() == Some(id))))
        .and_then(|found| parse_pull(kind, found, true))
        .ok_or("pull_exists".into())
}

// ---------------------------------------------------------------------------
// Personnes et étiquettes proposées (assignés, relecteurs, étiquettes)
// ---------------------------------------------------------------------------

/// Une personne qui peut être assignée ou relire : `login` pour GitHub, `id` pour GitLab.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Person {
    pub id: u64,
    pub login: String,
    #[serde(default)]
    pub name: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Label {
    pub name: String,
    /// Couleur `rrggbb`, sans `#`.
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
}

/// Personnes et étiquettes d'un dépôt.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct PullOptions {
    pub people: Vec<Person>,
    pub labels: Vec<Label>,
    /// Lecture sur le provider (secondes Unix).
    pub fetched_at: u64,
    /// Pas encore lues pour ce dépôt : réunion de celles des autres dépôts du même propriétaire
    /// (organisation, groupe), en attendant.
    #[serde(default)]
    pub from_owner: bool,
    /// Liste coupée (au-delà de `MAX_PAGES` pages).
    #[serde(default)]
    pub truncated: bool,
}

const PER_PAGE: usize = 100;
/// Au plus 5 000 personnes ou étiquettes.
const MAX_PAGES: usize = 50;

/// Tous les éléments d'une liste paginée : la première page dit combien il y en a, les
/// suivantes sont demandées une à une (GitHub demande des requêtes en série pour un même
/// compte : des requêtes simultanées déclenchent sa limite secondaire). Renvoie aussi si la
/// liste a été coupée.
fn get_all(kind: Kind, api: &str, path: &str, token: &str) -> Result<(Vec<Value>, bool), String> {
    let sep = if path.contains('?') { '&' } else { '?' };
    let page = |n: usize| -> Result<Reply, String> {
        let r = request(kind, api, &format!("{path}{sep}per_page={PER_PAGE}&page={n}"), token, Method::Get)?;
        if !(200..300).contains(&r.status) {
            return Err(refused(r.status));
        }
        Ok(r)
    };
    let first = page(1)?;
    let mut items = first.json.as_array().cloned().ok_or("provider_unexpected")?;
    // Pas de nombre de pages (GitLab l'omet au-delà de 10 000 résultats) mais une suite
    // annoncée : on s'arrête à la première, et la liste est dite coupée.
    let unknown_rest = first.pages.is_none() && first.more;
    let announced = first.pages.unwrap_or(1);
    let last = announced.min(MAX_PAGES);
    for n in 2..=last {
        items.extend(page(n)?.json.as_array().cloned().ok_or("provider_unexpected")?);
    }
    Ok((items, announced > MAX_PAGES || unknown_rest))
}

fn text(v: &Value, key: &str) -> Option<String> {
    v[key].as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
}

fn parse_person(kind: Kind, v: &Value) -> Option<Person> {
    let login = text(v, if kind == Kind::GitHub { "login" } else { "username" })?;
    // GitLab : comptes bloqués ou en attente écartés.
    if kind == Kind::GitLab && v["state"].as_str().is_some_and(|s| s != "active") {
        return None;
    }
    Some(Person { id: v["id"].as_u64()?, login, name: text(v, "name") })
}

fn parse_label(v: &Value) -> Option<Label> {
    Some(Label { name: text(v, "name")?, color: text(v, "color").map(|c| c.trim_start_matches('#').to_lowercase()), description: text(v, "description") })
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

/// Une seule lecture des personnes / étiquettes à la fois, tous dépôts confondus : à
/// l'ouverture d'un dépôt, chacun de ses remotes en demande une.
static FETCHING: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Personnes et étiquettes du dépôt, lues sur le provider (une liste puis l'autre, cf.
/// [`get_all`] et [`FETCHING`]). GitHub : `/assignees` (ceux qui peuvent être assignés : ce
/// sont aussi les relecteurs possibles) et `/labels` ; GitLab : `/members/all` (membres
/// hérités des groupes compris) et `/labels`.
pub fn fetch_options(kind: Kind, api: &str, repo: &str, token: &str) -> Result<PullOptions, String> {
    check_repo(repo)?;
    let base = project(kind, repo);
    let people_path = match kind {
        Kind::GitHub => format!("{base}/assignees"),
        Kind::GitLab => format!("{base}/members/all"),
    };
    let labels_path = format!("{base}/labels");
    let _one_at_a_time = FETCHING.lock().unwrap_or_else(|e| e.into_inner());
    let (people, cut_people) = get_all(kind, api, &people_path, token)?;
    let (labels, cut_labels) = get_all(kind, api, &labels_path, token)?;
    let mut people: Vec<Person> = people.iter().filter_map(|v| parse_person(kind, v)).collect();
    // Un membre hérité de plusieurs groupes apparaît plusieurs fois chez GitLab.
    let mut seen = std::collections::HashSet::new();
    people.retain(|x| seen.insert(x.id));
    people.sort_by_key(|x| x.login.to_lowercase());
    let mut labels: Vec<Label> = labels.iter().filter_map(parse_label).collect();
    labels.sort_by_key(|l| l.name.to_lowercase());
    Ok(PullOptions { people, labels, fetched_at: now(), from_owner: false, truncated: cut_people || cut_labels })
}

static CACHE_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Dossier du cache des personnes / étiquettes (dans le dossier de config de l'app).
pub fn set_cache_dir(dir: PathBuf) {
    let _ = CACHE_DIR.set(dir);
}

/// Entrée du cache : un fichier par dépôt, avec de quoi retrouver ceux d'un même propriétaire.
#[derive(Serialize, Deserialize)]
struct CacheEntry {
    kind: String,
    url: String,
    repo: String,
    options: PullOptions,
}

fn cache_file(dir: &Path, kind: Kind, url: &str, repo: &str) -> PathBuf {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    (kind.as_str(), url, repo.to_lowercase()).hash(&mut hasher);
    dir.join(format!("{:016x}.json", hasher.finish()))
}

fn owner_of(repo: &str) -> &str {
    repo.rsplit_once('/').map_or("", |(o, _)| o)
}

/// Ce qui est en cache pour ce dépôt, sans rien demander au provider. Pas encore lu : la
/// réunion de ce qui l'a été pour les autres dépôts du même propriétaire (`from_owner`) —
/// dans une même organisation, ce sont presque toujours les mêmes personnes.
pub fn cached_options(kind: Kind, url: &str, repo: &str) -> Option<PullOptions> {
    cached_in(CACHE_DIR.get()?, kind, url, repo)
}

fn cached_in(dir: &Path, kind: Kind, url: &str, repo: &str) -> Option<PullOptions> {
    let read = |file: &Path| -> Option<CacheEntry> { serde_json::from_str(&std::fs::read_to_string(file).ok()?).ok() };
    if let Some(entry) = read(&cache_file(dir, kind, url, repo)) {
        return Some(entry.options);
    }
    let owner = owner_of(repo).to_lowercase();
    let mut merged: Option<PullOptions> = None;
    for file in std::fs::read_dir(dir).ok()?.flatten() {
        let Some(entry) = read(&file.path()) else { continue };
        if entry.kind != kind.as_str() || entry.url != url || owner_of(&entry.repo).to_lowercase() != owner {
            continue;
        }
        let m = merged.get_or_insert_with(|| PullOptions { fetched_at: u64::MAX, from_owner: true, ..Default::default() });
        for x in entry.options.people {
            if !m.people.iter().any(|y| y.id == x.id) {
                m.people.push(x);
            }
        }
        for l in entry.options.labels {
            if !m.labels.iter().any(|y| y.name.eq_ignore_ascii_case(&l.name)) {
                m.labels.push(l);
            }
        }
        m.fetched_at = m.fetched_at.min(entry.options.fetched_at);
    }
    let mut m = merged?;
    m.people.sort_by_key(|x| x.login.to_lowercase());
    m.labels.sort_by_key(|l| l.name.to_lowercase());
    Some(m)
}

/// Lit les personnes et étiquettes sur le provider et les garde en cache.
pub fn refresh_options(kind: Kind, api: &str, url: &str, repo: &str, token: &str) -> Result<PullOptions, String> {
    let options = fetch_options(kind, api, repo, token)?;
    if let Some(dir) = CACHE_DIR.get() {
        store_in(dir, kind, url, repo, &options);
    }
    Ok(options)
}

fn store_in(dir: &Path, kind: Kind, url: &str, repo: &str, options: &PullOptions) {
    let entry = CacheEntry { kind: kind.as_str().into(), url: url.into(), repo: repo.to_lowercase(), options: options.clone() };
    let _ = std::fs::create_dir_all(dir);
    if let Ok(text) = serde_json::to_string(&entry) {
        // Écrit à côté puis renommé : une lecture en même temps ne voit jamais un fichier à moitié écrit.
        let file = cache_file(dir, kind, url, repo);
        // Fichier temporaire propre à cette écriture : deux lectures du même dépôt en même
        // temps (deux fenêtres) ne mêlent pas leurs octets.
        static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let n = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let tmp = file.with_extension(format!("{}-{n}.tmp", std::process::id()));
        if std::fs::write(&tmp, text).is_ok() {
            let _ = std::fs::rename(&tmp, &file);
        }
    }
}

// ---------------------------------------------------------------------------
// Brouillon : commits de la branche et modèle du dépôt
// ---------------------------------------------------------------------------

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DraftCommit {
    pub subject: String,
    pub body: String,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullDraft {
    /// Commits de la source absents de la cible, du plus ancien au plus récent (50 au plus).
    pub commits: Vec<DraftCommit>,
    /// Modèle de PR / MR du dépôt (lu sur la cible), s'il y en a un.
    pub template: Option<String>,
}

const MAX_DRAFT_COMMITS: usize = 50;
const MAX_TEMPLATE: usize = 64 * 1024;

/// Emplacements du modèle de PR chez GitHub (le premier trouvé l'emporte).
const GITHUB_TEMPLATES: &[&str] = &[
    ".github/pull_request_template.md",
    ".github/PULL_REQUEST_TEMPLATE.md",
    "pull_request_template.md",
    "PULL_REQUEST_TEMPLATE.md",
    "docs/pull_request_template.md",
    "docs/PULL_REQUEST_TEMPLATE.md",
];
const GITLAB_TEMPLATES: &str = ".gitlab/merge_request_templates/";

fn check_ref(r: &str) -> Result<(), String> {
    if r.is_empty() || r.starts_with('-') || r.contains("..") || r.chars().any(|c| c.is_control() || c == ' ' || c == ':') {
        return Err("pull_branch_invalid".into());
    }
    Ok(())
}

/// Fichier `file` tel qu'il est sur `rev`, s'il existe et n'est pas trop gros.
fn show(path: &Path, rev: &str, file: &str) -> Option<String> {
    let text = run(Some(path), &["show", &format!("{rev}:{file}")]).ok()?;
    (!text.trim().is_empty() && text.len() <= MAX_TEMPLATE).then(|| text.trim_end().to_string())
}

fn template(path: &Path, rev: &str, kind: Option<Kind>) -> Option<String> {
    let github = || GITHUB_TEMPLATES.iter().find_map(|f| show(path, rev, f));
    let gitlab = || {
        let names = run(Some(path), &["ls-tree", "--name-only", rev, GITLAB_TEMPLATES]).ok()?;
        let files: Vec<&str> = names.lines().filter(|l| l.to_lowercase().ends_with(".md")).collect();
        // `Default.md`, sinon le seul modèle.
        let pick = files.iter().find(|f| f.to_lowercase().ends_with("/default.md")).or(if files.len() == 1 { files.first() } else { None })?;
        show(path, rev, pick)
    };
    match kind {
        Some(Kind::GitHub) => github(),
        Some(Kind::GitLab) => gitlab(),
        None => github().or_else(gitlab),
    }
}

/// Commits de `source` absents de `target`, et le modèle lu sur `target` (sinon sur `source`).
/// `target` absent en local (pas encore récupéré) : pas de commits, modèle lu sur `source`.
pub fn draft(path: &Path, source: &str, target: &str, kind: Option<Kind>) -> Result<PullDraft, String> {
    check_ref(source)?;
    check_ref(target)?;
    let exists = |r: &str| run(Some(path), &["rev-parse", "--verify", "-q", &format!("{r}^{{commit}}")]).is_ok();
    if !exists(source) {
        return Err("pull_branch_not_found".into());
    }
    let has_target = exists(target);
    let commits = if has_target {
        let range = format!("{target}..{source}");
        let max = format!("-{MAX_DRAFT_COMMITS}");
        let out = run(Some(path), &["log", "--no-merges", "--reverse", &max, "--format=%s%x1f%b%x1e", &range])?;
        out.split('\x1e')
            .filter_map(|e| {
                let (subject, body) = e.trim_start_matches('\n').split_once('\x1f')?;
                Some(DraftCommit { subject: subject.trim().into(), body: body.trim().into() })
            })
            .collect()
    } else {
        Vec::new()
    };
    let template = has_target.then(|| template(path, target, kind)).flatten().or_else(|| template(path, source, kind));
    Ok(PullDraft { commits, template })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::tests::serve;

    fn new_pull(source: &str, target: &str, draft: bool) -> NewPull {
        NewPull {
            source_repo: source.into(),
            source_branch: "feature/x".into(),
            target_repo: target.into(),
            target_branch: "main".into(),
            title: " Titre ".into(),
            body: "Corps".into(),
            draft,
            assignees: Vec::new(),
            reviewers: Vec::new(),
            labels: Vec::new(),
        }
    }

    fn person(id: u64, login: &str) -> Person {
        Person { id, login: login.into(), name: None }
    }

    /// Faux provider qui répond selon la requête :
    /// `route(ligne de requête)` → (code, en-têtes en plus, corps). Renvoie son
    /// adresse et le nombre de requêtes reçues.
    fn serve_routes(route: impl Fn(&str) -> (u16, String, String) + Send + Sync + 'static) -> (String, std::sync::Arc<std::sync::atomic::AtomicUsize>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let count = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let seen = count.clone();
        let route = std::sync::Arc::new(route);
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { return };
                let route = route.clone();
                seen.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                std::thread::spawn(move || {
                    let mut request = Vec::new();
                    let mut buf = [0u8; 1024];
                    while !request.windows(4).any(|w| w == b"\r\n\r\n") {
                        match stream.read(&mut buf) {
                            Ok(n) if n > 0 => request.extend_from_slice(&buf[..n]),
                            _ => break,
                        }
                    }
                    let line = String::from_utf8_lossy(&request).lines().next().unwrap_or_default().to_string();
                    let (status, extra, body) = route(&line);
                    let head = format!("HTTP/1.1 {status} X\r\nContent-Type: application/json\r\n{extra}Content-Length: {}\r\nConnection: close\r\n\r\n", body.len());
                    let _ = stream.write_all(head.as_bytes());
                    let _ = stream.write_all(body.as_bytes());
                });
            }
        });
        (url, count)
    }

    #[test]
    fn github_people_and_labels_are_read_page_by_page_in_parallel() {
        let (url, count) = serve_routes(|line| {
            let page: usize = line.split("&page=").nth(1).and_then(|r| r.split([' ', '&']).next()).and_then(|n| n.parse().ok()).unwrap_or(1);
            if line.starts_with("GET /repos/org/depot/assignees?per_page=100&page=") {
                let link = if page == 1 { "Link: <http://x/repos/org/depot/assignees?per_page=100&page=2>; rel=\"next\", <http://x/repos/org/depot/assignees?per_page=100&page=3>; rel=\"last\"\r\n" } else { "" };
                let people: Vec<String> = (0..2).map(|i| format!(r#"{{"login":"P{page}-{i}","id":{}}}"#, page * 10 + i)).collect();
                return (200, link.into(), format!("[{}]", people.join(",")));
            }
            if line.starts_with("GET /repos/org/depot/labels?per_page=100&page=1 ") {
                return (200, String::new(), r##"[{"name":"bug","color":"D73A4A","description":"Ça casse"},{"name":"Docs","color":"0075ca"}]"##.into());
            }
            (404, String::new(), "{}".into())
        });
        let o = fetch_options(Kind::GitHub, &url, "org/depot", "ghp_x").unwrap();
        // Trois pages de personnes, triées ; une seule d'étiquettes.
        assert_eq!(o.people.iter().map(|x| x.login.as_str()).collect::<Vec<_>>(), ["P1-0", "P1-1", "P2-0", "P2-1", "P3-0", "P3-1"]);
        assert_eq!(o.labels, vec![
            Label { name: "bug".into(), color: Some("d73a4a".into()), description: Some("Ça casse".into()) },
            Label { name: "Docs".into(), color: Some("0075ca".into()), description: None },
        ]);
        assert!(!o.from_owner && !o.truncated && o.fetched_at > 0);
        assert_eq!(count.load(std::sync::atomic::Ordering::SeqCst), 4);
    }

    #[test]
    fn gitlab_members_are_deduplicated_and_inactive_ones_left_out() {
        let (url, _) = serve_routes(|line| {
            if line.starts_with("GET /projects/g%2Fp/members/all?per_page=100&page=1 ") {
                return (200, "X-Total-Pages: 1\r\n".into(), r#"[{"id":1,"username":"camille","name":"Camille","state":"active"},{"id":1,"username":"camille","name":"Camille","state":"active"},{"id":2,"username":"parti","state":"blocked"}]"#.into());
            }
            if line.starts_with("GET /projects/g%2Fp/labels?per_page=100&page=1 ") {
                return (200, String::new(), r##"[{"name":"urgent","color":"#FF0000"}]"##.into());
            }
            (404, String::new(), "{}".into())
        });
        let o = fetch_options(Kind::GitLab, &url, "g/p", "glpat").unwrap();
        assert_eq!(o.people, vec![Person { id: 1, login: "camille".into(), name: Some("Camille".into()) }]);
        assert_eq!(o.labels[0].color.as_deref(), Some("ff0000"));
    }

    #[test]
    fn gitlab_list_without_page_count_is_marked_truncated() {
        let (url, _) = serve_routes(|line| {
            if line.contains("/members/all?per_page=100&page=1 ") {
                return (200, "X-Next-Page: 2\r\n".into(), r#"[{"id":1,"username":"a","state":"active"}]"#.into());
            }
            (200, "X-Total-Pages: 1\r\n".into(), "[]".into())
        });
        let o = fetch_options(Kind::GitLab, &url, "g/p", "glpat").unwrap();
        assert_eq!((o.people.len(), o.truncated), (1, true));
    }

    #[test]
    fn options_errors() {
        let (url, _) = serve_routes(|_| (404, String::new(), "{}".into()));
        assert_eq!(fetch_options(Kind::GitHub, &url, "o/r", "ghp").unwrap_err(), "pull_repo_not_found");
        assert_eq!(fetch_options(Kind::GitHub, &url, "pas-de-proprietaire", "ghp").unwrap_err(), "pull_repo_invalid");
        assert_eq!(last_page(r#"<https://api.github.com/x?page=2>; rel="next", <https://api.github.com/x?per_page=100&page=34>; rel="last""#), Some(34));
        assert_eq!(last_page(r#"<https://api.github.com/x?page=2>; rel="next""#), None);
    }

    #[test]
    fn cache_falls_back_to_the_other_repos_of_the_owner() {
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path();
        let opts = |people: Vec<Person>, label: &str, at: u64| PullOptions { people, labels: vec![Label { name: label.into(), color: None, description: None }], fetched_at: at, ..Default::default() };
        let gh = "https://github.com";
        assert_eq!(cached_in(d, Kind::GitHub, gh, "org/front"), None);
        store_in(d, Kind::GitHub, gh, "org/api", &opts(vec![person(1, "zoe"), person(2, "alix")], "bug", 100));
        store_in(d, Kind::GitHub, gh, "Org/Back", &opts(vec![person(2, "alix"), person(3, "max")], "Bug", 50));
        store_in(d, Kind::GitHub, gh, "autre/x", &opts(vec![person(9, "loin")], "x", 10));
        store_in(d, Kind::GitLab, gh, "org/gl", &opts(vec![person(8, "gl")], "y", 10));
        // Dépôt déjà lu : sa propre liste.
        let own = cached_in(d, Kind::GitHub, gh, "ORG/API").unwrap();
        assert_eq!((own.people.len(), own.from_owner), (2, false));
        // Pas encore lu : réunion des dépôts d'`org` sur la même instance, la plus ancienne date.
        let merged = cached_in(d, Kind::GitHub, gh, "org/front").unwrap();
        assert!(merged.from_owner);
        assert_eq!(merged.people.iter().map(|x| x.login.as_str()).collect::<Vec<_>>(), ["alix", "max", "zoe"]);
        assert_eq!(merged.labels.len(), 1);
        assert_eq!(merged.fetched_at, 50);
        assert_eq!(cached_in(d, Kind::GitHub, gh, "inconnu/r"), None);
    }

    #[test]
    fn github_pull_gets_its_assignees_labels_and_reviewers() {
        let (url, requests) = serve(vec![
            (201, r#"{"number":12,"html_url":"h","title":"t"}"#),
            (200, r#"{"number":12}"#),
            (422, r#"{"message":"Review cannot be requested from pull request author."}"#),
        ]);
        let mut p = new_pull("org/depot", "org/depot", false);
        p.assignees = vec![person(1, "alix")];
        p.reviewers = vec![person(2, "max")];
        p.labels = vec!["bug".into()];
        let pull = create(Kind::GitHub, &url, "ghp_x", &p).unwrap();
        assert_eq!(pull.warnings, vec!["pull_reviewers_failed".to_string()]);
        requests.recv().unwrap();
        let meta = requests.recv().unwrap();
        assert!(meta.starts_with("PATCH /repos/org/depot/issues/12 "), "{meta}");
        assert!(meta.contains(r#""assignees":["alix"]"#) && meta.contains(r#""labels":["bug"]"#), "{meta}");
        let reviewers = requests.recv().unwrap();
        assert!(reviewers.starts_with("POST /repos/org/depot/pulls/12/requested_reviewers "), "{reviewers}");
        assert!(reviewers.contains(r#""reviewers":["max"]"#), "{reviewers}");
    }

    #[test]
    fn gitlab_merge_request_carries_people_and_labels() {
        let (url, requests) = serve(vec![(201, r#"{"iid":5,"web_url":"w","title":"t"}"#)]);
        let mut p = new_pull("g/p", "g/p", false);
        p.assignees = vec![person(7, "camille")];
        p.reviewers = vec![person(8, "max"), person(9, "zoe")];
        p.labels = vec!["bug".into(), "urgent".into()];
        let pull = create(Kind::GitLab, &url, "glpat", &p).unwrap();
        assert!(pull.warnings.is_empty());
        let request = requests.recv().unwrap();
        assert!(request.contains(r#""assignee_ids":[7]"#) && request.contains(r#""reviewer_ids":[8,9]"#) && request.contains(r#""labels":"bug,urgent""#), "{request}");
    }

    #[test]
    fn github_pull_is_created_on_the_target_repo() {
        let (url, requests) = serve(vec![(201, r#"{"number":12,"html_url":"https://github.com/org/depot/pull/12","title":"Titre"}"#)]);
        let pull = create(Kind::GitHub, &url, "ghp_x", &new_pull("org/depot", "org/depot", true)).unwrap();
        assert_eq!(pull, Pull { number: 12, url: "https://github.com/org/depot/pull/12".into(), title: "Titre".into(), existing: false, warnings: vec![] });
        let request = requests.recv().unwrap();
        assert!(request.starts_with("POST /repos/org/depot/pulls "), "{request}");
        assert!(request.contains(r#""head":"feature/x""#) && request.contains(r#""base":"main""#) && request.contains(r#""draft":true"#), "{request}");
        assert!(request.contains(r#""title":"Titre""#), "{request}");
    }

    #[test]
    fn github_pull_from_a_fork_names_its_owner() {
        let (url, requests) = serve(vec![(201, r#"{"number":3,"html_url":"h","title":"t"}"#)]);
        create(Kind::GitHub, &url, "ghp_x", &new_pull("moi/depot", "org/depot", false)).unwrap();
        let request = requests.recv().unwrap();
        assert!(request.starts_with("POST /repos/org/depot/pulls "), "{request}");
        assert!(request.contains(r#""head":"moi:feature/x""#), "{request}");
    }

    #[test]
    fn github_existing_pull_is_returned() {
        let (url, requests) = serve(vec![
            (422, r#"{"message":"Validation Failed","errors":[{"message":"A pull request already exists for org:feature/x."}]}"#),
            (200, r#"[{"number":7,"html_url":"https://github.com/org/depot/pull/7","title":"Ancienne"}]"#),
        ]);
        let pull = create(Kind::GitHub, &url, "ghp_x", &new_pull("org/depot", "org/depot", false)).unwrap();
        assert_eq!((pull.number, pull.existing), (7, true));
        requests.recv().unwrap();
        let list = requests.recv().unwrap();
        assert!(list.starts_with("GET /repos/org/depot/pulls?state=open&head=org%3Afeature%2Fx&base=main "), "{list}");
    }

    #[test]
    fn github_refusals() {
        let answer = |status: u16, body: &'static str| {
            let (url, _r) = serve(vec![(status, body)]);
            create(Kind::GitHub, &url, "ghp_x", &new_pull("org/depot", "org/depot", false)).unwrap_err()
        };
        assert_eq!(answer(422, r#"{"errors":[{"message":"No commits between main and feature/x"}]}"#), "pull_no_commits");
        assert_eq!(answer(422, r#"{"errors":[{"message":"Draft pull requests are not supported in this repository."}]}"#), "pull_draft_unsupported");
        assert_eq!(answer(422, r#"{"errors":[{"resource":"PullRequest","field":"head","code":"invalid"}]}"#), "pull_branch_not_found");
        assert_eq!(answer(422, r#"{"message":"Validation Failed","errors":[{"message":"database is busy"}]}"#), "provider_error");
        assert_eq!(answer(404, r#"{"message":"Not Found"}"#), "pull_repo_not_found");
        assert_eq!(answer(403, "{}"), "pull_forbidden");
        assert_eq!(answer(401, "{}"), "token_invalid");
    }

    #[test]
    fn gitlab_merge_request_is_created() {
        let (url, requests) = serve(vec![(201, r#"{"iid":5,"web_url":"https://gitlab.exemple.fr/groupe/sous/projet/-/merge_requests/5","title":"Draft: Titre"}"#)]);
        let pull = create(Kind::GitLab, &url, "glpat", &new_pull("groupe/sous/projet", "groupe/sous/projet", true)).unwrap();
        assert_eq!((pull.number, pull.title.as_str()), (5, "Draft: Titre"));
        let request = requests.recv().unwrap();
        assert!(request.starts_with("POST /projects/groupe%2Fsous%2Fprojet/merge_requests "), "{request}");
        assert!(request.contains(r#""title":"Draft: Titre""#) && request.contains(r#""source_branch":"feature/x""#) && request.contains(r#""description":"Corps""#), "{request}");
        assert!(!request.contains("target_project_id"), "{request}");
    }

    #[test]
    fn gitlab_merge_request_from_a_fork_targets_the_project_id() {
        let (url, requests) = serve(vec![(200, r#"{"id":42,"default_branch":"main"}"#), (201, r#"{"iid":1,"web_url":"w","title":"t"}"#)]);
        create(Kind::GitLab, &url, "glpat", &new_pull("moi/projet", "groupe/projet", false)).unwrap();
        assert!(requests.recv().unwrap().starts_with("GET /projects/groupe%2Fprojet "));
        let post = requests.recv().unwrap();
        assert!(post.starts_with("POST /projects/moi%2Fprojet/merge_requests "), "{post}");
        assert!(post.contains(r#""target_project_id":42"#), "{post}");
    }

    #[test]
    fn gitlab_existing_merge_request_is_returned() {
        let (url, requests) = serve(vec![
            (409, r#"{"message":["Another open merge request already exists for this source branch: !4"]}"#),
            (200, r#"[{"iid":4,"web_url":"w4","title":"Ancienne"}]"#),
        ]);
        let pull = create(Kind::GitLab, &url, "glpat", &new_pull("g/p", "g/p", false)).unwrap();
        assert_eq!((pull.number, pull.existing), (4, true));
        requests.recv().unwrap();
        assert!(requests.recv().unwrap().starts_with("GET /projects/g%2Fp/merge_requests?state=opened&source_branch=feature%2Fx&target_branch=main "));
    }

    #[test]
    fn gitlab_existing_merge_request_from_a_fork_is_the_one_from_its_project() {
        let (url, requests) = serve(vec![
            (200, r#"{"id":42}"#),
            (409, r#"{"message":["Another open merge request already exists for this source branch"]}"#),
            (200, r#"{"id":9}"#),
            (200, r#"[{"iid":3,"web_url":"w3","title":"Autre fork","source_project_id":8},{"iid":4,"web_url":"w4","title":"La mienne","source_project_id":9}]"#),
        ]);
        let pull = create(Kind::GitLab, &url, "glpat", &new_pull("moi/projet", "groupe/projet", false)).unwrap();
        assert_eq!((pull.number, pull.existing), (4, true));
        requests.recv().unwrap();
        requests.recv().unwrap();
        assert!(requests.recv().unwrap().starts_with("GET /projects/moi%2Fprojet "));
        assert!(requests.recv().unwrap().starts_with("GET /projects/groupe%2Fprojet/merge_requests?state=opened&source_branch=feature%2Fx&target_branch=main "));
    }

    #[test]
    fn bad_input_sends_nothing() {
        // Aucun serveur n'écoute : une requête donnerait `provider_unreachable`.
        let api = "http://127.0.0.1:9";
        let mut p = new_pull("org/depot", "org/../x", false);
        assert_eq!(create(Kind::GitHub, api, "ghp_x", &p).unwrap_err(), "pull_repo_invalid");
        p.target_repo = "org/depot".into();
        p.source_branch = "-x".into();
        assert_eq!(create(Kind::GitHub, api, "ghp_x", &p).unwrap_err(), "pull_branch_invalid");
        p.source_branch = "x".into();
        p.title = "  ".into();
        assert_eq!(create(Kind::GitHub, api, "ghp_x", &p).unwrap_err(), "pull_title_missing");
        assert_eq!(default_branch(Kind::GitHub, api, "sans-proprietaire", "ghp_x").unwrap_err(), "pull_repo_invalid");
    }

    #[test]
    fn default_branch_is_read() {
        let (url, requests) = serve(vec![(200, r#"{"default_branch":"develop"}"#), (404, "{}")]);
        assert_eq!(default_branch(Kind::GitLab, &url, "g/p", "glpat").unwrap(), "develop");
        assert!(requests.recv().unwrap().starts_with("GET /projects/g%2Fp "));
        assert_eq!(default_branch(Kind::GitHub, &url, "o/r", "ghp").unwrap_err(), "pull_repo_not_found");
    }

    fn git(dir: &Path, args: &[&str]) -> String {
        run(Some(dir), args).unwrap()
    }

    fn repo() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path();
        git(p, &["init", "-q", "-b", "main"]);
        git(p, &["config", "user.name", "T"]);
        git(p, &["config", "user.email", "t@e.fr"]);
        git(p, &["config", "commit.gpgsign", "false"]);
        std::fs::write(p.join("a.txt"), "a\n").unwrap();
        git(p, &["add", "."]);
        git(p, &["commit", "-q", "-m", "init"]);
        dir
    }

    #[test]
    fn draft_lists_the_branch_commits_and_the_template() {
        let dir = repo();
        let p = dir.path();
        std::fs::create_dir_all(p.join(".github")).unwrap();
        std::fs::write(p.join(".github/pull_request_template.md"), "## Quoi\n\n## Pourquoi\n").unwrap();
        git(p, &["add", "."]);
        git(p, &["commit", "-q", "-m", "modèle"]);
        git(p, &["switch", "-q", "-c", "feature/x"]);
        for (i, msg) in ["Premier\n\nDétail du premier", "Second"].iter().enumerate() {
            std::fs::write(p.join(format!("f{i}.txt")), "x\n").unwrap();
            git(p, &["add", "."]);
            git(p, &["commit", "-q", "-m", msg]);
        }
        let d = draft(p, "feature/x", "main", Some(Kind::GitHub)).unwrap();
        assert_eq!(
            d.commits,
            vec![DraftCommit { subject: "Premier".into(), body: "Détail du premier".into() }, DraftCommit { subject: "Second".into(), body: "".into() }]
        );
        assert_eq!(d.template.as_deref(), Some("## Quoi\n\n## Pourquoi"));
        // Pas de modèle GitLab ; cible absente : modèle lu sur la source, pas de commits.
        assert_eq!(draft(p, "feature/x", "main", Some(Kind::GitLab)).unwrap().template, None);
        let none = draft(p, "feature/x", "origin/main", None).unwrap();
        assert!(none.commits.is_empty());
        assert!(none.template.is_some());
        assert_eq!(draft(p, "absente", "main", None).unwrap_err(), "pull_branch_not_found");
        assert_eq!(draft(p, "--output=x", "main", None).unwrap_err(), "pull_branch_invalid");
    }

    #[test]
    fn gitlab_template_default_or_only_one() {
        let dir = repo();
        let p = dir.path();
        std::fs::create_dir_all(p.join(".gitlab/merge_request_templates")).unwrap();
        std::fs::write(p.join(".gitlab/merge_request_templates/Bug.md"), "bug\n").unwrap();
        git(p, &["add", "."]);
        git(p, &["commit", "-q", "-m", "un modèle"]);
        assert_eq!(draft(p, "main", "main", Some(Kind::GitLab)).unwrap().template.as_deref(), Some("bug"));
        std::fs::write(p.join(".gitlab/merge_request_templates/Default.md"), "défaut\n").unwrap();
        git(p, &["add", "."]);
        git(p, &["commit", "-q", "-m", "deux modèles"]);
        assert_eq!(draft(p, "main", "main", Some(Kind::GitLab)).unwrap().template.as_deref(), Some("défaut"));
    }
}
