//! Suivi des pull requests (GitHub) et merge requests (GitLab) : liste des ouvertes, détail
//! (relectures, fils de discussion, checks / pipelines, possibilité de merger) et actions
//! (commenter, répondre, résoudre un fil, relire, fermer / rouvrir, brouillon, merger, mettre à
//! jour la branche).
//!
//! GitHub : GraphQL pour lire (une requête pour la liste, une pour le détail : relectures,
//! fils et checks sont imbriqués), REST pour la plupart des actions, GraphQL pour celles qui
//! n'existent pas en REST (fils, brouillon, auto-merge). GitLab : REST.
//!
//! Les fichiers et le diff d'une PR / MR sont lus en local (`files` / `file_diff`), après avoir
//! récupéré son commit de tête s'il manque (`ensure_head`).

use crate::git::{run, run_raw};
use crate::providers::Kind;
use crate::pulls::{Label, Method, Person, check_ref, check_repo, enc, message, now, parse_label, parse_person, project, refused, request, text};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::path::Path;

// ---------------------------------------------------------------------------
// Modèle commun
// ---------------------------------------------------------------------------

/// Une PR / MR dans la liste.
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullSummary {
    pub number: u64,
    pub title: String,
    pub url: String,
    /// "open", "draft", "merged" ou "closed".
    pub state: String,
    pub author: Option<Person>,
    pub source_branch: String,
    /// Branche source dans un autre dépôt (fork).
    pub fork: bool,
    pub target_branch: String,
    pub head_sha: Option<String>,
    /// Secondes Unix.
    pub created_at: i64,
    pub updated_at: i64,
    /// "approved", "changes" (changements demandés), "required" (relecture attendue) ; absent : rien de connu.
    pub review: Option<String>,
    /// "success", "failure", "pending" ou "neutral" ; absent : pas de checks / pipeline.
    pub checks: Option<String>,
    pub reviewers: Vec<Person>,
    pub assignees: Vec<Person>,
    pub labels: Vec<Label>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullList {
    pub pulls: Vec<PullSummary>,
    pub fetched_at: u64,
    /// Plus de PR / MR ouvertes que la liste n'en montre (100).
    pub truncated: bool,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Review {
    pub author: Person,
    /// "approved", "changes", "commented" ou "pending" (relecture demandée, pas encore faite).
    pub state: String,
    pub at: Option<i64>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Comment {
    pub id: String,
    pub author: Option<Person>,
    pub body: String,
    pub at: i64,
}

/// Fil de discussion : commentaire général (sans fichier) ou sur une ligne du code.
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Thread {
    pub id: String,
    /// Peut être résolu / rouvert (fil sur le code ; GitLab : fil de discussion).
    pub resolvable: bool,
    pub resolved: bool,
    /// On peut y répondre (pas un commentaire isolé de GitHub).
    pub replyable: bool,
    pub path: Option<String>,
    pub line: Option<u32>,
    pub comments: Vec<Comment>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Check {
    pub name: String,
    /// Mêmes valeurs que `PullSummary::checks`.
    pub state: String,
    pub url: Option<String>,
}

/// Ce que permet le provider pour le merge.
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MergeInfo {
    pub can_merge: bool,
    /// Ce qui empêche le merge : "not_open", "draft", "conflicts", "behind", "changes",
    /// "approvals", "checks", "checks_pending", "threads", "checking", "forbidden", "blocked".
    pub blockers: Vec<String>,
    /// Modes permis par le dépôt : "merge", "squash", "rebase" (le premier est proposé).
    pub methods: Vec<String>,
    /// Supprimer la branche source après le merge, d'office.
    pub delete_branch: bool,
    /// Merge automatique (quand les checks passent) : absent s'il n'est pas permis ; sinon s'il est déjà demandé.
    pub auto_merge: Option<bool>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullDetail {
    #[serde(flatten)]
    pub pull: PullSummary,
    pub body: String,
    pub reviews: Vec<Review>,
    pub threads: Vec<Thread>,
    pub checks_list: Vec<Check>,
    pub merge: MergeInfo,
    /// Le compte peut modifier la PR / MR (titre, état…).
    pub can_update: bool,
    /// De quoi relancer les jobs en échec : exécutions de workflow GitHub Actions, pipeline GitLab.
    /// Vide : rien à relancer (ou checks d'une autre application, pas relançables d'ici).
    pub retry: Vec<u64>,
}

/// Action demandée par l'interface (toujours après un clic explicite).
#[derive(Deserialize, Debug, Clone)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum PullAction {
    Comment { body: String },
    Reply { thread: String, body: String },
    Resolve { thread: String, resolved: bool },
    /// `event` : "approve", "changes" (GitHub seulement) ou "comment".
    Review { event: String, body: String },
    /// Retire son approbation (GitLab).
    Unapprove,
    SetOpen { open: bool },
    SetDraft { draft: bool },
    Merge {
        method: String,
        #[serde(rename = "deleteBranch")]
        delete_branch: bool,
        /// Quand les checks passeront (auto-merge / merge when pipeline succeeds).
        auto: bool,
    },
    /// Met la branche à jour avec la cible (GitHub : merge de la cible ; GitLab : rebase).
    UpdateBranch,
    /// Relance les jobs en échec de ces exécutions (GitHub) / de ce pipeline (GitLab).
    RetryFailed { runs: Vec<u64> },
    /// Titre, description, relecteurs, assignés et étiquettes (listes complètes : remplacent les actuelles).
    Edit {
        title: String,
        body: String,
        reviewers: Vec<Person>,
        assignees: Vec<Person>,
        labels: Vec<String>,
    },
}

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

/// Date ISO 8601 (`2026-11-17T09:30:00Z`, `…+01:00`, fractions de seconde) en secondes Unix.
pub(crate) fn iso_time(s: &str) -> Option<i64> {
    let s = s.trim();
    let num = |a: usize, b: usize| s.get(a..b)?.parse::<i64>().ok();
    let (y, mo, d, h, mi, se) = (num(0, 4)?, num(5, 7)?, num(8, 10)?, num(11, 13)?, num(14, 16)?, num(17, 19)?);
    if !(1..=12).contains(&mo) || !(1..=31).contains(&d) {
        return None;
    }
    let mut rest = &s[19..];
    if let Some(r) = rest.strip_prefix('.') {
        rest = r.trim_start_matches(|c: char| c.is_ascii_digit());
    }
    let offset = match rest {
        "" | "Z" | "z" => 0,
        o if (o.starts_with('+') || o.starts_with('-')) && o.len() >= 6 => {
            let sign = if o.starts_with('-') { -1 } else { 1 };
            sign * (o.get(1..3)?.parse::<i64>().ok()? * 3600 + o.get(4..6)?.parse::<i64>().ok()? * 60)
        }
        _ => return None,
    };
    // Jours depuis 1970-01-01 (algorithme de H. Hinnant).
    let (y2, m2) = if mo <= 2 { (y - 1, mo + 9) } else { (y, mo - 3) };
    let era = y2.div_euclid(400);
    let yoe = y2 - era * 400;
    let doy = (153 * m2 + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Some(days * 86_400 + h * 3600 + mi * 60 + se - offset)
}

fn time_of(v: &Value) -> i64 {
    v.as_str().and_then(iso_time).unwrap_or(0)
}

/// `owner/name` d'un dépôt GitHub (exactement deux parties).
fn github_repo(repo: &str) -> Result<(&str, &str), String> {
    check_repo(repo)?;
    match repo.split_once('/') {
        Some((o, n)) if !n.contains('/') => Ok((o, n)),
        _ => Err("pull_repo_invalid".into()),
    }
}

/// Adresse de l'API GraphQL : `https://api.github.com/graphql`, `<instance>/api/graphql`
/// (GitHub Enterprise, dont l'API REST est sous `/api/v3`).
fn graphql_api(api: &str) -> String {
    api.strip_suffix("/v3").unwrap_or(api).to_string()
}

/// Requête GraphQL ; renvoie `data`. Les erreurs du provider sont traduites.
fn graphql(api: &str, token: &str, query: &str, variables: Value) -> Result<Value, String> {
    let body = json!({ "query": query, "variables": variables });
    let r = request(Kind::GitHub, &graphql_api(api), "/graphql", token, Method::Post(&body))?;
    if !(200..300).contains(&r.status) {
        return Err(refused(r.status));
    }
    if let Some(errors) = r.json["errors"].as_array().filter(|e| !e.is_empty()) {
        let has = |t: &str| errors.iter().any(|e| e["type"].as_str() == Some(t));
        if has("NOT_FOUND") {
            return Err("pull_not_found".into());
        }
        let text = message(&r.json["errors"]);
        if has("FORBIDDEN") || has("INSUFFICIENT_SCOPES") || text.contains("permission") || text.contains("not authorized") {
            return Err("pull_forbidden".into());
        }
        return Err("provider_error".into());
    }
    Ok(r.json["data"].clone())
}

/// Personne GraphQL (`login avatarUrl name databaseId`).
fn gh_person(v: &Value) -> Option<Person> {
    let login = text(v, "login")?;
    Some(Person { id: v["databaseId"].as_u64().unwrap_or(0), login, name: text(v, "name"), avatar: text(v, "avatarUrl") })
}

fn gh_people(v: &Value) -> Vec<Person> {
    v["nodes"].as_array().map(|n| n.iter().filter_map(gh_person).collect()).unwrap_or_default()
}

fn gh_checks_state(rollup: &str) -> Option<String> {
    Some(
        match rollup {
            "SUCCESS" => "success",
            "FAILURE" | "ERROR" => "failure",
            "PENDING" | "EXPECTED" => "pending",
            _ => return None,
        }
        .into(),
    )
}

/// État d'un pipeline / job GitLab ramené aux valeurs communes.
fn gl_status(s: &str) -> String {
    match s {
        "success" => "success",
        "failed" => "failure",
        "running" | "pending" | "created" | "waiting_for_resource" | "preparing" | "scheduled" | "waiting_for_callback" => "pending",
        _ => "neutral",
    }
    .into()
}

// ---------------------------------------------------------------------------
// GitHub : lecture
// ---------------------------------------------------------------------------

const GH_FRAGMENTS: &str = r#"
fragment A on Actor { login avatarUrl ... on User { name databaseId } ... on Bot { databaseId } }
fragment P on PullRequest {
  number title url isDraft state createdAt updatedAt isCrossRepository
  headRefName headRefOid baseRefName
  author { ...A }
  reviewDecision
  reviewRequests(first: 20) { nodes { requestedReviewer { ... on User { ...A } ... on Bot { ...A } } } }
  assignees(first: 10) { nodes { ...A } }
  labels(first: 20) { nodes { name color description } }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
}"#;

fn gh_summary(v: &Value) -> Option<PullSummary> {
    let state = match v["state"].as_str()? {
        "MERGED" => "merged",
        "CLOSED" => "closed",
        _ if v["isDraft"].as_bool() == Some(true) => "draft",
        _ => "open",
    };
    let review = v["reviewDecision"].as_str().and_then(|d| match d {
        "APPROVED" => Some("approved".to_string()),
        "CHANGES_REQUESTED" => Some("changes".into()),
        "REVIEW_REQUIRED" => Some("required".into()),
        _ => None,
    });
    let rollup = v["commits"]["nodes"][0]["commit"]["statusCheckRollup"]["state"].as_str().unwrap_or("");
    let reviewers = v["reviewRequests"]["nodes"].as_array().map(|n| n.iter().filter_map(|r| gh_person(&r["requestedReviewer"])).collect()).unwrap_or_default();
    let labels = v["labels"]["nodes"].as_array().map(|n| n.iter().filter_map(parse_label).collect()).unwrap_or_default();
    Some(PullSummary {
        number: v["number"].as_u64()?,
        title: v["title"].as_str().unwrap_or_default().into(),
        url: v["url"].as_str().unwrap_or_default().into(),
        state: state.into(),
        author: gh_person(&v["author"]),
        source_branch: v["headRefName"].as_str().unwrap_or_default().into(),
        fork: v["isCrossRepository"].as_bool().unwrap_or(false),
        target_branch: v["baseRefName"].as_str().unwrap_or_default().into(),
        head_sha: text(v, "headRefOid"),
        created_at: time_of(&v["createdAt"]),
        updated_at: time_of(&v["updatedAt"]),
        review,
        checks: gh_checks_state(rollup),
        reviewers,
        assignees: gh_people(&v["assignees"]),
        labels,
    })
}

fn github_list(api: &str, token: &str, repo: &str) -> Result<PullList, String> {
    let (owner, name) = github_repo(repo)?;
    let query = format!(
        "query($owner: String!, $name: String!) {{ repository(owner: $owner, name: $name) {{ pullRequests(states: OPEN, first: 100, orderBy: {{ field: UPDATED_AT, direction: DESC }}) {{ pageInfo {{ hasNextPage }} nodes {{ ...P }} }} }} }}{GH_FRAGMENTS}"
    );
    let data = graphql(api, token, &query, json!({ "owner": owner, "name": name }))?;
    let prs = &data["repository"]["pullRequests"];
    if data["repository"].is_null() {
        return Err("pull_repo_not_found".into());
    }
    let pulls = prs["nodes"].as_array().map(|n| n.iter().filter_map(gh_summary).collect()).unwrap_or_default();
    Ok(PullList { pulls, fetched_at: now(), truncated: prs["pageInfo"]["hasNextPage"].as_bool().unwrap_or(false) })
}

fn github_detail(api: &str, token: &str, repo: &str, number: u64) -> Result<PullDetail, String> {
    let (owner, name) = github_repo(repo)?;
    let query = format!(
        r#"query($owner: String!, $name: String!, $number: Int!) {{ repository(owner: $owner, name: $name) {{
  mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed deleteBranchOnMerge autoMergeAllowed
  pullRequest(number: $number) {{
    ...P body mergeable mergeStateStatus viewerCanUpdate
    autoMergeRequest {{ enabledAt }}
    reviews(last: 100) {{ nodes {{ id state submittedAt body author {{ ...A }} }} }}
    comments(first: 100) {{ nodes {{ id body createdAt author {{ ...A }} }} }}
    reviewThreads(first: 100) {{ nodes {{ id isResolved path line originalLine comments(first: 50) {{ nodes {{ id body createdAt author {{ ...A }} }} }} }} }}
    lastCommit: commits(last: 1) {{ nodes {{ commit {{ statusCheckRollup {{ state contexts(first: 100) {{ nodes {{
      __typename
      ... on CheckRun {{ name status conclusion detailsUrl checkSuite {{ workflowRun {{ databaseId }} }} }}
      ... on StatusContext {{ context state targetUrl }}
    }} }} }} }} }} }}
  }}
}} }}{GH_FRAGMENTS}"#
    );
    let data = graphql(api, token, &query, json!({ "owner": owner, "name": name, "number": number }))?;
    let r = &data["repository"];
    let v = &r["pullRequest"];
    if v.is_null() {
        return Err("pull_not_found".into());
    }
    let pull = gh_summary(v).ok_or("provider_unexpected")?;

    // Relectures : la dernière qui compte par personne (un simple commentaire ne remplace pas
    // une approbation ou une demande de changements), puis celles encore attendues.
    let mut reviews: Vec<Review> = Vec::new();
    let mut general: Vec<Thread> = Vec::new();
    for rv in v["reviews"]["nodes"].as_array().into_iter().flatten() {
        let Some(author) = gh_person(&rv["author"]) else { continue };
        let at = rv["submittedAt"].as_str().and_then(iso_time);
        let state = match rv["state"].as_str().unwrap_or("") {
            "APPROVED" => "approved",
            "CHANGES_REQUESTED" => "changes",
            "COMMENTED" => "commented",
            "DISMISSED" => "commented",
            _ => continue, // PENDING : brouillon de relecture, invisible des autres.
        };
        let body = rv["body"].as_str().unwrap_or("").trim();
        if !body.is_empty() {
            let id = rv["id"].as_str().unwrap_or_default().to_string();
            general.push(Thread {
                id: id.clone(),
                resolvable: false,
                resolved: false,
                replyable: false,
                path: None,
                line: None,
                comments: vec![Comment { id, author: Some(author.clone()), body: body.into(), at: at.unwrap_or(0) }],
            });
        }
        match reviews.iter_mut().find(|x| x.author.login.eq_ignore_ascii_case(&author.login)) {
            Some(x) if state == "commented" && x.state != "commented" => {}
            Some(x) => {
                x.state = state.into();
                x.at = at;
            }
            None => reviews.push(Review { author, state: state.into(), at }),
        }
    }
    for p in &pull.reviewers {
        match reviews.iter_mut().find(|x| x.author.login.eq_ignore_ascii_case(&p.login)) {
            // Relecture demandée à nouveau : attendue.
            Some(x) => x.state = "pending".into(),
            None => reviews.push(Review { author: p.clone(), state: "pending".into(), at: None }),
        }
    }

    let comment = |c: &Value| Comment {
        id: c["id"].as_str().unwrap_or_default().into(),
        author: gh_person(&c["author"]),
        body: c["body"].as_str().unwrap_or_default().into(),
        at: time_of(&c["createdAt"]),
    };
    for c in v["comments"]["nodes"].as_array().into_iter().flatten() {
        let c = comment(c);
        general.push(Thread { id: c.id.clone(), resolvable: false, resolved: false, replyable: false, path: None, line: None, comments: vec![c] });
    }
    let mut threads: Vec<Thread> = v["reviewThreads"]["nodes"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|t| Thread {
            id: t["id"].as_str().unwrap_or_default().into(),
            resolvable: true,
            resolved: t["isResolved"].as_bool().unwrap_or(false),
            replyable: true,
            path: text(t, "path"),
            line: t["line"].as_u64().or(t["originalLine"].as_u64()).map(|n| n as u32),
            comments: t["comments"]["nodes"].as_array().into_iter().flatten().map(comment).collect(),
        })
        .filter(|t| !t.comments.is_empty())
        .collect();
    threads.extend(general);
    threads.sort_by_key(|t| t.comments.first().map_or(0, |c| c.at));

    let contexts = &v["lastCommit"]["nodes"][0]["commit"]["statusCheckRollup"]["contexts"]["nodes"];
    let checks_list: Vec<Check> = contexts
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|c| {
            if c["__typename"] == "CheckRun" {
                let state = match (c["status"].as_str().unwrap_or(""), c["conclusion"].as_str().unwrap_or("")) {
                    ("COMPLETED", "SUCCESS") => "success",
                    ("COMPLETED", "FAILURE" | "TIMED_OUT" | "STARTUP_FAILURE" | "ACTION_REQUIRED") => "failure",
                    ("COMPLETED", _) => "neutral",
                    _ => "pending",
                };
                Some(Check { name: text(c, "name")?, state: state.into(), url: text(c, "detailsUrl") })
            } else {
                let state = match c["state"].as_str().unwrap_or("") {
                    "SUCCESS" => "success",
                    "FAILURE" | "ERROR" => "failure",
                    _ => "pending",
                };
                Some(Check { name: text(c, "context")?, state: state.into(), url: text(c, "targetUrl") })
            }
        })
        .collect();

    // Exécutions GitHub Actions ayant un job en échec (relançables).
    let mut retry: Vec<u64> = Vec::new();
    for c in contexts.as_array().into_iter().flatten() {
        let failed = c["__typename"] == "CheckRun" && c["status"] == "COMPLETED" && matches!(c["conclusion"].as_str(), Some("FAILURE" | "TIMED_OUT" | "STARTUP_FAILURE" | "CANCELLED"));
        if let Some(id) = c["checkSuite"]["workflowRun"]["databaseId"].as_u64().filter(|_| failed)
            && !retry.contains(&id)
        {
            retry.push(id);
        }
    }

    // Merge : ce qui le bloque, d'après GitHub.
    let mut blockers: Vec<&str> = Vec::new();
    let status = v["mergeStateStatus"].as_str().unwrap_or("UNKNOWN");
    let unresolved = threads.iter().any(|t| t.resolvable && !t.resolved);
    if pull.state == "merged" || pull.state == "closed" {
        blockers.push("not_open");
    } else if pull.state == "draft" {
        blockers.push("draft");
    } else if v["mergeable"] == "CONFLICTING" || status == "DIRTY" {
        blockers.push("conflicts");
    } else {
        match status {
            "BEHIND" => blockers.push("behind"),
            "BLOCKED" => {
                match pull.review.as_deref() {
                    Some("changes") => blockers.push("changes"),
                    Some("required") => blockers.push("approvals"),
                    _ => {}
                }
                match pull.checks.as_deref() {
                    Some("failure") => blockers.push("checks"),
                    Some("pending") => blockers.push("checks_pending"),
                    _ => {}
                }
                if blockers.is_empty() && unresolved {
                    blockers.push("threads");
                }
                if blockers.is_empty() {
                    blockers.push("blocked");
                }
            }
            "UNKNOWN" => blockers.push("checking"),
            _ => {}
        }
    }
    let can_update = v["viewerCanUpdate"].as_bool().unwrap_or(false);
    if !can_update && !blockers.contains(&"not_open") {
        blockers.push("forbidden");
    }
    let mut methods = Vec::new();
    for (key, m) in [("mergeCommitAllowed", "merge"), ("squashMergeAllowed", "squash"), ("rebaseMergeAllowed", "rebase")] {
        if r[key].as_bool().unwrap_or(false) {
            methods.push(m.to_string());
        }
    }
    let auto_merge = r["autoMergeAllowed"].as_bool().unwrap_or(false).then(|| !v["autoMergeRequest"].is_null());
    Ok(PullDetail {
        body: v["body"].as_str().unwrap_or_default().into(),
        reviews,
        threads,
        checks_list,
        merge: MergeInfo {
            can_merge: blockers.is_empty(),
            blockers: blockers.into_iter().map(str::to_string).collect(),
            methods,
            delete_branch: r["deleteBranchOnMerge"].as_bool().unwrap_or(false) && !pull.fork,
            auto_merge,
        },
        can_update,
        retry,
        pull,
    })
}

// ---------------------------------------------------------------------------
// GitLab : lecture
// ---------------------------------------------------------------------------

fn gl_people(v: &Value) -> Vec<Person> {
    v.as_array().map(|a| a.iter().filter_map(|x| parse_person(Kind::GitLab, x)).collect()).unwrap_or_default()
}

fn gl_summary(v: &Value, checks: Option<String>) -> Option<PullSummary> {
    let draft = v["draft"].as_bool().or(v["work_in_progress"].as_bool()).unwrap_or(false);
    let state = match v["state"].as_str()? {
        "merged" => "merged",
        "closed" | "locked" => "closed",
        _ if draft => "draft",
        _ => "open",
    };
    let review = match v["detailed_merge_status"].as_str().unwrap_or("") {
        "not_approved" => Some("required".to_string()),
        "requested_changes" => Some("changes".into()),
        _ => None,
    };
    let labels = v["labels"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|l| match l {
                    Value::String(s) => Some(Label { name: s.clone(), color: None, description: None }),
                    _ => parse_label(l),
                })
                .collect()
        })
        .unwrap_or_default();
    Some(PullSummary {
        number: v["iid"].as_u64()?,
        title: v["title"].as_str().unwrap_or_default().into(),
        url: v["web_url"].as_str().unwrap_or_default().into(),
        state: state.into(),
        author: parse_person(Kind::GitLab, &v["author"]),
        source_branch: v["source_branch"].as_str().unwrap_or_default().into(),
        fork: v["source_project_id"].as_u64().is_some() && v["source_project_id"] != v["target_project_id"],
        target_branch: v["target_branch"].as_str().unwrap_or_default().into(),
        head_sha: text(v, "sha"),
        created_at: time_of(&v["created_at"]),
        updated_at: time_of(&v["updated_at"]),
        review,
        checks,
        reviewers: gl_people(&v["reviewers"]),
        assignees: gl_people(&v["assignees"]),
        labels,
    })
}

fn get_ok(kind: Kind, api: &str, path: &str, token: &str) -> Result<Value, String> {
    let r = request(kind, api, path, token, Method::Get)?;
    if !(200..300).contains(&r.status) {
        return Err(refused(r.status));
    }
    Ok(r.json)
}

fn gitlab_list(api: &str, token: &str, repo: &str) -> Result<PullList, String> {
    check_repo(repo)?;
    let base = project(Kind::GitLab, repo);
    let list = get_ok(Kind::GitLab, api, &format!("{base}/merge_requests?state=opened&per_page=100&order_by=updated_at&with_labels_details=true"), token)?;
    let items = list.as_array().cloned().ok_or("provider_unexpected")?;
    // État du dernier pipeline de chaque commit de tête (une requête pour toute la liste) ; une
    // erreur (pipelines désactivés, droits) n'empêche pas la liste.
    let pipelines = get_ok(Kind::GitLab, api, &format!("{base}/pipelines?per_page=100&order_by=id&sort=desc"), token).unwrap_or(Value::Null);
    let status_of = |sha: &str| {
        pipelines.as_array().and_then(|p| p.iter().find(|x| x["sha"].as_str() == Some(sha))).and_then(|x| x["status"].as_str()).map(gl_status)
    };
    let pulls = items.iter().filter_map(|v| gl_summary(v, v["sha"].as_str().and_then(status_of))).collect();
    Ok(PullList { pulls, fetched_at: now(), truncated: items.len() >= 100 })
}

fn gitlab_detail(api: &str, token: &str, repo: &str, number: u64) -> Result<PullDetail, String> {
    check_repo(repo)?;
    let kind = Kind::GitLab;
    let base = format!("{}/merge_requests/{number}", project(kind, repo));
    let mr = match request(kind, api, &format!("{base}?with_labels_details=true"), token, Method::Get)? {
        r if r.status == 404 => return Err("pull_not_found".into()),
        r if !(200..300).contains(&r.status) => return Err(refused(r.status)),
        r => r.json,
    };
    let proj = get_ok(kind, api, &project(kind, repo), token).unwrap_or(Value::Null);
    let pipeline = &mr["head_pipeline"];
    let checks = pipeline["status"].as_str().map(gl_status);
    let pull = gl_summary(&mr, checks).ok_or("provider_unexpected")?;

    // Relecteurs et leur état (GitLab 16+ : `/reviewers`), approbations sinon.
    let mut reviews: Vec<Review> = Vec::new();
    if let Ok(list) = get_ok(kind, api, &format!("{base}/reviewers"), token) {
        for r in list.as_array().into_iter().flatten() {
            let Some(author) = parse_person(kind, &r["user"]) else { continue };
            let state = match r["state"].as_str().unwrap_or("") {
                "approved" => "approved",
                "requested_changes" => "changes",
                "reviewed" => "commented",
                _ => "pending",
            };
            reviews.push(Review { author, state: state.into(), at: None });
        }
    }
    if let Ok(approvals) = get_ok(kind, api, &format!("{base}/approvals"), token) {
        for a in approvals["approved_by"].as_array().into_iter().flatten() {
            let Some(author) = parse_person(kind, &a["user"]) else { continue };
            match reviews.iter_mut().find(|x| x.author.id == author.id) {
                Some(x) => x.state = "approved".into(),
                None => reviews.push(Review { author, state: "approved".into(), at: None }),
            }
        }
    }
    if reviews.is_empty() {
        reviews = pull.reviewers.iter().map(|p| Review { author: p.clone(), state: "pending".into(), at: None }).collect();
    }

    let discussions = get_ok(kind, api, &format!("{base}/discussions?per_page=100"), token).unwrap_or(Value::Null);
    let threads: Vec<Thread> = discussions
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|d| {
            let notes: Vec<&Value> = d["notes"].as_array()?.iter().filter(|n| n["system"].as_bool() != Some(true)).collect();
            let first = *notes.first()?;
            let pos = &first["position"];
            Some(Thread {
                id: d["id"].as_str()?.into(),
                resolvable: first["resolvable"].as_bool().unwrap_or(false),
                resolved: first["resolved"].as_bool().unwrap_or(false),
                replyable: d["individual_note"].as_bool() != Some(true) || first["resolvable"].as_bool() == Some(true),
                path: text(pos, "new_path").or_else(|| text(pos, "old_path")),
                line: pos["new_line"].as_u64().or(pos["old_line"].as_u64()).map(|n| n as u32),
                comments: notes
                    .iter()
                    .map(|n| Comment {
                        id: n["id"].as_u64().map(|i| i.to_string()).unwrap_or_default(),
                        author: parse_person(kind, &n["author"]),
                        body: n["body"].as_str().unwrap_or_default().into(),
                        at: time_of(&n["created_at"]),
                    })
                    .collect(),
            })
        })
        .collect();

    let checks_list = match pipeline["id"].as_u64() {
        Some(id) => get_ok(kind, api, &format!("{}/pipelines/{id}/jobs?per_page=100", project(kind, repo)), token)
            .unwrap_or(Value::Null)
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|j| Some(Check { name: text(j, "name")?, state: gl_status(j["status"].as_str().unwrap_or("")), url: text(j, "web_url") }))
            .collect(),
        None => Vec::new(),
    };

    let checks_failed = checks_list.iter().any(|c| c.state == "failure") || pipeline["status"] == "failed";
    let mut blockers: Vec<&str> = Vec::new();
    if pull.state == "merged" || pull.state == "closed" {
        blockers.push("not_open");
    } else {
        let b = match mr["detailed_merge_status"].as_str().unwrap_or("") {
            "mergeable" => None,
            "not_approved" => Some("approvals"),
            "requested_changes" => Some("changes"),
            "ci_must_pass" => Some("checks"),
            "ci_still_running" => Some("checks_pending"),
            "discussions_not_resolved" => Some("threads"),
            "draft_status" => Some("draft"),
            "conflict" => Some("conflicts"),
            "need_rebase" => Some("behind"),
            "not_open" => Some("not_open"),
            "checking" | "unchecked" | "preparing" | "approvals_syncing" => Some("checking"),
            // GitLab avant 15.6 : pas de `detailed_merge_status`, seulement `merge_status`.
            "" if pull.state == "draft" => Some("draft"),
            "" if mr["has_conflicts"].as_bool() == Some(true) => Some("conflicts"),
            "" => match mr["merge_status"].as_str().unwrap_or("") {
                "can_be_merged" => None,
                "cannot_be_merged" | "cannot_be_merged_recheck" => Some("conflicts"),
                _ => Some("checking"),
            },
            _ => Some("blocked"),
        };
        blockers.extend(b);
    }
    let can_merge_user = mr["user"]["can_merge"].as_bool().unwrap_or(false);
    if !can_merge_user && !blockers.contains(&"not_open") {
        blockers.push("forbidden");
    }
    let methods: Vec<String> = match proj["squash_option"].as_str().unwrap_or("default_off") {
        "never" => vec!["merge".into()],
        "always" => vec!["squash".into()],
        "default_on" => vec!["squash".into(), "merge".into()],
        _ => vec!["merge".into(), "squash".into()],
    };
    // Merge quand le pipeline passe : seulement pendant un pipeline en cours.
    let auto_merge = blockers.iter().all(|b| *b == "checks_pending").then(|| mr["merge_when_pipeline_succeeds"].as_bool().unwrap_or(false)).filter(|_| pull.checks.as_deref() == Some("pending"));
    Ok(PullDetail {
        body: mr["description"].as_str().unwrap_or_default().into(),
        reviews,
        threads,
        checks_list,
        merge: MergeInfo {
            can_merge: blockers.is_empty(),
            blockers: blockers.into_iter().map(str::to_string).collect(),
            methods,
            delete_branch: mr["force_remove_source_branch"].as_bool().or(proj["remove_source_branch_after_merge"].as_bool()).unwrap_or(false),
            auto_merge,
        },
        can_update: can_merge_user,
        retry: pipeline["id"].as_u64().filter(|_| checks_failed).into_iter().collect(),
        pull,
    })
}

// ---------------------------------------------------------------------------
// Points d'entrée
// ---------------------------------------------------------------------------

/// PR / MR ouvertes du dépôt `repo`, les plus récemment mises à jour d'abord (100 au plus).
pub fn list(kind: Kind, api: &str, token: &str, repo: &str) -> Result<PullList, String> {
    match kind {
        Kind::GitHub => github_list(api, token, repo),
        Kind::GitLab => gitlab_list(api, token, repo),
    }
}

pub fn detail(kind: Kind, api: &str, token: &str, repo: &str, number: u64) -> Result<PullDetail, String> {
    match kind {
        Kind::GitHub => github_detail(api, token, repo, number),
        Kind::GitLab => gitlab_detail(api, token, repo, number),
    }
}

fn check_body(body: &str) -> Result<&str, String> {
    let b = body.trim();
    if b.is_empty() {
        return Err("comment_empty".into());
    }
    Ok(b)
}

/// Erreur d'une action refusée : merge impossible, branche changée entre-temps…
fn action_refused(status: u16, merging: bool) -> String {
    match status {
        405 | 406 | 422 if merging => "pull_not_mergeable".into(),
        409 => "pull_head_changed".into(),
        404 => "pull_not_found".into(),
        s => refused(s),
    }
}

fn send(kind: Kind, api: &str, token: &str, path: &str, method: Method, merging: bool) -> Result<Value, String> {
    let r = request(kind, api, path, token, method)?;
    if !(200..300).contains(&r.status) {
        return Err(action_refused(r.status, merging));
    }
    Ok(r.json)
}

/// Identifiant GraphQL de la PR, et sa branche (pour la supprimer après le merge).
fn github_node(api: &str, token: &str, repo: &str, number: u64) -> Result<(String, String, bool), String> {
    let (owner, name) = github_repo(repo)?;
    let data = graphql(
        api,
        token,
        "query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $number) { id headRefName isCrossRepository } } }",
        json!({ "owner": owner, "name": name, "number": number }),
    )?;
    let pr = &data["repository"]["pullRequest"];
    Ok((text(pr, "id").ok_or("pull_not_found")?, pr["headRefName"].as_str().unwrap_or_default().into(), pr["isCrossRepository"].as_bool().unwrap_or(false)))
}

fn github_action(api: &str, token: &str, repo: &str, number: u64, action: &PullAction) -> Result<(), String> {
    let kind = Kind::GitHub;
    github_repo(repo)?;
    let base = project(kind, repo);
    let mutation = |query: &str, input: Value| graphql(api, token, query, json!({ "input": input })).map(|_| ());
    match action {
        PullAction::Comment { body } => send(kind, api, token, &format!("{base}/issues/{number}/comments"), Method::Post(&json!({ "body": check_body(body)? })), false).map(|_| ()),
        PullAction::Reply { thread, body } => mutation(
            "mutation($input: AddPullRequestReviewThreadReplyInput!) { addPullRequestReviewThreadReply(input: $input) { clientMutationId } }",
            json!({ "pullRequestReviewThreadId": thread, "body": check_body(body)? }),
        ),
        PullAction::Resolve { thread, resolved } => {
            let q = if *resolved {
                "mutation($input: ResolveReviewThreadInput!) { resolveReviewThread(input: $input) { clientMutationId } }"
            } else {
                "mutation($input: UnresolveReviewThreadInput!) { unresolveReviewThread(input: $input) { clientMutationId } }"
            };
            mutation(q, json!({ "threadId": thread }))
        }
        PullAction::Review { event, body } => {
            let event = match event.as_str() {
                "approve" => "APPROVE",
                "changes" => "REQUEST_CHANGES",
                "comment" => "COMMENT",
                _ => return Err("review_invalid".into()),
            };
            // Commentaire ou demande de changements : un texte est exigé.
            let body = if event == "APPROVE" { body.trim() } else { check_body(body)? };
            let r = request(kind, api, &format!("{base}/pulls/{number}/reviews"), token, Method::Post(&json!({ "event": event, "body": body })))?;
            match r.status {
                200..=299 => Ok(()),
                422 if message(&r.json).contains("own pull request") => Err("review_own_pull".into()),
                s => Err(action_refused(s, false)),
            }
        }
        PullAction::Unapprove => Err("review_invalid".into()),
        PullAction::SetOpen { open } => send(kind, api, token, &format!("{base}/pulls/{number}"), Method::Patch(&json!({ "state": if *open { "open" } else { "closed" } })), false).map(|_| ()),
        PullAction::SetDraft { draft } => {
            let (id, _, _) = github_node(api, token, repo, number)?;
            let q = if *draft {
                "mutation($input: ConvertPullRequestToDraftInput!) { convertPullRequestToDraft(input: $input) { clientMutationId } }"
            } else {
                "mutation($input: MarkPullRequestReadyForReviewInput!) { markPullRequestReadyForReview(input: $input) { clientMutationId } }"
            };
            mutation(q, json!({ "pullRequestId": id }))
        }
        PullAction::Merge { method, delete_branch, auto } => {
            if !["merge", "squash", "rebase"].contains(&method.as_str()) {
                return Err("merge_method_invalid".into());
            }
            let (id, branch, fork) = github_node(api, token, repo, number)?;
            if *auto {
                return mutation(
                    "mutation($input: EnablePullRequestAutoMergeInput!) { enablePullRequestAutoMerge(input: $input) { clientMutationId } }",
                    json!({ "pullRequestId": id, "mergeMethod": method.to_uppercase() }),
                );
            }
            send(kind, api, token, &format!("{base}/pulls/{number}/merge"), Method::Put(&json!({ "merge_method": method })), true)?;
            if *delete_branch && !fork && !branch.is_empty() {
                // Échec sans conséquence (branche protégée, déjà supprimée par le dépôt) : la PR est fusionnée.
                let path = branch.split('/').map(enc).collect::<Vec<_>>().join("/");
                let _ = request(kind, api, &format!("{base}/git/refs/heads/{path}"), token, Method::Delete);
            }
            Ok(())
        }
        PullAction::Edit { title, body, reviewers, assignees, labels } => {
            let title = title.trim();
            if title.is_empty() {
                return Err("pull_title_missing".into());
            }
            let logins = |people: &[Person]| people.iter().map(|x| x.login.clone()).collect::<Vec<_>>();
            send(kind, api, token, &format!("{base}/pulls/{number}"), Method::Patch(&json!({ "title": title, "body": body })), false)?;
            send(kind, api, token, &format!("{base}/issues/{number}"), Method::Patch(&json!({ "assignees": logins(assignees), "labels": labels })), false)?;
            // Relecteurs : ceux à ajouter et ceux à retirer par rapport aux demandes en cours.
            let current = send(kind, api, token, &format!("{base}/pulls/{number}"), Method::Get, false)?;
            let now: Vec<String> = current["requested_reviewers"].as_array().into_iter().flatten().filter_map(|r| r["login"].as_str().map(str::to_lowercase)).collect();
            let wanted: Vec<String> = reviewers.iter().map(|r| r.login.to_lowercase()).collect();
            let add: Vec<String> = reviewers.iter().filter(|r| !now.contains(&r.login.to_lowercase())).map(|r| r.login.clone()).collect();
            let remove: Vec<String> = current["requested_reviewers"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|r| r["login"].as_str())
                .filter(|l| !wanted.contains(&l.to_lowercase()))
                .map(str::to_string)
                .collect();
            let path = format!("{base}/pulls/{number}/requested_reviewers");
            if !add.is_empty() {
                send(kind, api, token, &path, Method::Post(&json!({ "reviewers": add })), false).map_err(|_| "pull_edit_reviewers_failed".to_string())?;
            }
            if !remove.is_empty() {
                send(kind, api, token, &path, Method::DeleteWith(&json!({ "reviewers": remove })), false).map_err(|_| "pull_edit_reviewers_failed".to_string())?;
            }
            Ok(())
        }
        PullAction::UpdateBranch => send(kind, api, token, &format!("{base}/pulls/{number}/update-branch"), Method::Put(&json!({})), false).map(|_| ()),
        PullAction::RetryFailed { runs } => {
            for run in runs {
                send(kind, api, token, &format!("{base}/actions/runs/{run}/rerun-failed-jobs"), Method::Post(&json!({})), false)?;
            }
            Ok(())
        }
    }
}

fn gitlab_action(api: &str, token: &str, repo: &str, number: u64, action: &PullAction) -> Result<(), String> {
    let kind = Kind::GitLab;
    check_repo(repo)?;
    let base = format!("{}/merge_requests/{number}", project(kind, repo));
    let thread_id = |t: &str| -> Result<String, String> {
        if t.is_empty() || !t.bytes().all(|b| b.is_ascii_alphanumeric()) {
            return Err("thread_invalid".into());
        }
        Ok(t.to_string())
    };
    let post = |path: String, body: Value| send(kind, api, token, &path, Method::Post(&body), false).map(|_| ());
    match action {
        PullAction::Comment { body } => post(format!("{base}/notes"), json!({ "body": check_body(body)? })),
        PullAction::Reply { thread, body } => post(format!("{base}/discussions/{}/notes", thread_id(thread)?), json!({ "body": check_body(body)? })),
        PullAction::Resolve { thread, resolved } => {
            send(kind, api, token, &format!("{base}/discussions/{}?resolved={resolved}", thread_id(thread)?), Method::Put(&json!({ "resolved": resolved })), false).map(|_| ())
        }
        PullAction::Review { event, body } => match event.as_str() {
            "approve" => {
                post(format!("{base}/approve"), json!({}))?;
                if !body.trim().is_empty() {
                    post(format!("{base}/notes"), json!({ "body": body.trim() }))?;
                }
                Ok(())
            }
            "comment" => post(format!("{base}/notes"), json!({ "body": check_body(body)? })),
            // Pas de demande de changements dans l'API REST de GitLab.
            _ => Err("review_invalid".into()),
        },
        PullAction::Unapprove => post(format!("{base}/unapprove"), json!({})),
        PullAction::SetOpen { open } => send(kind, api, token, &base, Method::Put(&json!({ "state_event": if *open { "reopen" } else { "close" } })), false).map(|_| ()),
        PullAction::SetDraft { draft } => {
            let mr = get_ok(kind, api, &base, token)?;
            let title = mr["title"].as_str().unwrap_or_default();
            let bare = draft_prefix(title).map_or(title, |n| &title[n..]).trim_start();
            let title = if *draft { format!("Draft: {bare}") } else { bare.to_string() };
            send(kind, api, token, &base, Method::Put(&json!({ "title": title })), false).map(|_| ())
        }
        PullAction::Merge { method, delete_branch, auto } => {
            if !["merge", "squash"].contains(&method.as_str()) {
                return Err("merge_method_invalid".into());
            }
            let body = json!({ "squash": method == "squash", "should_remove_source_branch": delete_branch, "merge_when_pipeline_succeeds": auto });
            send(kind, api, token, &format!("{base}/merge"), Method::Put(&body), true).map(|_| ())
        }
        PullAction::UpdateBranch => send(kind, api, token, &format!("{base}/rebase"), Method::Put(&json!({})), false).map(|_| ()),
        PullAction::RetryFailed { runs } => {
            let project = project(kind, repo);
            for run in runs {
                send(kind, api, token, &format!("{project}/pipelines/{run}/retry"), Method::Post(&json!({})), false)?;
            }
            Ok(())
        }
        PullAction::Edit { title, body, reviewers, assignees, labels } => {
            let title = title.trim();
            if title.is_empty() {
                return Err("pull_title_missing".into());
            }
            // Liste vide : `[0]` retire tout le monde (une liste vide n'est pas comprise partout).
            let ids = |people: &[Person]| if people.is_empty() { vec![0] } else { people.iter().map(|x| x.id).collect::<Vec<_>>() };
            let edit = json!({ "title": title, "description": body, "assignee_ids": ids(assignees), "reviewer_ids": ids(reviewers), "labels": labels.join(",") });
            send(kind, api, token, &base, Method::Put(&edit), false).map(|_| ())
        }    }
}

/// Longueur du préfixe de brouillon d'un titre GitLab (`Draft:`, `[Draft]`, `(Draft)`, `WIP:`).
fn draft_prefix(title: &str) -> Option<usize> {
    let lower = title.to_lowercase();
    ["draft:", "[draft]", "(draft)", "wip:", "[wip]"].iter().find(|p| lower.starts_with(*p)).map(|p| p.len())
}

pub fn act(kind: Kind, api: &str, token: &str, repo: &str, number: u64, action: &PullAction) -> Result<(), String> {
    match kind {
        Kind::GitHub => github_action(api, token, repo, number, action),
        Kind::GitLab => gitlab_action(api, token, repo, number, action),
    }
}

// ---------------------------------------------------------------------------
// Fichiers et diff, en local
// ---------------------------------------------------------------------------

fn check_sha(sha: &str) -> Result<(), String> {
    if sha.len() < 7 || sha.len() > 64 || !sha.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("invalid_sha".into());
    }
    Ok(())
}

fn has_commit(path: &Path, sha: &str) -> bool {
    run(Some(path), &["cat-file", "-e", &format!("{sha}^{{commit}}")]).is_ok()
}

/// Référence de la tête d'une PR / MR sur le serveur.
fn head_ref(kind: Kind, number: u64) -> String {
    match kind {
        Kind::GitHub => format!("refs/pull/{number}/head"),
        Kind::GitLab => format!("refs/merge-requests/{number}/head"),
    }
}

/// S'assure que le commit de tête `sha` est là (PR d'un fork, branche pas encore récupérée) :
/// sinon il est récupéré depuis `remote` par la référence de la PR / MR, sans créer de branche.
pub fn ensure_head(path: &Path, remote: &str, kind: Kind, number: u64, sha: &str) -> Result<(), String> {
    crate::history::check_dir(path)?;
    check_sha(sha)?;
    check_ref(remote)?;
    if has_commit(path, sha) {
        return Ok(());
    }
    run(Some(path), &["fetch", "-q", "--no-tags", remote, &head_ref(kind, number)]).map_err(|e| crate::branches::classify(&e))?;
    if has_commit(path, sha) { Ok(()) } else { Err("pull_head_missing".into()) }
}

/// Point de départ du diff : le dernier ancêtre commun de la cible et de la tête (ce que
/// montrent GitHub et GitLab).
fn merge_base(path: &Path, target: &str, head: &str) -> Result<String, String> {
    check_ref(target)?;
    check_sha(head)?;
    run(Some(path), &["merge-base", target, head]).map(|s| s.trim().to_string()).map_err(|_| "pull_base_missing".into())
}

/// Fichiers modifiés par la PR / MR : de l'ancêtre commun avec `target` (`origin/main`) à `head`.
pub fn files(path: &Path, target: &str, head: &str) -> Result<Vec<crate::history::FileChange>, String> {
    crate::history::check_dir(path)?;
    let base = merge_base(path, target, head)?;
    let raw = run_raw(Some(path), &["diff", "-M", "-z", "--name-status", "--no-ext-diff", &base, head, "--"])?;
    Ok(crate::history::parse_name_status(&raw))
}

/// Diff d'un fichier de la PR / MR (même point de départ que [`files`]).
pub fn file_diff(path: &Path, target: &str, head: &str, file: &str, old_file: Option<&str>, ignore_ws: bool, full: bool) -> Result<crate::history::FileDiff, String> {
    crate::history::check_dir(path)?;
    let base = merge_base(path, target, head)?;
    let mut args = vec!["--literal-pathspecs", "diff", "--no-color", "--no-ext-diff", "-M", "--unified=3"];
    crate::history::push_ws(&mut args, ignore_ws);
    crate::history::push_full(&mut args, full);
    args.extend([base.as_str(), head, "--"]);
    if let Some(old) = old_file {
        args.push(old);
    }
    args.push(file);
    Ok(crate::history::parse_diff(&run_raw(Some(path), &args)?))
}

/// Passe sur la branche d'une PR / MR. Même dépôt : la branche distante (`checkout_remote`) ;
/// fork : une branche locale `pr/<n>` (GitHub) ou `mr/<n>` (GitLab) tirée de la référence de
/// la PR / MR, sans suivi. Renvoie le nom de la branche locale.
pub fn checkout(path: &Path, remote: &str, kind: Kind, number: u64, branch: &str, fork: bool, auto_stash: bool) -> Result<(crate::branches::OpResult, String), String> {
    crate::history::check_dir(path)?;
    check_ref(remote)?;
    if !fork {
        check_ref(branch)?;
        let remote_branch = format!("{remote}/{branch}");
        // Pas encore récupérée : un fetch de cette seule branche.
        if run(Some(path), &["rev-parse", "-q", "--verify", &format!("refs/remotes/{remote_branch}")]).is_err() {
            run(Some(path), &["fetch", "-q", "--no-tags", remote, &format!("refs/heads/{branch}:refs/remotes/{remote_branch}")]).map_err(|e| crate::branches::classify(&e))?;
        }
        return crate::branches::checkout_remote(path, &remote_branch, auto_stash);
    }
    let local = format!("{}/{number}", if kind == Kind::GitLab { "mr" } else { "pr" });
    let current = run(Some(path), &["symbolic-ref", "-q", "--short", "HEAD"]).ok();
    if current.as_deref() != Some(local.as_str()) {
        // Avance rapide seulement : des commits locaux sur `pr/<n>` ne sont jamais écrasés.
        run(Some(path), &["fetch", "-q", "--no-tags", remote, &format!("{}:refs/heads/{local}", head_ref(kind, number))]).map_err(|e| crate::branches::classify(&e))?;
    }
    crate::branches::checkout(path, &local, auto_stash).map(|r| (r, local))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::tests::serve;

    #[test]
    fn iso_dates() {
        assert_eq!(iso_time("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(iso_time("2026-11-17T09:30:00Z"), Some(1_794_907_800));
        assert_eq!(iso_time("2026-11-17T10:30:00.123+01:00"), Some(1_794_907_800));
        assert_eq!(iso_time("2024-02-29T00:00:00-00:30"), Some(1_709_166_600));
        assert_eq!(iso_time("pas une date"), None);
    }

    #[test]
    fn graphql_endpoint_of_github_and_enterprise() {
        assert_eq!(graphql_api("https://api.github.com"), "https://api.github.com");
        assert_eq!(graphql_api("https://ghe.exemple.fr/api/v3"), "https://ghe.exemple.fr/api");
    }

    const GH_PR: &str = r#"{"number":12,"title":"Ajout","url":"https://github.com/o/r/pull/12","isDraft":false,"state":"OPEN",
      "createdAt":"2026-11-17T09:30:00Z","updatedAt":"2026-11-17T10:00:00Z","isCrossRepository":false,
      "headRefName":"feature/x","headRefOid":"abcdef1234567","baseRefName":"main",
      "author":{"login":"alix","avatarUrl":"https://avatars.githubusercontent.com/u/1?v=4","name":"Alix","databaseId":1},
      "reviewDecision":"REVIEW_REQUIRED",
      "reviewRequests":{"nodes":[{"requestedReviewer":{"login":"max","avatarUrl":"a","databaseId":2}},{"requestedReviewer":{}}]},
      "assignees":{"nodes":[{"login":"alix","databaseId":1}]},
      "labels":{"nodes":[{"name":"bug","color":"d73a4a"}]},
      "commits":{"nodes":[{"commit":{"statusCheckRollup":{"state":"PENDING"}}}]}}"#;

    #[test]
    fn github_list_is_read_in_one_graphql_request() {
        let body: &'static str = Box::leak(format!(r#"{{"data":{{"repository":{{"pullRequests":{{"pageInfo":{{"hasNextPage":true}},"nodes":[{GH_PR}]}}}}}}}}"#).into_boxed_str());
        let (url, requests) = serve(vec![(200, body)]);
        let list = list(Kind::GitHub, &url, "ghp_x", "o/r").unwrap();
        assert!(list.truncated);
        let p = &list.pulls[0];
        assert_eq!((p.number, p.state.as_str(), p.source_branch.as_str(), p.target_branch.as_str()), (12, "open", "feature/x", "main"));
        assert_eq!((p.review.as_deref(), p.checks.as_deref()), (Some("required"), Some("pending")));
        assert_eq!(p.reviewers.iter().map(|x| x.login.as_str()).collect::<Vec<_>>(), ["max"]);
        assert_eq!(p.author.as_ref().unwrap().avatar.as_deref(), Some("https://avatars.githubusercontent.com/u/1?v=4"));
        assert_eq!(p.labels[0].name, "bug");
        assert_eq!(p.created_at, 1_794_907_800);
        let req = requests.recv().unwrap();
        assert!(req.starts_with("POST /graphql "), "{req}");
        assert!(req.contains(r#""owner":"o""#) && req.contains(r#""name":"r""#), "{req}");
    }

    #[test]
    fn github_detail_merges_reviews_threads_and_checks() {
        let body: &'static str = Box::leak(
            format!(
                r#"{{"data":{{"repository":{{"mergeCommitAllowed":true,"squashMergeAllowed":true,"rebaseMergeAllowed":false,"deleteBranchOnMerge":true,"autoMergeAllowed":true,
          "pullRequest":{{"number":12,"title":"Ajout","url":"u","isDraft":false,"state":"OPEN","createdAt":"2026-11-17T09:30:00Z","updatedAt":"2026-11-17T09:30:00Z",
          "isCrossRepository":false,"headRefName":"feature/x","headRefOid":"abcdef1","baseRefName":"main","author":{{"login":"alix"}},
          "reviewDecision":"CHANGES_REQUESTED","reviewRequests":{{"nodes":[]}},"assignees":{{"nodes":[]}},"labels":{{"nodes":[]}},
          "commits":{{"nodes":[{{"commit":{{"statusCheckRollup":{{"state":"SUCCESS"}}}}}}]}},
          "body":"Corps","mergeable":"MERGEABLE","mergeStateStatus":"BLOCKED","viewerCanUpdate":true,"autoMergeRequest":null,
          "reviews":{{"nodes":[
            {{"id":"R1","state":"CHANGES_REQUESTED","submittedAt":"2026-11-17T10:00:00Z","body":"À revoir","author":{{"login":"max"}}}},
            {{"id":"R2","state":"COMMENTED","submittedAt":"2026-11-17T11:00:00Z","body":"","author":{{"login":"max"}}}},
            {{"id":"R3","state":"APPROVED","submittedAt":"2026-11-17T11:00:00Z","body":"","author":{{"login":"zoe"}}}}]}},
          "comments":{{"nodes":[{{"id":"C1","body":"Merci","createdAt":"2026-11-17T09:40:00Z","author":{{"login":"zoe"}}}}]}},
          "reviewThreads":{{"nodes":[{{"id":"T1","isResolved":false,"path":"src/a.rs","line":null,"originalLine":4,"comments":{{"nodes":[{{"id":"TC1","body":"Ici","createdAt":"2026-11-17T09:50:00Z","author":{{"login":"max"}}}}]}}}}]}},
          "lastCommit":{{"nodes":[{{"commit":{{"statusCheckRollup":{{"state":"SUCCESS","contexts":{{"nodes":[
            {{"__typename":"CheckRun","name":"build","status":"COMPLETED","conclusion":"SUCCESS","detailsUrl":"https://ci/1","checkSuite":{{"workflowRun":{{"databaseId":5}}}}}},
            {{"__typename":"CheckRun","name":"e2e","status":"COMPLETED","conclusion":"FAILURE","detailsUrl":null,"checkSuite":{{"workflowRun":{{"databaseId":6}}}}}},
            {{"__typename":"StatusContext","context":"lint","state":"PENDING","targetUrl":null}}]}}}}}}}}]}}}}}}}}}}"#
            )
            .into_boxed_str(),
        );
        let (url, _r) = serve(vec![(200, body)]);
        let d = detail(Kind::GitHub, &url, "ghp_x", "o/r", 12).unwrap();
        assert_eq!(d.body, "Corps");
        // max : la demande de changements reste (un commentaire ne la remplace pas) ; zoe : approuvé.
        assert_eq!(d.reviews.iter().map(|r| (r.author.login.as_str(), r.state.as_str())).collect::<Vec<_>>(), [("max", "changes"), ("zoe", "approved")]);
        // Fils triés par date : commentaire, fil sur le code, corps de la relecture.
        assert_eq!(d.threads.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(), ["C1", "T1", "R1"]);
        assert_eq!((d.threads[1].path.as_deref(), d.threads[1].line, d.threads[1].resolvable), (Some("src/a.rs"), Some(4), true));
        assert_eq!(d.checks_list.iter().map(|c| (c.name.as_str(), c.state.as_str())).collect::<Vec<_>>(), [("build", "success"), ("e2e", "failure"), ("lint", "pending")]);
        assert_eq!(d.retry, [6]);
        assert_eq!(d.merge.blockers, ["changes"]);
        assert!(!d.merge.can_merge);
        assert_eq!(d.merge.methods, ["merge", "squash"]);
        assert_eq!(d.merge.auto_merge, Some(false));
        assert!(d.merge.delete_branch);
    }

    #[test]
    fn graphql_errors_are_translated() {
        let (url, _r) = serve(vec![(200, r#"{"data":{"repository":null},"errors":[{"type":"NOT_FOUND","message":"x"}]}"#), (200, r#"{"errors":[{"type":"FORBIDDEN"}]}"#)]);
        assert_eq!(list(Kind::GitHub, &url, "ghp", "o/r").unwrap_err(), "pull_not_found");
        assert_eq!(list(Kind::GitHub, &url, "ghp", "o/r").unwrap_err(), "pull_forbidden");
        assert_eq!(list(Kind::GitHub, &url, "ghp", "a/b/c").unwrap_err(), "pull_repo_invalid");
    }

    #[test]
    fn gitlab_list_takes_pipelines_by_head_commit() {
        let (url, requests) = serve(vec![
            (
                200,
                r##"[{"iid":5,"title":"Draft: Essai","web_url":"w","state":"opened","draft":true,"author":{"id":1,"username":"camille","state":"active","avatar_url":"https://gitlab.exemple.fr/a.png"},
                    "source_branch":"feature/x","target_branch":"main","source_project_id":3,"target_project_id":3,"sha":"abc1234",
                    "created_at":"2026-11-17T09:30:00.000Z","updated_at":"2026-11-17T09:30:00.000Z","detailed_merge_status":"not_approved",
                    "reviewers":[{"id":2,"username":"max","state":"active"}],"assignees":[],"labels":[{"name":"bug","color":"#FF0000"}]},
                   {"iid":6,"title":"Fork","web_url":"w6","state":"opened","source_project_id":9,"target_project_id":3,"sha":"fff0000","source_branch":"b","target_branch":"main"}]"##,
            ),
            (200, r#"[{"sha":"abc1234","status":"failed"},{"sha":"abc1234","status":"success"}]"#),
        ]);
        let l = list(Kind::GitLab, &url, "glpat", "g/p").unwrap();
        let p = &l.pulls[0];
        assert_eq!((p.state.as_str(), p.review.as_deref(), p.checks.as_deref(), p.fork), ("draft", Some("required"), Some("failure"), false));
        assert_eq!(p.labels[0].color.as_deref(), Some("ff0000"));
        assert_eq!(p.reviewers[0].login, "max");
        assert_eq!((l.pulls[1].fork, l.pulls[1].checks.as_deref()), (true, None));
        assert!(requests.recv().unwrap().starts_with("GET /projects/g%2Fp/merge_requests?state=opened"));
        assert!(requests.recv().unwrap().starts_with("GET /projects/g%2Fp/pipelines?"));
    }

    #[test]
    fn gitlab_detail_reads_discussions_jobs_and_merge_status() {
        let (url, _r) = serve(vec![
            (
                200,
                r#"{"iid":5,"title":"T","web_url":"w","state":"opened","source_branch":"x","target_branch":"main","sha":"abc1234","description":"D",
                    "detailed_merge_status":"ci_still_running","merge_when_pipeline_succeeds":false,"user":{"can_merge":true},
                    "head_pipeline":{"id":77,"status":"running"},"reviewers":[],"assignees":[]}"#,
            ),
            (200, r#"{"squash_option":"default_on","remove_source_branch_after_merge":true}"#),
            (200, r#"[{"user":{"id":2,"username":"max","state":"active"},"state":"requested_changes"}]"#),
            (200, r#"{"approved_by":[{"user":{"id":3,"username":"zoe","state":"active"}}]}"#),
            (
                200,
                r#"[{"id":"d1","individual_note":true,"notes":[{"id":10,"body":"Bonjour","system":false,"resolvable":false,"author":{"id":3,"username":"zoe"},"created_at":"2026-11-17T09:30:00Z"}]},
                   {"id":"d2","individual_note":true,"notes":[{"id":11,"body":"a changé","system":true}]},
                   {"id":"d3","individual_note":false,"notes":[{"id":12,"body":"Ligne","system":false,"resolvable":true,"resolved":false,"position":{"new_path":"a.rs","new_line":3},"author":{"id":2,"username":"max"},"created_at":"2026-11-17T09:31:00Z"}]}]"#,
            ),
            (200, r#"[{"name":"test","status":"running","web_url":"https://gl/j/1"},{"name":"lint","status":"success"}]"#),
        ]);
        let d = detail(Kind::GitLab, &url, "glpat", "g/p", 5).unwrap();
        assert_eq!(d.reviews.iter().map(|r| (r.author.login.as_str(), r.state.as_str())).collect::<Vec<_>>(), [("max", "changes"), ("zoe", "approved")]);
        assert_eq!(d.threads.len(), 2);
        assert!(!d.threads[0].replyable && d.threads[1].resolvable && d.threads[1].replyable);
        assert_eq!((d.threads[1].path.as_deref(), d.threads[1].line), (Some("a.rs"), Some(3)));
        assert_eq!(d.checks_list.len(), 2);
        assert_eq!(d.pull.checks.as_deref(), Some("pending"));
        assert_eq!(d.merge.blockers, ["checks_pending"]);
        assert_eq!(d.merge.methods, ["squash", "merge"]);
        assert_eq!(d.merge.auto_merge, Some(false));
        assert!(d.merge.delete_branch);
    }

    #[test]
    fn github_actions_use_the_right_endpoints() {
        let (url, requests) = serve(vec![
            (201, "{}"),
            (200, "{}"),
            (200, r#"{"data":{"repository":{"pullRequest":{"id":"PR_1","headRefName":"feature/x","isCrossRepository":false}}}}"#),
            (200, r#"{"merged":true}"#),
            (204, ""),
        ]);
        act(Kind::GitHub, &url, "ghp", "o/r", 12, &PullAction::Comment { body: " Salut ".into() }).unwrap();
        let r = requests.recv().unwrap();
        assert!(r.starts_with("POST /repos/o/r/issues/12/comments ") && r.contains(r#""body":"Salut""#), "{r}");
        act(Kind::GitHub, &url, "ghp", "o/r", 12, &PullAction::Review { event: "approve".into(), body: String::new() }).unwrap();
        let r = requests.recv().unwrap();
        assert!(r.starts_with("POST /repos/o/r/pulls/12/reviews ") && r.contains(r#""event":"APPROVE""#), "{r}");
        act(Kind::GitHub, &url, "ghp", "o/r", 12, &PullAction::Merge { method: "squash".into(), delete_branch: true, auto: false }).unwrap();
        requests.recv().unwrap();
        let r = requests.recv().unwrap();
        assert!(r.starts_with("PUT /repos/o/r/pulls/12/merge ") && r.contains(r#""merge_method":"squash""#), "{r}");
        assert!(requests.recv().unwrap().starts_with("DELETE /repos/o/r/git/refs/heads/feature/x "));
        // Rien n'est envoyé pour un commentaire vide ou un mode inconnu.
        assert_eq!(act(Kind::GitHub, "http://127.0.0.1:9", "ghp", "o/r", 1, &PullAction::Comment { body: "  ".into() }).unwrap_err(), "comment_empty");
        assert_eq!(act(Kind::GitHub, "http://127.0.0.1:9", "ghp", "o/r", 1, &PullAction::Review { event: "changes".into(), body: "".into() }).unwrap_err(), "comment_empty");
    }

    #[test]
    fn merge_refusals_are_explained() {
        let (url, _r) = serve(vec![(405, r#"{"message":"Pull Request is not mergeable"}"#), (406, "{}")]);
        let merge = PullAction::Merge { method: "merge".into(), delete_branch: false, auto: false };
        assert_eq!(gitlab_action(&url, "glpat", "g/p", 1, &merge).unwrap_err(), "pull_not_mergeable");
        assert_eq!(gitlab_action(&url, "glpat", "g/p", 1, &merge).unwrap_err(), "pull_not_mergeable");
        assert_eq!(gitlab_action(&url, "glpat", "g/p", 1, &PullAction::Merge { method: "rebase".into(), delete_branch: false, auto: false }).unwrap_err(), "merge_method_invalid");
        assert_eq!(gitlab_action(&url, "glpat", "g/p", 1, &PullAction::Resolve { thread: "../x".into(), resolved: true }).unwrap_err(), "thread_invalid");
    }

    #[test]
    fn gitlab_draft_toggles_the_title_prefix() {
        let (url, requests) = serve(vec![(200, r#"{"title":"[Draft] Essai"}"#), (200, "{}"), (200, r#"{"title":"Essai"}"#), (200, "{}")]);
        gitlab_action(&url, "glpat", "g/p", 5, &PullAction::SetDraft { draft: false }).unwrap();
        requests.recv().unwrap();
        assert!(requests.recv().unwrap().contains(r#""title":"Essai""#));
        gitlab_action(&url, "glpat", "g/p", 5, &PullAction::SetDraft { draft: true }).unwrap();
        requests.recv().unwrap();
        assert!(requests.recv().unwrap().contains(r#""title":"Draft: Essai""#));
    }

    fn git(dir: &Path, args: &[&str]) -> String {
        run(Some(dir), args).unwrap()
    }

    #[test]
    fn files_and_diff_start_at_the_merge_base() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path();
        git(p, &["init", "-q", "-b", "main"]);
        git(p, &["config", "user.name", "T"]);
        git(p, &["config", "user.email", "t@e.fr"]);
        git(p, &["config", "commit.gpgsign", "false"]);
        std::fs::write(p.join("a.txt"), "a\n").unwrap();
        git(p, &["add", "."]);
        git(p, &["commit", "-q", "-m", "init"]);
        git(p, &["switch", "-q", "-c", "feature"]);
        std::fs::write(p.join("b.txt"), "b\n").unwrap();
        git(p, &["add", "."]);
        git(p, &["commit", "-q", "-m", "b"]);
        let head = git(p, &["rev-parse", "HEAD"]);
        git(p, &["switch", "-q", "main"]);
        // Un commit sur la cible après la divergence n'apparaît pas dans la PR.
        std::fs::write(p.join("a.txt"), "a2\n").unwrap();
        git(p, &["commit", "-q", "-am", "a2"]);
        let f = files(p, "main", &head).unwrap();
        assert_eq!(f.iter().map(|x| (x.status.as_str(), x.path.as_str())).collect::<Vec<_>>(), [("A", "b.txt")]);
        let d = file_diff(p, "main", &head, "b.txt", None, false, false).unwrap();
        assert_eq!(d.hunks[0].lines[0].text, "b");
        assert_eq!(files(p, "--output=x", &head).unwrap_err(), "pull_branch_invalid");
        ensure_head(p, "origin", Kind::GitHub, 1, &head).unwrap();
    }
}

#[cfg(test)]
mod old_gitlab_tests {
    use super::*;
    use crate::providers::tests::serve;

    #[test]
    fn gitlab_before_15_6_uses_merge_status() {
        let (url, _r) = serve(vec![
            (200, r#"{"iid":5,"title":"T","web_url":"w","state":"opened","source_branch":"x","target_branch":"main","sha":"abc1234","merge_status":"can_be_merged","user":{"can_merge":true}}"#),
            (200, "{}"),
            (404, "{}"),
            (200, r#"{"approved_by":[]}"#),
            (200, "[]"),
        ]);
        let d = detail(Kind::GitLab, &url, "glpat", "g/p", 5).unwrap();
        assert!(d.merge.can_merge, "{:?}", d.merge.blockers);
    }
}

#[cfg(test)]
mod edit_tests {
    use super::*;
    use crate::providers::tests::serve;

    fn p(id: u64, login: &str) -> Person {
        Person { id, login: login.into(), name: None, avatar: None }
    }

    #[test]
    fn github_edit_replaces_text_people_and_labels() {
        let (url, requests) = serve(vec![(200, "{}"), (200, "{}"), (200, r#"{"requested_reviewers":[{"login":"max"},{"login":"zoe"}]}"#), (201, "{}"), (200, "{}")]);
        let edit = PullAction::Edit { title: " Nouveau ".into(), body: "Corps".into(), reviewers: vec![p(2, "zoe"), p(3, "alix")], assignees: vec![p(1, "camille")], labels: vec!["bug".into()] };
        act(Kind::GitHub, &url, "ghp", "o/r", 12, &edit).unwrap();
        let r = requests.recv().unwrap();
        assert!(r.starts_with("PATCH /repos/o/r/pulls/12 ") && r.contains(r#""title":"Nouveau""#), "{r}");
        let r = requests.recv().unwrap();
        assert!(r.starts_with("PATCH /repos/o/r/issues/12 ") && r.contains(r#""assignees":["camille"]"#) && r.contains(r#""labels":["bug"]"#), "{r}");
        requests.recv().unwrap();
        let r = requests.recv().unwrap();
        assert!(r.starts_with("POST /repos/o/r/pulls/12/requested_reviewers ") && r.contains(r#""reviewers":["alix"]"#), "{r}");
        let r = requests.recv().unwrap();
        assert!(r.starts_with("DELETE /repos/o/r/pulls/12/requested_reviewers ") && r.contains(r#""reviewers":["max"]"#), "{r}");
    }

    #[test]
    fn gitlab_edit_is_one_request_and_empty_lists_clear() {
        let (url, requests) = serve(vec![(200, "{}")]);
        let edit = PullAction::Edit { title: "T".into(), body: "D".into(), reviewers: vec![p(8, "max")], assignees: vec![], labels: vec!["a".into(), "b".into()] };
        act(Kind::GitLab, &url, "glpat", "g/p", 5, &edit).unwrap();
        let r = requests.recv().unwrap();
        assert!(r.starts_with("PUT /projects/g%2Fp/merge_requests/5 "), "{r}");
        assert!(r.contains(r#""reviewer_ids":[8]"#) && r.contains(r#""assignee_ids":[0]"#) && r.contains(r#""labels":"a,b""#) && r.contains(r#""description":"D""#), "{r}");
        assert_eq!(act(Kind::GitLab, "http://127.0.0.1:9", "glpat", "g/p", 5, &PullAction::Edit { title: " ".into(), body: String::new(), reviewers: vec![], assignees: vec![], labels: vec![] }).unwrap_err(), "pull_title_missing");
    }
}
#[cfg(test)]
mod retry_tests {
    use super::*;
    use crate::providers::tests::serve;

    #[test]
    fn retry_failed_jobs_on_each_provider() {
        let (url, requests) = serve(vec![(201, "{}"), (201, "{}"), (201, "{}")]);
        act(Kind::GitHub, &url, "ghp", "o/r", 12, &PullAction::RetryFailed { runs: vec![11, 12] }).unwrap();
        assert!(requests.recv().unwrap().starts_with("POST /repos/o/r/actions/runs/11/rerun-failed-jobs "));
        assert!(requests.recv().unwrap().starts_with("POST /repos/o/r/actions/runs/12/rerun-failed-jobs "));
        act(Kind::GitLab, &url, "glpat", "g/p", 5, &PullAction::RetryFailed { runs: vec![77] }).unwrap();
        assert!(requests.recv().unwrap().starts_with("POST /projects/g%2Fp/pipelines/77/retry "));
    }
}
