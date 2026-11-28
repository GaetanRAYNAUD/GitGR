//! Exécutions de CI d'un dépôt (toutes, pas seulement celles des PR / MR) : workflows GitHub
//! Actions, pipelines GitLab ; relance des jobs en échec.

use crate::providers::Kind;
use crate::pulls::{check_ref, check_repo, enc, project, refused, request, Method};
use serde::Serialize;
use serde_json::{json, Value};

/// Exécutions lues au plus (une page).
const PER_PAGE: u32 = 50;

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CiRun {
    pub id: u64,
    /// Workflow (GitHub) ; « Pipeline #id » côté interface pour GitLab (vide ici).
    pub name: String,
    /// Titre de l'exécution (message du commit, de la PR) quand le provider le donne.
    pub title: Option<String>,
    /// `success`, `failure`, `running`, `pending`, `canceled`, `skipped`, `manual`, `neutral`.
    pub state: String,
    pub branch: Option<String>,
    pub sha: String,
    /// Déclencheur : `push`, `pull_request`, `schedule`, `workflow_dispatch`, `web`, `merge_request_event`…
    pub event: Option<String>,
    pub url: Option<String>,
    /// Création (secondes Unix).
    pub created: i64,
    /// Dernière mise à jour (secondes Unix).
    pub updated: i64,
}

fn time_of(v: &Value) -> i64 {
    v.as_str().and_then(crate::pull_view::iso_time).unwrap_or(0)
}

fn gh_state(status: &str, conclusion: Option<&str>) -> &'static str {
    match status {
        "completed" => match conclusion.unwrap_or("") {
            "success" => "success",
            "failure" | "timed_out" | "startup_failure" => "failure",
            "cancelled" => "canceled",
            "skipped" => "skipped",
            "action_required" => "manual",
            _ => "neutral",
        },
        "in_progress" => "running",
        _ => "pending",
    }
}

fn gl_state(status: &str) -> &'static str {
    match status {
        "success" => "success",
        "failed" => "failure",
        "running" => "running",
        "canceled" | "canceling" => "canceled",
        "skipped" => "skipped",
        "manual" => "manual",
        "created" | "waiting_for_resource" | "preparing" | "pending" | "scheduled" | "waiting_for_callback" => "pending",
        _ => "neutral",
    }
}

fn parse_github(v: &Value) -> Vec<CiRun> {
    v["workflow_runs"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|r| {
                    Some(CiRun {
                        id: r["id"].as_u64()?,
                        name: r["name"].as_str().unwrap_or("").to_string(),
                        title: r["display_title"].as_str().map(str::to_string),
                        state: gh_state(r["status"].as_str().unwrap_or(""), r["conclusion"].as_str()).into(),
                        branch: r["head_branch"].as_str().map(str::to_string),
                        sha: r["head_sha"].as_str().unwrap_or("").to_string(),
                        event: r["event"].as_str().map(str::to_string),
                        url: r["html_url"].as_str().map(str::to_string),
                        created: time_of(&r["created_at"]),
                        updated: time_of(&r["updated_at"]),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn parse_gitlab(v: &Value) -> Vec<CiRun> {
    v.as_array()
        .map(|a| {
            a.iter()
                .filter_map(|r| {
                    Some(CiRun {
                        id: r["id"].as_u64()?,
                        name: String::new(),
                        title: None,
                        state: gl_state(r["status"].as_str().unwrap_or("")).into(),
                        branch: r["ref"].as_str().map(str::to_string),
                        sha: r["sha"].as_str().unwrap_or("").to_string(),
                        event: r["source"].as_str().map(str::to_string),
                        url: r["web_url"].as_str().map(str::to_string),
                        created: time_of(&r["created_at"]),
                        updated: time_of(&r["updated_at"]),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Dernières exécutions du dépôt, la plus récente d'abord ; `branch` : seulement celles-là.
pub fn runs(kind: Kind, api: &str, token: &str, repo: &str, branch: Option<&str>) -> Result<Vec<CiRun>, String> {
    check_repo(repo)?;
    if let Some(b) = branch {
        check_ref(b)?;
    }
    let path = match kind {
        Kind::GitHub => format!("{}/actions/runs?per_page={PER_PAGE}{}", project(kind, repo), branch.map(|b| format!("&branch={}", enc(b))).unwrap_or_default()),
        Kind::GitLab => format!("{}/pipelines?per_page={PER_PAGE}&order_by=id&sort=desc{}", project(kind, repo), branch.map(|b| format!("&ref={}", enc(b))).unwrap_or_default()),
    };
    let r = request(kind, api, &path, token, Method::Get)?;
    if !(200..300).contains(&r.status) {
        return Err(refused(r.status));
    }
    Ok(match kind {
        Kind::GitHub => parse_github(&r.json),
        Kind::GitLab => parse_gitlab(&r.json),
    })
}

/// Relance les jobs en échec d'une exécution (GitHub : `rerun-failed-jobs` ; GitLab : `retry`).
pub fn retry(kind: Kind, api: &str, token: &str, repo: &str, id: u64) -> Result<(), String> {
    check_repo(repo)?;
    let path = match kind {
        Kind::GitHub => format!("{}/actions/runs/{id}/rerun-failed-jobs", project(kind, repo)),
        Kind::GitLab => format!("{}/pipelines/{id}/retry", project(kind, repo)),
    };
    let r = request(kind, api, &path, token, Method::Post(&json!({})))?;
    if (200..300).contains(&r.status) {
        Ok(())
    } else {
        Err(refused(r.status))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::tests::serve;

    #[test]
    fn reads_github_runs() {
        let (url, requests) = serve(vec![(
            200,
            r#"{"workflow_runs":[
              {"id":11,"name":"CI","display_title":"Ajoute b","status":"completed","conclusion":"failure","head_branch":"main","head_sha":"abc","event":"push","html_url":"https://g/r/11","created_at":"2026-11-28T08:00:00Z","updated_at":"2026-11-28T08:05:00Z"},
              {"id":12,"name":"CI","status":"in_progress","conclusion":null,"head_branch":"feat","head_sha":"def","event":"pull_request","created_at":"2026-11-28T09:00:00Z"},
              {"id":13,"name":"Nuit","status":"queued","head_sha":"aaa","event":"schedule"}
            ]}"#,
        )]);
        let list = runs(Kind::GitHub, &url, "t", "o/r", Some("main")).unwrap();
        assert!(requests.recv().unwrap().starts_with("GET /repos/o/r/actions/runs?per_page=50&branch=main "));
        assert_eq!(list.iter().map(|r| r.state.as_str()).collect::<Vec<_>>(), ["failure", "running", "pending"]);
        assert_eq!(list[0].title.as_deref(), Some("Ajoute b"));
        assert!(list[0].created > 0 && list[0].updated > list[0].created);
    }

    #[test]
    fn reads_gitlab_pipelines_and_retries() {
        let (url, requests) = serve(vec![
            (200, r#"[{"id":77,"status":"failed","ref":"main","sha":"abc","source":"push","web_url":"https://gl/p/-/pipelines/77","created_at":"2026-11-28T08:00:00Z","updated_at":"2026-11-28T08:01:00Z"},{"id":78,"status":"manual","ref":"main","sha":"abd"}]"#),
            (201, "{}"),
        ]);
        let list = runs(Kind::GitLab, &url, "t", "g/p", None).unwrap();
        assert!(requests.recv().unwrap().starts_with("GET /projects/g%2Fp/pipelines?per_page=50&order_by=id&sort=desc "));
        assert_eq!(list.iter().map(|r| (r.id, r.state.as_str())).collect::<Vec<_>>(), [(77, "failure"), (78, "manual")]);
        retry(Kind::GitLab, &url, "t", "g/p", 77).unwrap();
        assert!(requests.recv().unwrap().starts_with("POST /projects/g%2Fp/pipelines/77/retry "));
    }
}
