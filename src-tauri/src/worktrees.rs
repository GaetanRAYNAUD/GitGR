//! Worktrees du dépôt (`git worktree`) : lister, créer depuis une branche ou un commit,
//! supprimer, nettoyer ceux dont le dossier a disparu.

use crate::branches::classify;
use crate::git::run;
use crate::history::check_dir;
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Serialize, Debug, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    /// Dossier de la copie de travail (séparateurs `/`).
    pub path: String,
    /// Commit extrait ; `None` pour un dépôt sans commit.
    pub head: Option<String>,
    /// Branche extraite (`main`), `None` en HEAD détachée.
    pub branch: Option<String>,
    /// Le dépôt principal (le premier de la liste).
    pub main: bool,
    /// Celui de ce dépôt (le dossier ouvert).
    pub current: bool,
    /// Verrouillé (`git worktree lock`), avec la raison s'il y en a une.
    pub locked: Option<String>,
    /// Dossier disparu : à nettoyer (`prune`), avec la raison donnée par git.
    pub prunable: Option<String>,
}

fn norm(p: &str) -> String {
    let s = p.replace('\\', "/");
    let s = s.trim_end_matches('/').to_string();
    if cfg!(windows) { s.to_lowercase() } else { s }
}

/// Sortie de `git worktree list --porcelain` → worktrees (le principal en premier).
fn parse_list(out: &str, here: &str) -> Vec<Worktree> {
    let mut list: Vec<Worktree> = Vec::new();
    for block in out.split("\n\n") {
        let mut w = Worktree::default();
        let mut seen = false;
        for line in block.lines() {
            let (key, value) = line.split_once(' ').unwrap_or((line, ""));
            match key {
                "worktree" => {
                    w.path = value.replace('\\', "/");
                    seen = true;
                }
                "HEAD" => w.head = Some(value.to_string()).filter(|h| !h.chars().all(|c| c == '0')),
                "branch" => w.branch = Some(value.trim_start_matches("refs/heads/").to_string()),
                "locked" => w.locked = Some(value.to_string()),
                "prunable" => w.prunable = Some(value.to_string()),
                _ => {}
            }
        }
        if seen {
            w.main = list.is_empty();
            w.current = norm(&w.path) == norm(here);
            list.push(w);
        }
    }
    list
}

/// Worktrees du dépôt de `path` (principal compris).
pub fn list(path: &Path) -> Result<Vec<Worktree>, String> {
    check_dir(path)?;
    let here = crate::git::toplevel(path)?;
    let out = run(Some(path), &["worktree", "list", "--porcelain"])?;
    Ok(parse_list(&out, &here.to_string_lossy()))
}

/// Dossier proposé pour un nouveau worktree : à côté du dépôt principal,
/// `<dépôt>-<branche>` (les `/` de la branche deviennent des `-`), sans écraser un dossier.
pub fn suggest_dir(path: &Path, branch: &str) -> Result<String, String> {
    check_dir(path)?;
    let main = list(path)?.into_iter().next().map(|w| PathBuf::from(w.path)).unwrap_or_else(|| path.to_path_buf());
    let name = main.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "depot".into());
    let slug: String = branch.chars().map(|c| if c == '/' || c == '\\' || c.is_whitespace() { '-' } else { c }).collect();
    let parent = main.parent().map(Path::to_path_buf).unwrap_or_else(|| main.clone());
    let mut dir = parent.join(format!("{name}-{slug}"));
    let mut n = 2;
    while dir.exists() {
        dir = parent.join(format!("{name}-{slug}-{n}"));
        n += 1;
    }
    Ok(dir.to_string_lossy().replace('\\', "/"))
}

/// Crée un worktree dans `dir` : sur la branche existante `branch`, ou sur une nouvelle branche
/// `new_branch` partant de `start` (HEAD si absent), ou détaché sur `start`.
pub fn add(path: &Path, dir: &str, branch: Option<&str>, new_branch: Option<&str>, start: Option<&str>) -> Result<(), String> {
    check_dir(path)?;
    let dir = dir.trim();
    if dir.is_empty() || dir.starts_with('-') {
        return Err("invalid_path".into());
    }
    if Path::new(dir).exists() && Path::new(dir).read_dir().map(|mut d| d.next().is_some()).unwrap_or(true) {
        return Err("worktree_dir_exists".into());
    }
    for name in [branch, new_branch, start].into_iter().flatten() {
        if name.is_empty() || name.starts_with('-') {
            return Err("invalid_branch_name".into());
        }
    }
    let mut args: Vec<&str> = vec!["worktree", "add", "-q"];
    match (branch, new_branch) {
        (Some(b), None) => args.extend([dir, b]),
        (None, Some(nb)) => {
            args.extend(["-b", nb, dir]);
            args.extend(start);
        }
        (None, None) => {
            args.extend(["--detach", dir]);
            args.extend(start);
        }
        (Some(_), Some(_)) => return Err("invalid_branch_name".into()),
    }
    run(Some(path), &args).map(|_| ()).map_err(|e| {
        if e.contains("is already used by worktree") || e.contains("is already checked out at") {
            "branch_in_worktree".to_string()
        } else if e.contains("already exists") && new_branch.is_some() && e.contains("branch") {
            "branch_exists".to_string()
        } else {
            classify(&e)
        }
    })
}

/// Supprime le worktree `dir` ; sans `force`, `worktree_dirty` s'il a des modifications.
pub fn remove(path: &Path, dir: &str, force: bool) -> Result<(), String> {
    check_dir(path)?;
    if dir.trim().is_empty() || dir.starts_with('-') {
        return Err("invalid_path".into());
    }
    let mut args = vec!["worktree", "remove"];
    if force {
        args.push("--force");
    }
    args.push(dir);
    run(Some(path), &args).map(|_| ()).map_err(|e| {
        if e.contains("contains modified or untracked files") {
            "worktree_dirty".to_string()
        } else if e.contains("is a main working tree") {
            "worktree_main".to_string()
        } else if e.contains("is locked") {
            "worktree_locked".to_string()
        } else {
            e
        }
    })
}

/// Oublie les worktrees dont le dossier a disparu (`git worktree prune`).
pub fn prune(path: &Path) -> Result<(), String> {
    check_dir(path)?;
    run(Some(path), &["worktree", "prune"]).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::tests::{commit_file, temp_repo};

    #[test]
    fn parses_porcelain_list() {
        let out = "worktree C:/r/main\nHEAD 1111111111111111111111111111111111111111\nbranch refs/heads/main\n\nworktree C:/r/main-x\nHEAD 2222222222222222222222222222222222222222\ndetached\nlocked en voyage\n\nworktree C:/r/gone\nHEAD 3333333333333333333333333333333333333333\nbranch refs/heads/feature/a\nprunable gitdir file points to non-existent location\n";
        let l = parse_list(out, "C:/r/main-x/");
        assert_eq!(l.len(), 3);
        assert!(l[0].main && !l[0].current);
        assert_eq!(l[0].branch.as_deref(), Some("main"));
        assert!(l[1].current && l[1].branch.is_none());
        assert_eq!(l[1].locked.as_deref(), Some("en voyage"));
        assert_eq!(l[2].branch.as_deref(), Some("feature/a"));
        assert!(l[2].prunable.is_some());
    }

    #[test]
    fn add_list_remove_prune() {
        let repo = temp_repo();
        let p = repo.path();
        commit_file(p, "a.txt", "1");
        let base = tempfile::tempdir().unwrap();
        let dir = base.path().join("wt").to_string_lossy().replace('\\', "/");
        add(p, &dir, None, Some("sujet"), None).unwrap();
        let l = list(p).unwrap();
        assert_eq!(l.len(), 2);
        assert!(l[0].main && l[0].current);
        assert_eq!(l[1].branch.as_deref(), Some("sujet"));
        // Branche déjà extraite ailleurs : refus nommé.
        let other = base.path().join("wt2").to_string_lossy().replace('\\', "/");
        assert_eq!(add(p, &other, Some("sujet"), None, None).unwrap_err(), "branch_in_worktree");
        // Vu depuis le worktree lié : c'est lui le courant.
        let from_linked = list(Path::new(&dir)).unwrap();
        assert!(from_linked[1].current && !from_linked[0].current);
        // Modifications : suppression refusée sans force.
        std::fs::write(Path::new(&dir).join("b.txt"), "x").unwrap();
        assert_eq!(remove(p, &dir, false).unwrap_err(), "worktree_dirty");
        remove(p, &dir, true).unwrap();
        assert_eq!(list(p).unwrap().len(), 1);
        // Dossier effacé à la main : nettoyé par prune.
        add(p, &other, None, None, Some("HEAD")).unwrap();
        std::fs::remove_dir_all(&other).unwrap();
        assert!(list(p).unwrap()[1].prunable.is_some());
        prune(p).unwrap();
        assert_eq!(list(p).unwrap().len(), 1);
    }

    #[test]
    fn suggests_a_free_sibling_folder() {
        let base = tempfile::tempdir().unwrap();
        let main = base.path().join("app");
        std::fs::create_dir(&main).unwrap();
        crate::git::run(Some(&main), &["init", "-q", "-b", "main"]).unwrap();
        let d = suggest_dir(&main, "feature/x").unwrap();
        assert!(d.ends_with("/app-feature-x"), "{d}");
        std::fs::create_dir(&d).unwrap();
        assert!(suggest_dir(&main, "feature/x").unwrap().ends_with("/app-feature-x-2"));
    }
}
