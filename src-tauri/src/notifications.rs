//! Notifications des providers : une lecture par compte, tous dépôts confondus.
//!
//! - GitHub : `/notifications`, avec requête conditionnelle (`If-None-Match` /
//!   `If-Modified-Since`) : tant que rien n'a changé, la réponse est un `304`, qui ne compte pas
//!   dans la limite de requêtes. L'intervalle minimal annoncé (`X-Poll-Interval`) est renvoyé.
//! - GitLab : la liste des To-Do en attente (`/todos?state=pending`).
//!
//! Le rythme est décidé par l'interface (fenêtre active, en arrière-plan, en pause) ; ici, une
//! lecture et la mémoire des en-têtes de la précédente. « Vu » est gardé en local
//! (`notifications-seen.json`) ; « marquer comme lu » chez le provider est une action à part.

use crate::providers::{Account, Kind, agent, check_token, headers, instance, send_api};
use crate::pull_view::iso_time;
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

const MAX_BODY: u64 = 4 * 1024 * 1024;

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Notification {
    /// Identifiant chez le provider (fil GitHub, To-Do GitLab).
    pub id: String,
    pub account: String,
    pub kind: String,
    /// Adresse de l'instance.
    pub url: String,
    /// Dépôt `propriétaire/nom`.
    pub repo: String,
    /// "pull", "issue", "ci" ou "other".
    pub subject: String,
    /// Numéro de la PR / MR ou de l'issue.
    pub number: Option<u64>,
    pub title: String,
    /// "review_requested", "mention", "comment", "assigned", "approval", "ci_failed", "author",
    /// "state" (fusionnée, fermée…) ou "other".
    pub reason: String,
    /// Page web de l'élément.
    pub web_url: Option<String>,
    /// Secondes Unix.
    pub updated_at: i64,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Poll {
    /// `false` : rien de changé depuis la lecture précédente (`304`) ; `items` est alors vide.
    pub changed: bool,
    pub items: Vec<Notification>,
    /// Intervalle minimal entre deux lectures demandé par le provider, en secondes.
    pub min_interval: Option<u64>,
}

/// En-têtes de la dernière réponse, par compte : `ETag`, `Last-Modified`.
static VALIDATORS: Mutex<Option<HashMap<String, (Option<String>, Option<String>)>>> = Mutex::new(None);

fn validators(account: &str) -> (Option<String>, Option<String>) {
    VALIDATORS.lock().unwrap_or_else(|e| e.into_inner()).as_ref().and_then(|m| m.get(account).cloned()).unwrap_or((None, None))
}

fn remember(account: &str, etag: Option<String>, modified: Option<String>) {
    VALIDATORS.lock().unwrap_or_else(|e| e.into_inner()).get_or_insert_with(HashMap::new).insert(account.to_string(), (etag, modified));
}

/// Oublie la dernière lecture d'un compte : la suivante renvoie toute la liste.
pub fn forget(account: &str) {
    if let Some(m) = VALIDATORS.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
        m.remove(account);
    }
}

struct Reply {
    status: u16,
    body: String,
    etag: Option<String>,
    modified: Option<String>,
    poll: Option<u64>,
}

fn get(kind: Kind, api: &str, path: &str, token: &str, conditional: (Option<String>, Option<String>)) -> Result<Reply, String> {
    check_token(token)?;
    let mut request = headers(kind, agent().get(format!("{api}{path}")), token);
    if let Some(etag) = &conditional.0 {
        request = request.header("If-None-Match", etag);
    }
    if let Some(modified) = &conditional.1 {
        request = request.header("If-Modified-Since", modified);
    }
    let mut response = send_api(api, Some(token), || request.call())?;
    let header = |name: &str| response.headers().get(name).and_then(|v| v.to_str().ok()).map(str::to_string);
    let (etag, modified, poll) = (header("etag"), header("last-modified"), header("x-poll-interval").and_then(|v| v.trim().parse().ok()));
    let status = response.status().as_u16();
    let body = if status == 304 { String::new() } else { response.body_mut().with_config().limit(MAX_BODY).read_to_string().unwrap_or_default() };
    match status {
        200..=299 | 304 => Ok(Reply { status, body, etag, modified, poll }),
        401 => Err("token_invalid".into()),
        403 => Err("token_forbidden".into()),
        300..=399 | 404 => Err("provider_not_found".into()),
        _ => Err("provider_error".into()),
    }
}

/// Numéro en fin d'adresse d'API (`…/pulls/12`).
fn last_number(url: &str) -> Option<u64> {
    url.rsplit('/').next()?.parse().ok()
}

fn github_items(account: &Account, inst_url: &str, json: &Value) -> Vec<Notification> {
    json.as_array()
        .into_iter()
        .flatten()
        .filter_map(|n| {
            let repo = n["repository"]["full_name"].as_str()?.to_string();
            let html = n["repository"]["html_url"].as_str().unwrap_or_default();
            let api_url = n["subject"]["url"].as_str().unwrap_or_default();
            let number = last_number(api_url);
            let (subject, web_url) = match n["subject"]["type"].as_str().unwrap_or("") {
                "PullRequest" => ("pull", number.map(|x| format!("{html}/pull/{x}"))),
                "Issue" => ("issue", number.map(|x| format!("{html}/issues/{x}"))),
                "CheckSuite" | "WorkflowRun" => ("ci", Some(format!("{html}/actions"))),
                _ => ("other", Some(html.to_string()).filter(|s| !s.is_empty())),
            };
            let reason = match n["reason"].as_str().unwrap_or("") {
                "review_requested" => "review_requested",
                "mention" | "team_mention" => "mention",
                "comment" => "comment",
                "assign" => "assigned",
                "author" => "author",
                "ci_activity" => "ci_failed",
                "state_change" => "state",
                _ => "other",
            };
            Some(Notification {
                id: n["id"].as_str()?.to_string(),
                account: account.id.clone(),
                kind: account.kind.clone(),
                url: inst_url.to_string(),
                repo,
                subject: subject.into(),
                number: if subject == "ci" { None } else { number },
                title: n["subject"]["title"].as_str().unwrap_or_default().into(),
                reason: reason.into(),
                web_url,
                updated_at: n["updated_at"].as_str().and_then(iso_time).unwrap_or(0),
            })
        })
        .collect()
}

fn gitlab_items(account: &Account, inst_url: &str, json: &Value) -> Vec<Notification> {
    json.as_array()
        .into_iter()
        .flatten()
        .filter_map(|n| {
            let subject = match n["target_type"].as_str().unwrap_or("") {
                "MergeRequest" => "pull",
                "Issue" => "issue",
                _ => "other",
            };
            let reason = match n["action_name"].as_str().unwrap_or("") {
                "review_requested" => "review_requested",
                "mentioned" | "directly_addressed" => "mention",
                "assigned" => "assigned",
                "approval_required" => "approval",
                "build_failed" => "ci_failed",
                "unmergeable" | "merge_train_removed" => "state",
                _ => "other",
            };
            Some(Notification {
                id: n["id"].as_u64()?.to_string(),
                account: account.id.clone(),
                kind: account.kind.clone(),
                url: inst_url.to_string(),
                repo: n["project"]["path_with_namespace"].as_str()?.to_string(),
                subject: subject.into(),
                number: n["target"]["iid"].as_u64(),
                title: n["target"]["title"].as_str().or(n["body"].as_str()).unwrap_or_default().into(),
                reason: reason.into(),
                web_url: n["target_url"].as_str().map(str::to_string),
                updated_at: n["created_at"].as_str().and_then(iso_time).unwrap_or(0),
            })
        })
        .collect()
}

/// Lit les notifications du compte (non lues chez GitHub, To-Do en attente chez GitLab).
pub fn poll(account: &Account, token: &str) -> Result<Poll, String> {
    let kind = Kind::parse(&account.kind)?;
    let inst = instance(kind, &account.url)?;
    let path = match kind {
        Kind::GitHub => "/notifications?per_page=50",
        Kind::GitLab => "/todos?state=pending&per_page=100",
    };
    let r = get(kind, &inst.api, path, token, validators(&account.id))?;
    if r.status == 304 {
        return Ok(Poll { changed: false, items: Vec::new(), min_interval: r.poll });
    }
    remember(&account.id, r.etag, r.modified);
    let json: Value = serde_json::from_str(&r.body).map_err(|_| "provider_unexpected".to_string())?;
    let mut items = match kind {
        Kind::GitHub => github_items(account, &inst.url, &json),
        Kind::GitLab => gitlab_items(account, &inst.url, &json),
    };
    items.sort_by_key(|n| std::cmp::Reverse(n.updated_at));
    Ok(Poll { changed: true, items, min_interval: r.poll })
}

/// Marque comme lu chez le provider : une notification (`id`), ou toutes (`None`).
pub fn mark_read(account: &Account, token: &str, id: Option<&str>) -> Result<(), String> {
    let kind = Kind::parse(&account.kind)?;
    let inst = instance(kind, &account.url)?;
    check_token(token)?;
    if let Some(id) = id
        && (id.is_empty() || !id.bytes().all(|b| b.is_ascii_digit()))
    {
        return Err("notification_invalid".into());
    }
    let url = |path: String| format!("{}{path}", inst.api);
    let response = match (kind, id) {
        (Kind::GitHub, Some(id)) => send_api(&inst.api, Some(token), || headers(kind, agent().patch(url(format!("/notifications/threads/{id}"))), token).send_empty()),
        (Kind::GitHub, None) => send_api(&inst.api, Some(token), || headers(kind, agent().put(url("/notifications".into())), token).header("Content-Type", "application/json").send("{}")),
        (Kind::GitLab, Some(id)) => send_api(&inst.api, Some(token), || headers(kind, agent().post(url(format!("/todos/{id}/mark_as_done"))), token).send_empty()),
        (Kind::GitLab, None) => send_api(&inst.api, Some(token), || headers(kind, agent().post(url("/todos/mark_as_done".into())), token).send_empty()),
    }?;
    // La liste a changé : la prochaine lecture la renvoie en entier.
    forget(&account.id);
    match response.status().as_u16() {
        200..=299 => Ok(()),
        401 => Err("token_invalid".into()),
        403 => Err("token_forbidden".into()),
        404 => Err("notification_invalid".into()),
        _ => Err("provider_error".into()),
    }
}

// ---------------------------------------------------------------------------
// « Vu », en local
// ---------------------------------------------------------------------------

static SEEN_FILE: OnceLock<PathBuf> = OnceLock::new();
/// Au plus, les plus récentes : de quoi couvrir plusieurs mois de notifications.
const MAX_SEEN: usize = 2000;

pub fn set_seen_file(path: PathBuf) {
    let _ = SEEN_FILE.set(path);
}

/// Clés des notifications déjà vues (`compte|id|mise à jour`).
pub fn seen() -> Vec<String> {
    SEEN_FILE.get().and_then(|f| std::fs::read_to_string(f).ok()).and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

/// Ajoute des clés vues (les plus anciennes sortent au-delà de `MAX_SEEN`).
pub fn add_seen(keys: &[String]) -> Result<(), String> {
    let Some(file) = SEEN_FILE.get() else { return Ok(()) };
    let mut all = seen();
    for k in keys {
        if !all.contains(k) {
            all.push(k.clone());
        }
    }
    if all.len() > MAX_SEEN {
        all.drain(..all.len() - MAX_SEEN);
    }
    if let Some(dir) = file.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let tmp = file.with_extension("tmp");
    std::fs::write(&tmp, serde_json::to_string(&all).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, file).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn account(kind: &str, url: &str) -> Account {
        Account { id: format!("{kind}|{url}|moi"), kind: kind.into(), url: url.into(), login: "moi".into(), name: None }
    }

    /// Faux provider : répond `304` quand l'ETag reçu est `"v1"`, sinon la liste avec cet ETag.
    fn serve_conditional(body: &'static str) -> (String, std::sync::mpsc::Receiver<String>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut s) = stream else { return };
                let mut req = Vec::new();
                let mut buf = [0u8; 2048];
                while !req.windows(4).any(|w| w == b"\r\n\r\n") {
                    match s.read(&mut buf) {
                        Ok(n) if n > 0 => req.extend_from_slice(&buf[..n]),
                        _ => break,
                    }
                }
                let text = String::from_utf8_lossy(&req).to_string();
                let _ = tx.send(text.clone());
                let reply = if text.to_lowercase().contains("if-none-match: \"v1\"") {
                    "HTTP/1.1 304 Not Modified\r\nX-Poll-Interval: 60\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_string()
                } else {
                    format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nETag: \"v1\"\r\nX-Poll-Interval: 60\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len())
                };
                let _ = s.write_all(reply.as_bytes());
            }
        });
        (url, rx)
    }

    #[test]
    fn github_second_poll_is_conditional_and_unchanged() {
        let body = r#"[{"id":"101","reason":"review_requested","updated_at":"2026-11-17T09:30:00Z","subject":{"title":"Ajout","url":"https://api.github.com/repos/o/r/pulls/12","type":"PullRequest"},"repository":{"full_name":"o/r","html_url":"https://github.com/o/r"}},
                       {"id":"102","reason":"ci_activity","updated_at":"2026-11-17T10:30:00Z","subject":{"title":"CI","url":null,"type":"CheckSuite"},"repository":{"full_name":"o/r","html_url":"https://github.com/o/r"}}]"#;
        let (url, requests) = serve_conditional(body);
        let a = account("github", &url);
        // GitHub Enterprise : API sous /api/v3.
        let first = poll(&a, "ghp").unwrap();
        assert!(first.changed);
        assert_eq!(first.min_interval, Some(60));
        assert_eq!(first.items.iter().map(|n| (n.id.as_str(), n.reason.as_str(), n.number)).collect::<Vec<_>>(), [("102", "ci_failed", None), ("101", "review_requested", Some(12))]);
        assert_eq!(first.items[1].web_url.as_deref(), Some("https://github.com/o/r/pull/12"));
        assert!(requests.recv().unwrap().starts_with("GET /api/v3/notifications?per_page=50 "));
        let second = poll(&a, "ghp").unwrap();
        assert!(!second.changed && second.items.is_empty());
        assert!(requests.recv().unwrap().to_lowercase().contains("if-none-match: \"v1\""));
        // Après « marquer comme lu », la lecture suivante est complète.
        forget(&a.id);
        assert!(poll(&a, "ghp").unwrap().changed);
    }

    #[test]
    fn gitlab_todos_are_read() {
        let (url, requests) = crate::providers::tests::serve(vec![(
            200,
            r#"[{"id":7,"action_name":"review_requested","target_type":"MergeRequest","target":{"iid":5,"title":"MR"},"target_url":"https://gl/g/p/-/merge_requests/5","project":{"path_with_namespace":"g/p"},"created_at":"2026-11-17T09:30:00Z"}]"#,
        )]);
        let p = poll(&account("gitlab", &url), "glpat").unwrap();
        assert_eq!((p.items[0].id.as_str(), p.items[0].subject.as_str(), p.items[0].number, p.items[0].reason.as_str()), ("7", "pull", Some(5), "review_requested"));
        assert!(requests.recv().unwrap().starts_with("GET /api/v4/todos?state=pending&per_page=100 "));
    }

    #[test]
    fn mark_read_endpoints() {
        let (url, requests) = crate::providers::tests::serve(vec![(205, ""), (201, "{}"), (204, "")]);
        mark_read(&account("github", &url), "ghp", Some("101")).unwrap();
        assert!(requests.recv().unwrap().starts_with("PATCH /api/v3/notifications/threads/101 "));
        mark_read(&account("gitlab", &url), "glpat", Some("7")).unwrap();
        assert!(requests.recv().unwrap().starts_with("POST /api/v4/todos/7/mark_as_done "));
        mark_read(&account("gitlab", &url), "glpat", None).unwrap();
        assert!(requests.recv().unwrap().starts_with("POST /api/v4/todos/mark_as_done "));
        assert_eq!(mark_read(&account("gitlab", &url), "glpat", Some("../x")).unwrap_err(), "notification_invalid");
    }

    #[test]
    fn seen_keys_are_kept_on_disk() {
        let dir = tempfile::tempdir().unwrap();
        // `set_seen_file` ne se pose qu'une fois par processus : test isolé sur le chemin.
        let _ = SEEN_FILE.set(dir.path().join("seen.json"));
        if SEEN_FILE.get() != Some(&dir.path().join("seen.json")) {
            return;
        }
        add_seen(&["a|1|10".into(), "a|2|20".into()]).unwrap();
        add_seen(&["a|1|10".into()]).unwrap();
        assert_eq!(seen(), ["a|1|10", "a|2|20"]);
    }
}
