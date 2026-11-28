//! Rebase interactif visuel : les commits de la branche courante depuis une base, réordonnés,
//! renommés, réunis ou retirés, puis rejoués par `git rebase -i` avec la liste écrite par GitGR
//! (`GIT_SEQUENCE_EDITOR`). Un nouveau message passe par `exec git commit --amend -F` : git
//! n'ouvre aucun éditeur.

use crate::branches::{classify, git_dir, operation, with_autostash, OpResult};
use crate::git::{run, run_env};
use crate::history::{check_dir, check_sha};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Au plus, commits proposés à la réécriture.
const PLAN_LIMIT: usize = 500;

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlanCommit {
    pub sha: String,
    pub subject: String,
    /// Message complet (pour « Renommer »).
    pub message: String,
    pub author: String,
    pub time: i64,
    /// Déjà sur une branche distante : le réécrire demandera un push forcé.
    pub pushed: bool,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RebasePlan {
    /// Commits à rejouer, du plus ancien au plus récent.
    pub commits: Vec<PlanCommit>,
    /// Base réelle (SHA), `None` : depuis le premier commit du dépôt.
    pub base: Option<String>,
}

#[derive(Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Step {
    pub sha: String,
    /// `pick`, `reword`, `squash`, `fixup`, `drop`.
    pub action: String,
    /// Nouveau message (`reword`).
    pub message: Option<String>,
}

/// Commits de la branche courante après `base` (une ref, un SHA ; `None` : tout l'historique).
/// Refusé s'il y a des merges dans la plage (le rebase les aplatirait). Sans `onto` (« à partir
/// d'ici »), la base doit être un ancêtre de HEAD : sinon le rebase déplacerait la branche.
pub fn plan(path: &Path, base: Option<&str>, onto: bool) -> Result<RebasePlan, String> {
    check_dir(path)?;
    run(Some(path), &["symbolic-ref", "-q", "--short", "HEAD"]).map_err(|_| "detached_head".to_string())?;
    let base_sha = match base {
        Some(b) => {
            if b.starts_with('-') {
                return Err("invalid_start_point".into());
            }
            Some(run(Some(path), &["rev-parse", "-q", "--verify", &format!("{b}^{{commit}}")]).map_err(|_| "invalid_start_point".to_string())?)
        }
        None => None,
    };
    if let (Some(b), false) = (&base_sha, onto) {
        if run(Some(path), &["merge-base", "--is-ancestor", b, "HEAD"]).is_err() {
            return Err("rebase_not_ancestor".into());
        }
    }
    let range = match &base_sha {
        Some(b) => format!("{b}..HEAD"),
        None => "HEAD".to_string(),
    };
    if !run(Some(path), &["rev-list", "--merges", "-n", "1", &range])?.is_empty() {
        return Err("rebase_merges".into());
    }
    // Un de plus que la limite : assez pour savoir qu'elle est dépassée, sans tout lire.
    let count = run(Some(path), &["rev-list", "--count", &format!("--max-count={}", PLAN_LIMIT + 1), &range])?;
    if count.trim().parse::<usize>().unwrap_or(0) > PLAN_LIMIT {
        return Err("rebase_too_many".into());
    }
    let out = run(Some(path), &["log", "--reverse", "-z", "--format=%H%x1f%s%x1f%an%x1f%at%x1f%B", &range, "--"])?;
    let mut commits: Vec<PlanCommit> = out
        .split('\0')
        .filter(|r| !r.trim().is_empty())
        .filter_map(|rec| {
            let rec = rec.trim_start_matches('\n');
            let mut f = rec.splitn(5, '\x1f');
            Some(PlanCommit {
                sha: f.next()?.to_string(),
                subject: f.next()?.to_string(),
                author: f.next()?.to_string(),
                time: f.next()?.parse().unwrap_or(0),
                message: f.next().unwrap_or("").trim_end().to_string(),
                pushed: false,
            })
        })
        .collect();
    if commits.is_empty() {
        return Err("rebase_nothing".into());
    }
    if commits.len() > PLAN_LIMIT {
        return Err("rebase_too_many".into());
    }
    // Commits déjà sur une branche distante : ceux que `--remotes` atteint.
    let remote = run(Some(path), &["rev-list", &range, "--not", "--remotes"]).unwrap_or_default();
    let local: std::collections::HashSet<&str> = remote.lines().collect();
    for c in &mut commits {
        c.pushed = !local.contains(c.sha.as_str());
    }
    Ok(RebasePlan { commits, base: base_sha })
}

/// Chemin pour la commande shell lancée par git (`sh`, celui de Git pour Windows aussi) :
/// `/` partout, entre apostrophes.
fn sh_path(p: &Path) -> String {
    format!("'{}'", p.to_string_lossy().replace('\\', "/").replace('\'', r"'\''"))
}

/// Liste `git-rebase-todo` des étapes ; messages des `reword` écrits dans `dir`.
fn todo(steps: &[Step], dir: &Path) -> Result<String, String> {
    let mut out = String::new();
    for (i, s) in steps.iter().enumerate() {
        check_sha(&s.sha)?;
        match s.action.as_str() {
            "pick" | "drop" => out.push_str(&format!("{} {}\n", s.action, s.sha)),
            "squash" | "fixup" => {
                // Rien avant à quoi le réunir (premier, ou seulement des commits retirés avant).
                if !steps[..i].iter().any(|p| p.action != "drop") {
                    return Err("rebase_squash_first".into());
                }
                out.push_str(&format!("{} {}\n", s.action, s.sha));
            }
            "reword" => {
                let msg = s.message.as_deref().map(str::trim).filter(|m| !m.is_empty()).ok_or("empty_message")?;
                let file = dir.join(format!("msg-{i}"));
                std::fs::write(&file, format!("{msg}\n")).map_err(|e| e.to_string())?;
                out.push_str(&format!("pick {}\n", s.sha));
                out.push_str(&format!("exec git commit --amend -q --allow-empty --no-verify -F {}\n", sh_path(&file)));
            }
            _ => return Err("invalid_action".into()),
        }
    }
    if !steps.iter().any(|s| s.action != "drop") {
        return Err("rebase_all_dropped".into());
    }
    Ok(out)
}

/// Rejoue les commits après `base` selon `steps` (dans leur ordre). S'arrête comme un rebase
/// ordinaire sur des conflits (`conflicts`), à continuer depuis l'interface.
pub fn run_rebase(path: &Path, base: Option<&str>, onto: bool, steps: &[Step], auto_stash: bool) -> Result<OpResult, String> {
    check_dir(path)?;
    if operation(path).is_some() {
        return Err("operation_in_progress".into());
    }
    let p = plan(path, base, onto)?;
    // Les étapes reprennent exactement les commits de la plage (aucun en plus, aucun oublié).
    let mut want: Vec<&str> = p.commits.iter().map(|c| c.sha.as_str()).collect();
    let mut got: Vec<&str> = steps.iter().map(|s| s.sha.as_str()).collect();
    want.sort_unstable();
    got.sort_unstable();
    if want != got {
        return Err("rebase_plan_changed".into());
    }
    let dir: PathBuf = git_dir(path)?.join("gitgr-rebase");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let list = dir.join("todo");
    std::fs::write(&list, todo(steps, &dir)?).map_err(|e| e.to_string())?;
    let editor = format!("cp {}", sh_path(&list));
    let branch = run(Some(path), &["symbolic-ref", "-q", "--short", "HEAD"]).unwrap_or_else(|_| "HEAD".into());
    let base_arg = p.base.clone();
    with_autostash(path, auto_stash, &branch, || {
        let mut args = vec!["rebase", "-i", "--no-autosquash"];
        match &base_arg {
            Some(b) => args.push(b),
            None => args.push("--root"),
        }
        match run_env(Some(path), &args, &[("GIT_SEQUENCE_EDITOR", &editor), ("GIT_EDITOR", "true")]) {
            Ok(_) => Ok(OpResult::default()),
            Err(_) if operation(path) == Some("rebase") && crate::branches::has_conflicts(path) => Ok(OpResult { conflicts: true, ..Default::default() }),
            Err(e) if operation(path) == Some("rebase") => {
                let _ = run(Some(path), &["rebase", "--abort"]);
                Err(classify(&e))
            }
            Err(e) => Err(classify(&e)),
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::tests::{commit_file, temp_repo};

    fn subjects(p: &Path, n: usize) -> Vec<String> {
        run(Some(p), &["log", "--format=%s", "-n", &n.to_string()]).unwrap().lines().map(str::to_string).collect()
    }

    fn setup() -> (tempfile::TempDir, Vec<String>) {
        let repo = temp_repo();
        let p = repo.path();
        commit_file(p, "base.txt", "0");
        let mut shas = vec![];
        for (i, name) in ["a", "b", "c", "d"].iter().enumerate() {
            std::fs::write(p.join(format!("{name}.txt")), format!("{i}")).unwrap();
            run(Some(p), &["add", "."]).unwrap();
            run(Some(p), &["commit", "-qm", name]).unwrap();
            shas.push(run(Some(p), &["rev-parse", "HEAD"]).unwrap());
        }
        (repo, shas)
    }

    fn step(sha: &str, action: &str, message: Option<&str>) -> Step {
        Step { sha: sha.into(), action: action.into(), message: message.map(str::to_string) }
    }

    #[test]
    fn plans_the_commits_after_the_base() {
        let (repo, shas) = setup();
        let p = repo.path();
        let plan = plan(p, Some(&format!("{}^", shas[0])), false).unwrap();
        assert_eq!(plan.commits.iter().map(|c| c.subject.as_str()).collect::<Vec<_>>(), ["a", "b", "c", "d"]);
        assert!(plan.commits.iter().all(|c| !c.pushed));
        assert_eq!(super::plan(p, Some("HEAD"), false).unwrap_err(), "rebase_nothing");
        // « À partir d'ici » sur un commit d'une autre branche : refusé ; « ici » (onto) : permis.
        run(Some(p), &["switch", "-q", "-c", "autre", &shas[1]]).unwrap();
        commit_file(p, "z.txt", "z");
        let other = run(Some(p), &["rev-parse", "HEAD"]).unwrap();
        run(Some(p), &["switch", "-q", "main"]).unwrap();
        assert_eq!(super::plan(p, Some(&other), false).unwrap_err(), "rebase_not_ancestor");
        assert_eq!(super::plan(p, Some("autre"), true).unwrap().commits.len(), 2);
    }

    #[test]
    fn reorders_rewords_squashes_and_drops() {
        let (repo, shas) = setup();
        let p = repo.path();
        let base = format!("{}^", shas[0]);
        // d en premier, a renommé, b réuni dans a, c retiré.
        let steps = [step(&shas[3], "pick", None), step(&shas[0], "reword", Some("A renommé")), step(&shas[1], "fixup", None), step(&shas[2], "drop", None)];
        let res = run_rebase(p, Some(&base), false, &steps, true).unwrap();
        assert!(!res.conflicts);
        assert_eq!(subjects(p, 3), ["A renommé", "d", "test"]);
        assert!(p.join("b.txt").exists() && !p.join("c.txt").exists());
        assert_eq!(operation(p), None);
    }

    #[test]
    fn refuses_bad_plans() {
        let (repo, shas) = setup();
        let p = repo.path();
        let base = format!("{}^", shas[0]);
        let all = |a: &str| shas.iter().map(|s| step(s, a, None)).collect::<Vec<_>>();
        assert_eq!(run_rebase(p, Some(&base), false, &all("drop"), true).unwrap_err(), "rebase_all_dropped");
        let mut s = all("pick");
        s[0].action = "squash".into();
        assert_eq!(run_rebase(p, Some(&base), false, &s, true).unwrap_err(), "rebase_squash_first");
        assert_eq!(run_rebase(p, Some(&base), false, &all("pick")[1..], true).unwrap_err(), "rebase_plan_changed");
        let mut s = all("pick");
        s[1].action = "reword".into();
        assert_eq!(run_rebase(p, Some(&base), false, &s, true).unwrap_err(), "empty_message");
        assert_eq!(operation(p), None);
    }

    #[test]
    fn stops_on_conflicts() {
        let repo = temp_repo();
        let p = repo.path();
        commit_file(p, "f.txt", "0\n");
        let base = run(Some(p), &["rev-parse", "HEAD"]).unwrap();
        commit_file(p, "f.txt", "1\n");
        let one = run(Some(p), &["rev-parse", "HEAD"]).unwrap();
        commit_file(p, "f.txt", "2\n");
        let two = run(Some(p), &["rev-parse", "HEAD"]).unwrap();
        // Inverser deux modifications de la même ligne : conflit.
        let res = run_rebase(p, Some(&base), false, &[step(&two, "pick", None), step(&one, "pick", None)], true).unwrap();
        assert!(res.conflicts);
        assert_eq!(operation(p), Some("rebase"));
        run(Some(p), &["rebase", "--abort"]).unwrap();
    }
}
