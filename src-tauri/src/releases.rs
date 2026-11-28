//! Releases GitHub / GitLab d'un tag : les commits depuis le tag précédent (pour les notes,
//! mises en forme par l'interface), et la création de la release sur le provider.

use crate::git::run;
use crate::history::check_dir;
use crate::providers::Kind;
use crate::pulls::{check_repo, message, project, refused};
use serde::Serialize;
use serde_json::{json, Value};
use std::path::Path;

/// Au plus, commits lus pour les notes d'une release.
const NOTES_LIMIT: &str = "--max-count=500";

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NoteCommit {
    pub sha: String,
    pub subject: String,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseDraft {
    /// Tag précédent (le plus proche avant celui-ci), `None` pour le premier.
    pub previous: Option<String>,
    /// Commits du tag précédent (exclu) à ce tag, du plus récent au plus ancien, sans les merges.
    pub commits: Vec<NoteCommit>,
}

fn check_tag(tag: &str) -> Result<(), String> {
    if tag.is_empty() || tag.starts_with('-') || tag.contains(['\n', '\r', ' ']) {
        return Err("invalid_tag_name".into());
    }
    Ok(())
}

/// Commits de la release `tag` : depuis le tag précédent (`git describe --tags --abbrev=0 tag^`).
pub fn draft(path: &Path, tag: &str) -> Result<ReleaseDraft, String> {
    check_dir(path)?;
    check_tag(tag)?;
    let full = format!("refs/tags/{tag}");
    run(Some(path), &["rev-parse", "-q", "--verify", &format!("{full}^{{commit}}")]).map_err(|_| "tag_not_found".to_string())?;
    let previous = run(Some(path), &["describe", "--tags", "--abbrev=0", &format!("{full}^")]).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    let range = match &previous {
        Some(p) => format!("refs/tags/{p}..{full}"),
        None => full.clone(),
    };
    let out = run(Some(path), &["log", "--no-merges", NOTES_LIMIT, "--format=%H%x1f%s", &range, "--"])?;
    let commits = out
        .lines()
        .filter_map(|l| l.split_once('\x1f'))
        .map(|(sha, subject)| NoteCommit { sha: sha.to_string(), subject: subject.to_string() })
        .collect();
    Ok(ReleaseDraft { previous, commits })
}

#[derive(serde::Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NewRelease {
    pub repo: String,
    pub tag: String,
    pub name: String,
    pub body: String,
    pub draft: bool,
    pub prerelease: bool,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CreatedRelease {
    /// Page de la release.
    pub url: String,
    /// Ce qui n'a pas pu être fait (GitLab : brouillon et pré-version n'existent pas).
    pub warnings: Vec<String>,
}

/// Crée la release du tag (déjà poussé) sur le provider.
pub fn create(kind: Kind, api: &str, token: &str, r: &NewRelease) -> Result<CreatedRelease, String> {
    check_repo(&r.repo)?;
    check_tag(&r.tag)?;
    let name = if r.name.trim().is_empty() { r.tag.clone() } else { r.name.trim().to_string() };
    let (path, body, warnings) = match kind {
        Kind::GitHub => (
            format!("{}/releases", project(kind, &r.repo)),
            json!({ "tag_name": r.tag, "name": name, "body": r.body, "draft": r.draft, "prerelease": r.prerelease }),
            Vec::new(),
        ),
        Kind::GitLab => {
            let mut w = Vec::new();
            if r.draft {
                w.push("release_draft_unsupported".to_string());
            }
            if r.prerelease {
                w.push("release_prerelease_unsupported".to_string());
            }
            (format!("{}/releases", project(kind, &r.repo)), json!({ "tag_name": r.tag, "name": name, "description": r.body }), w)
        }
    };
    let (status, v): (u16, Value) = crate::pulls::post(kind, api, &path, token, &body)?;
    if (200..300).contains(&status) {
        let url = match kind {
            Kind::GitHub => v["html_url"].as_str(),
            Kind::GitLab => v["_links"]["self"].as_str(),
        }
        .unwrap_or_default()
        .to_string();
        return Ok(CreatedRelease { url, warnings });
    }
    let text = message(&v);
    if text.contains("already_exists") || text.contains("already exists") || status == 409 {
        return Err("release_exists".into());
    }
    // GitHub : 422 « tag_name … invalid » si le tag n'est pas sur le dépôt distant (et pas de
    // branche cible pour le créer) ; GitLab : 422 / 400 « Ref is not specified ».
    if (status == 422 || status == 400) && (text.contains("tag") || text.contains("ref")) {
        return Err("release_tag_missing".into());
    }
    Err(refused(status))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::tests::{commit_file, temp_repo};

    fn req(repo: &str, draft: bool) -> NewRelease {
        NewRelease { repo: repo.into(), tag: "v1.0.0".into(), name: " ".into(), body: "Notes".into(), draft, prerelease: false }
    }

    #[test]
    fn creates_on_github_and_gitlab() {
        let (url, requests) = crate::providers::tests::serve(vec![
            (201, r#"{"html_url":"https://github.com/o/r/releases/tag/v1.0.0"}"#),
            (201, r#"{"_links":{"self":"https://gitlab.com/o/r/-/releases/v1.0.0"}}"#),
        ]);
        let gh = create(Kind::GitHub, &url, "t", &req("o/r", true)).unwrap();
        assert_eq!(gh.url, "https://github.com/o/r/releases/tag/v1.0.0");
        assert!(gh.warnings.is_empty());
        let r = requests.recv().unwrap();
        assert!(r.starts_with("POST /repos/o/r/releases "), "{r}");
        // Sans nom : celui du tag.
        assert!(r.contains(r#""name":"v1.0.0""#) && r.contains(r#""draft":true"#), "{r}");
        let gl = create(Kind::GitLab, &url, "t", &req("o/r", true)).unwrap();
        assert_eq!(gl.url, "https://gitlab.com/o/r/-/releases/v1.0.0");
        assert_eq!(gl.warnings, ["release_draft_unsupported"]);
        let r = requests.recv().unwrap();
        assert!(r.starts_with("POST /projects/o%2Fr/releases "), "{r}");
        assert!(r.contains(r#""description":"Notes""#), "{r}");
    }

    #[test]
    fn release_errors() {
        let (url, _r) = crate::providers::tests::serve(vec![
            (422, r#"{"errors":[{"code":"already_exists","field":"tag_name"}]}"#),
            (422, r#"{"message":"Validation Failed","errors":[{"field":"tag_name","code":"invalid"}]}"#),
            (403, "{}"),
        ]);
        assert_eq!(create(Kind::GitHub, &url, "t", &req("o/r", false)).unwrap_err(), "release_exists");
        assert_eq!(create(Kind::GitHub, &url, "t", &req("o/r", false)).unwrap_err(), "release_tag_missing");
        assert_eq!(create(Kind::GitHub, &url, "t", &req("o/r", false)).unwrap_err(), "pull_forbidden");
    }

    #[test]
    fn draft_lists_commits_since_the_previous_tag() {
        let repo = temp_repo();
        let p = repo.path();
        commit_file(p, "a.txt", "1");
        run(Some(p), &["tag", "v0.1.0"]).unwrap();
        commit_file(p, "a.txt", "2");
        run(Some(p), &["commit", "-q", "--amend", "-m", "feat: deux"]).unwrap();
        commit_file(p, "a.txt", "3");
        run(Some(p), &["commit", "-q", "--amend", "-m", "fix(ui): trois"]).unwrap();
        run(Some(p), &["tag", "-a", "v0.2.0", "-m", "deux"]).unwrap();
        let d = draft(p, "v0.2.0").unwrap();
        assert_eq!(d.previous.as_deref(), Some("v0.1.0"));
        assert_eq!(d.commits.iter().map(|c| c.subject.as_str()).collect::<Vec<_>>(), ["fix(ui): trois", "feat: deux"]);
        let first = draft(p, "v0.1.0").unwrap();
        assert_eq!(first.previous, None);
        assert_eq!(first.commits.len(), 1);
        assert_eq!(draft(p, "absent").unwrap_err(), "tag_not_found");
    }
}
