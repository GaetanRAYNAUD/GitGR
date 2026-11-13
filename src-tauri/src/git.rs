//! Couche d'accès à Git via le binaire `git`.
//!
//! Les erreurs renvoyées au frontend sont des *codes* (`not_a_repo`,
//! `path_not_found`, `git_not_found`…) traduits côté interface (i18n),
//! ou, à défaut, le message brut de git.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;

/// Prépare une commande `git` qui n'ouvre pas de fenêtre console sous Windows.
fn git_command() -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new("git");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    // Sortie stable, non traduite, sans pager ni invite interactive.
    cmd.env("LC_ALL", "C")
        .env("GIT_PAGER", "cat")
        .env("GIT_TERMINAL_PROMPT", "0");
    cmd
}

/// Lance `git <args>` (dans `cwd` si fourni) et renvoie stdout.
pub fn run(cwd: Option<&Path>, args: &[&str]) -> Result<String, String> {
    let mut cmd = git_command();
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    cmd.args(args);
    let out = cmd.output().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "git_not_found".to_string()
        } else {
            e.to_string()
        }
    })?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim_end().to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitInfo {
    pub found: bool,
    pub version: Option<String>,
}

/// Détecte la présence de git et sa version.
pub fn info() -> GitInfo {
    match run(None, &["--version"]) {
        Ok(v) => GitInfo {
            found: true,
            version: Some(v.trim_start_matches("git version ").trim().to_string()),
        },
        Err(_) => GitInfo { found: false, version: None },
    }
}

/// Renvoie la racine du dépôt contenant `path`.
pub fn toplevel(path: &Path) -> Result<PathBuf, String> {
    if !path.is_dir() {
        return Err("path_not_found".into());
    }
    match run(Some(path), &["rev-parse", "--show-toplevel"]) {
        Ok(top) => Ok(PathBuf::from(top)),
        Err(e) if e == "git_not_found" => Err(e),
        Err(_) => Err("not_a_repo".into()),
    }
}

#[derive(Serialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RepoSummary {
    /// Nom de la branche courante (`None` si HEAD détachée).
    pub branch: Option<String>,
    /// SHA du commit courant (`None` si dépôt sans commit).
    pub head: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    /// Nombre de fichiers modifiés / non suivis / en conflit.
    pub changes: u32,
    pub remote_url: Option<String>,
}

/// Résumé rapide de l'état du dépôt, lu depuis `git status --porcelain=v2 --branch`.
pub fn summary(path: &Path) -> Result<RepoSummary, String> {
    if !path.is_dir() {
        return Err("path_not_found".into());
    }
    let out = run(Some(path), &["status", "--porcelain=v2", "--branch"])?;
    let mut s = parse_status(&out);
    s.remote_url = run(Some(path), &["remote", "get-url", "origin"]).ok();
    Ok(s)
}

fn parse_status(out: &str) -> RepoSummary {
    let mut s = RepoSummary::default();
    for line in out.lines() {
        if let Some(v) = line.strip_prefix("# branch.oid ") {
            if v != "(initial)" {
                s.head = Some(v.to_string());
            }
        } else if let Some(v) = line.strip_prefix("# branch.head ") {
            if v != "(detached)" {
                s.branch = Some(v.to_string());
            }
        } else if let Some(v) = line.strip_prefix("# branch.upstream ") {
            s.upstream = Some(v.to_string());
        } else if let Some(v) = line.strip_prefix("# branch.ab ") {
            // Format : "+<ahead> -<behind>"
            for part in v.split_whitespace() {
                if let Some(n) = part.strip_prefix('+') {
                    s.ahead = n.parse().unwrap_or(0);
                } else if let Some(n) = part.strip_prefix('-') {
                    s.behind = n.parse().unwrap_or(0);
                }
            }
        } else if !line.starts_with('#') && !line.is_empty() {
            s.changes += 1;
        }
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_porcelain_v2_status() {
        let out = "# branch.oid 1234abcd\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +2 -1\n1 .M N... 100644 100644 100644 a b src/x.rs\n? new.txt";
        let s = parse_status(out);
        assert_eq!(s.branch.as_deref(), Some("main"));
        assert_eq!(s.head.as_deref(), Some("1234abcd"));
        assert_eq!(s.upstream.as_deref(), Some("origin/main"));
        assert_eq!((s.ahead, s.behind, s.changes), (2, 1, 2));
    }

    #[test]
    fn parses_detached_and_initial() {
        let s = parse_status("# branch.oid (initial)\n# branch.head (detached)");
        assert!(s.branch.is_none() && s.head.is_none());
    }
}
