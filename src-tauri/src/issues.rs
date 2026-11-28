//! Issues GitHub / GitLab d'un dépôt : liste (ouvertes, les miennes), détail avec commentaires,
//! et ce qu'on y fait depuis GitGR (commenter, fermer, rouvrir, s'assigner).

use crate::providers::Kind;
use crate::pull_view::{iso_time, Comment};
use crate::pulls::{check_repo, parse_label, parse_person, project, refused, request, text, Label, Method, Person};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IssueSummary {
    pub number: u64,
    pub title: String,
    /// `open` ou `closed`.
    pub state: String,
    pub author: Option<Person>,
    pub assignees: Vec<Person>,
    pub labels: Vec<Label>,
    pub comments: u64,
    pub url: String,
    pub updated: i64,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IssueDetail {
    #[serde(flatten)]
    pub issue: IssueSummary,
    pub body: String,
    pub created: i64,
    pub milestone: Option<String>,
    pub comments_list: Vec<Comment>,
}

fn time_of(v: &Value) -> i64 {
    v.as_str().and_then(iso_time).unwrap_or(0)
}

fn summary(kind: Kind, v: &Value) -> Option<IssueSummary> {
    let (number, state, url, comments) = match kind {
        Kind::GitHub => {
            // L'API des issues de GitHub rend aussi les PR : écartées.
            if !v["pull_request"].is_null() {
                return None;
            }
            (v["number"].as_u64()?, v["state"].as_str().unwrap_or("open"), v["html_url"].as_str().unwrap_or(""), v["comments"].as_u64().unwrap_or(0))
        }
        Kind::GitLab => (
            v["iid"].as_u64()?,
            if v["state"].as_str() == Some("closed") { "closed" } else { "open" },
            v["web_url"].as_str().unwrap_or(""),
            v["user_notes_count"].as_u64().unwrap_or(0),
        ),
    };
    let people = |a: &Value| a.as_array().map(|x| x.iter().filter_map(|p| parse_person(kind, p)).collect()).unwrap_or_default();
    Some(IssueSummary {
        number,
        title: v["title"].as_str().unwrap_or("").to_string(),
        state: state.into(),
        author: parse_person(kind, &v[if kind == Kind::GitHub { "user" } else { "author" }]),
        assignees: people(&v["assignees"]),
        labels: v["labels"].as_array().map(|a| a.iter().filter_map(parse_label).collect()).unwrap_or_default(),
        comments,
        url: url.to_string(),
        updated: time_of(&v["updated_at"]),
    })
}

fn get(kind: Kind, api: &str, path: &str, token: &str) -> Result<Value, String> {
    let r = request(kind, api, path, token, Method::Get)?;
    if !(200..300).contains(&r.status) {
        return Err(refused(r.status));
    }
    Ok(r.json)
}

/// Issues ouvertes du dépôt (100 au plus, les plus récemment modifiées d'abord) ; `assignee` :
/// seulement celles assignées à ce login.
pub fn list(kind: Kind, api: &str, token: &str, repo: &str, assignee: Option<&str>) -> Result<Vec<IssueSummary>, String> {
    check_repo(repo)?;
    let who = |key: &str| assignee.map(|a| format!("&{key}={}", crate::pulls::enc(a))).unwrap_or_default();
    let path = match kind {
        Kind::GitHub => format!("{}/issues?state=open&sort=updated&per_page=100{}", project(kind, repo), who("assignee")),
        Kind::GitLab => format!("{}/issues?state=opened&order_by=updated_at&with_labels_details=true&per_page=100{}", project(kind, repo), who("assignee_username")),
    };
    let v = get(kind, api, &path, token)?;
    Ok(v.as_array().map(|a| a.iter().filter_map(|i| summary(kind, i)).collect()).unwrap_or_default())
}

/// Une issue, avec ses commentaires (sans les notes système de GitLab).
pub fn detail(kind: Kind, api: &str, token: &str, repo: &str, number: u64) -> Result<IssueDetail, String> {
    check_repo(repo)?;
    let base = format!("{}/issues/{number}", project(kind, repo));
    let v = get(kind, api, &format!("{base}{}", if kind == Kind::GitLab { "?with_labels_details=true" } else { "" }), token)?;
    let issue = summary(kind, &v).ok_or("issue_not_found")?;
    let notes = match kind {
        Kind::GitHub => get(kind, api, &format!("{base}/comments?per_page=100"), token)?,
        Kind::GitLab => get(kind, api, &format!("{base}/notes?sort=asc&order_by=created_at&per_page=100"), token)?,
    };
    let comments_list = notes
        .as_array()
        .map(|a| {
            a.iter()
                .filter(|n| !n["system"].as_bool().unwrap_or(false))
                .map(|n| Comment {
                    id: n["id"].to_string(),
                    author: parse_person(kind, &n[if kind == Kind::GitHub { "user" } else { "author" }]),
                    body: n["body"].as_str().unwrap_or("").to_string(),
                    at: time_of(&n["created_at"]),
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(IssueDetail {
        body: text(&v, if kind == Kind::GitHub { "body" } else { "description" }).unwrap_or_default(),
        created: time_of(&v["created_at"]),
        milestone: text(&v["milestone"], "title"),
        issue,
        comments_list,
    })
}

#[derive(Deserialize, Debug, Clone)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum IssueAction {
    Comment { body: String },
    Close,
    Reopen,
    /// S'assigner (le login du compte).
    Assign { login: String },
}

/// Ce qu'on fait sur une issue ; une action refusée par le provider rend `issue_forbidden`.
pub fn act(kind: Kind, api: &str, token: &str, repo: &str, number: u64, action: &IssueAction) -> Result<(), String> {
    check_repo(repo)?;
    let base = format!("{}/issues/{number}", project(kind, repo));
    let (path, body, method) = match (kind, action) {
        (_, IssueAction::Comment { body }) => {
            let body = body.trim();
            if body.is_empty() {
                return Err("comment_empty".into());
            }
            let path = if kind == Kind::GitHub { format!("{base}/comments") } else { format!("{base}/notes") };
            (path, json!({ "body": body }), "post")
        }
        (Kind::GitHub, IssueAction::Close) => (base, json!({ "state": "closed" }), "patch"),
        (Kind::GitHub, IssueAction::Reopen) => (base, json!({ "state": "open" }), "patch"),
        (Kind::GitLab, IssueAction::Close) => (base, json!({ "state_event": "close" }), "put"),
        (Kind::GitLab, IssueAction::Reopen) => (base, json!({ "state_event": "reopen" }), "put"),
        (Kind::GitHub, IssueAction::Assign { login }) => (format!("{base}/assignees"), json!({ "assignees": [login] }), "post"),
        (Kind::GitLab, IssueAction::Assign { .. }) => {
            // L'identifiant du compte du token (l'interface ne connaît que son login).
            let me = get(kind, api, "/user", token)?["id"].as_u64().ok_or("provider_unexpected")?;
            (base, json!({ "assignee_ids": [me] }), "put")
        }
    };
    let method = match method {
        "post" => Method::Post(&body),
        "patch" => Method::Patch(&body),
        _ => Method::Put(&body),
    };
    let r = request(kind, api, &path, token, method)?;
    match r.status {
        200..=299 => Ok(()),
        403 | 404 => Err("issue_forbidden".into()),
        s => Err(refused(s)),
    }
}

/// Nom de branche proposé pour une issue : `12-titre-court` (minuscules, sans accents ni signes,
/// six mots au plus), avec un préfixe éventuel (`feature/`).
pub fn branch_name(number: u64, title: &str, prefix: &str) -> String {
    let words: Vec<String> = title
        .chars()
        .map(|c| match c {
            'à' | 'â' | 'ä' | 'À' | 'Â' | 'Ä' => 'a',
            'é' | 'è' | 'ê' | 'ë' | 'É' | 'È' | 'Ê' | 'Ë' => 'e',
            'î' | 'ï' | 'Î' | 'Ï' => 'i',
            'ô' | 'ö' | 'Ô' | 'Ö' => 'o',
            'ù' | 'û' | 'ü' | 'Ù' | 'Û' | 'Ü' => 'u',
            'ç' | 'Ç' => 'c',
            c => c,
        })
        .collect::<String>()
        .to_lowercase()
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|w| !w.is_empty())
        .take(6)
        .map(str::to_string)
        .collect();
    let slug = words.join("-");
    let name = if slug.is_empty() { number.to_string() } else { format!("{number}-{slug}") };
    format!("{prefix}{name}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::tests::serve;

    #[test]
    fn lists_github_issues_without_pull_requests() {
        let (url, requests) = serve(vec![(
            200,
            r#"[{"number":3,"title":"Bug","state":"open","user":{"login":"max"},"assignees":[{"login":"camille"}],"labels":[{"name":"bug","color":"D73A4A"}],"comments":2,"html_url":"https://g/o/r/issues/3","updated_at":"2026-11-28T08:00:00Z"},
               {"number":4,"title":"PR","state":"open","pull_request":{"url":"x"},"user":{"login":"max"}}]"#,
        )]);
        let list = list(Kind::GitHub, &url, "t", "o/r", Some("camille")).unwrap();
        assert!(requests.recv().unwrap().starts_with("GET /repos/o/r/issues?state=open&sort=updated&per_page=100&assignee=camille "));
        assert_eq!(list.len(), 1);
        assert_eq!((list[0].number, list[0].comments, list[0].labels[0].color.as_deref()), (3, 2, Some("d73a4a")));
    }

    #[test]
    fn gitlab_detail_skips_system_notes_and_closes() {
        let (url, requests) = serve(vec![
            (200, r#"{"iid":5,"title":"Lent","state":"opened","author":{"username":"camille","state":"active"},"description":"Trop lent","assignees":[],"labels":[],"user_notes_count":1,"web_url":"w","created_at":"2026-11-27T08:00:00Z","milestone":{"title":"v1"}}"#),
            (200, r#"[{"id":1,"body":"assigned to @max","system":true,"author":{"username":"bot","state":"active"}},{"id":2,"body":"Je regarde","system":false,"author":{"username":"max","state":"active"},"created_at":"2026-11-28T08:00:00Z"}]"#),
            (200, "{}"),
        ]);
        let d = detail(Kind::GitLab, &url, "t", "g/p", 5).unwrap();
        assert!(requests.recv().unwrap().starts_with("GET /projects/g%2Fp/issues/5?with_labels_details=true "));
        requests.recv().unwrap();
        assert_eq!((d.body.as_str(), d.milestone.as_deref(), d.comments_list.len()), ("Trop lent", Some("v1"), 1));
        assert_eq!(d.comments_list[0].body, "Je regarde");
        act(Kind::GitLab, &url, "t", "g/p", 5, &IssueAction::Close).unwrap();
        let r = requests.recv().unwrap();
        assert!(r.starts_with("PUT /projects/g%2Fp/issues/5 ") && r.contains(r#""state_event":"close""#), "{r}");
    }

    #[test]
    fn proposes_branch_names() {
        assert_eq!(branch_name(12, "Écran d'accueil : trop lent !", ""), "12-ecran-d-accueil-trop-lent");
        assert_eq!(branch_name(3, "a b c d e f g h", "feature/"), "feature/3-a-b-c-d-e-f");
        assert_eq!(branch_name(7, "!!!", ""), "7");
    }
}
