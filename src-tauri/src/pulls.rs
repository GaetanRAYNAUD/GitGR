//! Pull requests (GitHub) et merge requests (GitLab) : création, branche par défaut du dépôt
//! distant, et brouillon du titre / de la description tiré des commits et du modèle du dépôt.
//!
//! Le compte (et son token) est celui du profil du remote cible (cf. `providers`) ; l'interface
//! dit quel dépôt (`propriétaire/nom`) et quelles branches.

use crate::git::run;
use crate::providers::{Kind, agent, check_token, headers};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::path::Path;

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

/// Appel à l'API ; renvoie le code et le JSON de la réponse (4xx compris, à lire par l'appelant).
fn call(kind: Kind, api: &str, path: &str, token: &str, body: Option<&Value>) -> Result<(u16, Value), String> {
    check_token(token)?;
    let url = format!("{api}{path}");
    let response = match body {
        None => headers(kind, agent().get(&url), token).call(),
        Some(b) => headers(kind, agent().post(&url), token).header("Content-Type", "application/json").send(b.to_string()),
    };
    let mut response = response.map_err(|_| "provider_unreachable".to_string())?;
    let status = response.status().as_u16();
    let text = response.body_mut().with_config().limit(MAX_BODY).read_to_string().unwrap_or_default();
    match status {
        401 => Err("token_invalid".into()),
        // Redirection : jamais suivie (le token ne part que vers l'instance).
        300..=399 => Err("provider_not_found".into()),
        200..=299 => serde_json::from_str(&text).map(|v| (status, v)).map_err(|_| "provider_unexpected".into()),
        _ => Ok((status, serde_json::from_str(&text).unwrap_or(Value::String(text)))),
    }
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
}

fn parse_pull(kind: Kind, v: &Value, existing: bool) -> Option<Pull> {
    let (number, url) = match kind {
        Kind::GitHub => (v["number"].as_u64()?, v["html_url"].as_str()?),
        Kind::GitLab => (v["iid"].as_u64()?, v["web_url"].as_str()?),
    };
    Some(Pull { number, url: url.into(), title: v["title"].as_str().unwrap_or_default().into(), existing })
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
                return parse_pull(kind, &v, false).ok_or("provider_unexpected".into());
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
        }
    }

    #[test]
    fn github_pull_is_created_on_the_target_repo() {
        let (url, requests) = serve(vec![(201, r#"{"number":12,"html_url":"https://github.com/org/depot/pull/12","title":"Titre"}"#)]);
        let pull = create(Kind::GitHub, &url, "ghp_x", &new_pull("org/depot", "org/depot", true)).unwrap();
        assert_eq!(pull, Pull { number: 12, url: "https://github.com/org/depot/pull/12".into(), title: "Titre".into(), existing: false });
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
