//! Bisect visuel : marquer des commits bons / mauvais (`git bisect`), suivre la plage qui
//! reste et le commit à tester, jusqu'au premier mauvais commit.
//!
//! Le checkout du commit à tester passe par l'auto-stash, comme un checkout ordinaire.

use crate::branches::{classify, with_autostash, OpResult};
use crate::git::run;
use crate::history::{check_dir, check_sha};
use serde::Serialize;
use std::path::Path;

/// Au plus, commits de la plage restante renvoyés (pour la mise en évidence du graphe).
const CANDIDATES_LIMIT: usize = 20_000;

#[derive(Serialize, Debug, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct BisectState {
    /// Commit marqué mauvais (le plus récent connu).
    pub bad: Option<String>,
    pub good: Vec<String>,
    pub skipped: Vec<String>,
    /// Commit extrait, à tester (HEAD).
    pub current: Option<String>,
    /// Commits qui restent à départager (sans le mauvais connu) ; `None` tant qu'il manque un
    /// bon ou le mauvais.
    pub remaining: Option<u32>,
    /// Nombre d'étapes restantes, environ.
    pub steps: Option<u32>,
    /// Trouvé : le premier mauvais commit.
    pub first_bad: Option<String>,
    /// Plus rien à tester mais des commits passés restent : le premier mauvais est l'un d'eux
    /// ou le mauvais connu (du plus récent au plus ancien).
    pub possible: Vec<String>,
    /// Commits de la plage encore en jeu (mauvais compris), du plus récent au plus ancien.
    pub candidates: Vec<String>,
}

fn git_path(path: &Path, name: &str) -> Result<std::path::PathBuf, String> {
    let p = run(Some(path), &["rev-parse", "--git-path", name])?;
    let p = std::path::PathBuf::from(p.trim());
    Ok(if p.is_absolute() { p } else { path.join(p) })
}

/// Un bisect est-il en cours (`BISECT_START` présent) ?
pub fn in_progress(path: &Path) -> bool {
    git_path(path, "BISECT_START").map(|p| p.exists()).unwrap_or(false)
}

/// Étapes restantes environ pour `left` commits à départager (log2, au moins 1).
fn steps_for(left: u32) -> u32 {
    if left == 0 {
        0
    } else {
        (u32::BITS - left.leading_zeros()).saturating_sub(1).max(1)
    }
}

/// État du bisect en cours ; `None` s'il n'y en a pas.
pub fn state(path: &Path) -> Result<Option<BisectState>, String> {
    check_dir(path)?;
    if !in_progress(path) {
        return Ok(None);
    }
    let mut s = BisectState::default();
    let refs = run(Some(path), &["for-each-ref", "--format=%(refname) %(objectname)", "refs/bisect/"]).unwrap_or_default();
    for line in refs.lines() {
        let Some((name, sha)) = line.split_once(' ') else { continue };
        let sha = sha.to_string();
        if name == "refs/bisect/bad" {
            s.bad = Some(sha);
        } else if name.starts_with("refs/bisect/good-") {
            s.good.push(sha);
        } else if name.starts_with("refs/bisect/skip-") {
            s.skipped.push(sha);
        }
    }
    s.current = run(Some(path), &["rev-parse", "-q", "--verify", "HEAD"]).ok().map(|x| x.trim().to_string());
    if let (Some(bad), false) = (&s.bad, s.good.is_empty()) {
        let mut args: Vec<String> = vec!["rev-list".into(), bad.clone(), "--not".into()];
        args.extend(s.good.iter().cloned());
        let a: Vec<&str> = args.iter().map(String::as_str).collect();
        let all: Vec<String> = run(Some(path), &a)?.lines().map(str::to_string).filter(|l| !l.is_empty()).collect();
        let open: Vec<&String> = all.iter().filter(|c| !s.skipped.contains(c)).collect();
        // Plus rien que le mauvais lui-même : trouvé, ou ambigu s'il reste des commits passés.
        if open.len() == 1 && open[0] == bad {
            if all.len() == 1 {
                s.first_bad = Some(bad.clone());
            } else {
                s.possible = all.clone();
            }
        }
        let left = open.len().saturating_sub(1) as u32;
        s.remaining = Some(left);
        s.steps = Some(steps_for(left));
        s.candidates = all.into_iter().take(CANDIDATES_LIMIT).collect();
    }
    Ok(Some(s))
}

/// Marque `sha` (HEAD si absent) bon, mauvais ou à passer ; commence le bisect au besoin. Dès
/// qu'il y a un bon et un mauvais, git extrait le commit suivant à tester (auto-stash).
pub fn mark(path: &Path, verdict: &str, sha: Option<&str>, auto_stash: bool) -> Result<(OpResult, BisectState), String> {
    check_dir(path)?;
    let verb = match verdict {
        "good" | "bad" | "skip" => verdict,
        _ => return Err("invalid_verdict".into()),
    };
    if let Some(s) = sha {
        check_sha(s)?;
    }
    let started = !in_progress(path);
    if started {
        if verb == "skip" {
            return Err("bisect_not_started".into());
        }
        run(Some(path), &["bisect", "start"]).map_err(|e| classify(&e))?;
    }
    let target = sha.unwrap_or("HEAD").to_string();
    let res = with_autostash(path, auto_stash, "bisect", || {
        match run(Some(path), &["bisect", verb, &target]) {
            // Plus que des commits passés : git s'arrête (en erreur), l'état le dit (`possible`).
            Err(e) if e.contains("only 'skip'ped commits left") => return Ok(OpResult::default()),
            other => other,
        }
        .map(|_| OpResult::default())
        .map_err(|e| {
            // Un bon plus récent que le mauvais : git refuse de continuer.
            if e.contains("merge base") || e.contains("was both good and bad") || e.contains("Some good revs are not ancestors") {
                "bisect_inconsistent".to_string()
            } else {
                classify(&e)
            }
        })
    });
    // Première marque refusée : pas de bisect à moitié commencé.
    if res.is_err() && started {
        let _ = run(Some(path), &["bisect", "reset"]);
    }
    let res = res?;
    let st = state(path)?.unwrap_or_default();
    Ok((res, st))
}

/// Lignes de la sortie gardées pour l'interface (la fin : verdicts et premier mauvais commit).
const RUN_OUTPUT_LINES: usize = 60;

/// Bisect automatique : `command` (lancée par `sh -c`, le shell de Git) est lancée sur chaque commit à
/// tester — code 0 : bon, 125 : à passer, 1 à 127 : mauvais. Il faut déjà un bon et un mauvais
/// (`bisect_needs_marks`). Renvoie l'état final et la fin de la sortie ; `bisect_run_failed`
/// (avec la sortie) si git s'arrête en route (commande introuvable, code ≥ 128…).
pub fn run_command(path: &Path, command: &str, auto_stash: bool) -> Result<(OpResult, BisectState, String), String> {
    check_dir(path)?;
    let command = command.trim();
    if command.is_empty() {
        return Err("bisect_command_empty".into());
    }
    let st = state(path)?.ok_or("bisect_not_started")?;
    if st.remaining.is_none() {
        return Err("bisect_needs_marks".into());
    }
    let output = std::cell::RefCell::new(String::new());
    let res = with_autostash(path, auto_stash, "bisect", || match run(Some(path), &["bisect", "run", "sh", "-c", command]) {
        Ok(out) => {
            *output.borrow_mut() = out;
            Ok(OpResult::default())
        }
        Err(e) => {
            *output.borrow_mut() = e.clone();
            // Seulement des commits passés à la fin : un arrêt normal, l'état le dit.
            if e.contains("only 'skip'ped commits left") {
                Ok(OpResult::default())
            } else if e.contains("local changes") || e.contains("would be overwritten") {
                Err(classify(&e))
            } else {
                Err("bisect_run_failed".into())
            }
        }
    });
    let out = output.into_inner();
    let lines: Vec<&str> = out.lines().collect();
    let tail = lines[lines.len().saturating_sub(RUN_OUTPUT_LINES)..].join("\n");
    match res {
        Ok(r) => Ok((r, state(path)?.unwrap_or_default(), tail)),
        Err(e) if e == "bisect_run_failed" => Err(format!("bisect_run_failed:{tail}")),
        Err(e) => Err(e),
    }
}

/// Arrête le bisect et revient où on était avant (`git bisect reset`, auto-stash).
pub fn reset(path: &Path, auto_stash: bool) -> Result<OpResult, String> {
    check_dir(path)?;
    if !in_progress(path) {
        return Ok(OpResult::default());
    }
    with_autostash(path, auto_stash, "bisect", || run(Some(path), &["bisect", "reset"]).map(|_| OpResult::default()).map_err(|e| classify(&e)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::tests::{commit_file, temp_repo};

    fn head(p: &Path) -> String {
        run(Some(p), &["rev-parse", "HEAD"]).unwrap()
    }

    #[test]
    fn a_test_command_finds_the_first_bad_commit() {
        let repo = temp_repo();
        let p = repo.path();
        let mut shas = vec![];
        for i in 0..8 {
            commit_file(p, "a.txt", &format!("{i}\n"));
            shas.push(head(p));
        }
        assert_eq!(run_command(p, "true", true).err().as_deref(), Some("bisect_not_started"));
        mark(p, "bad", Some(&shas[7]), true).unwrap();
        assert_eq!(run_command(p, "true", true).err().as_deref(), Some("bisect_needs_marks"));
        mark(p, "good", Some(&shas[0]), true).unwrap();
        // Mauvais dès que a.txt vaut 5 ou plus.
        let (_, st, out) = run_command(p, "test \"$(cat a.txt)\" -lt 5", true).unwrap();
        assert_eq!(st.first_bad.as_deref(), Some(shas[5].as_str()));
        assert!(out.contains("is the first bad commit"), "{out}");
        reset(p, true).unwrap();
    }

    #[test]
    fn a_failing_test_command_is_reported_with_its_output() {
        let repo = temp_repo();
        let p = repo.path();
        let mut shas = vec![];
        for i in 0..4 {
            commit_file(p, "a.txt", &format!("{i}\n"));
            shas.push(head(p));
        }
        mark(p, "bad", Some(&shas[3]), true).unwrap();
        mark(p, "good", Some(&shas[0]), true).unwrap();
        // Code 200 : git abandonne le bisect run.
        let err = run_command(p, "exit 200", true).unwrap_err();
        assert!(err.starts_with("bisect_run_failed:"), "{err}");
        reset(p, true).unwrap();
    }

    #[test]
    fn steps_are_a_log2() {
        assert_eq!([0, 1, 2, 3, 4, 7, 8, 1000].map(steps_for), [0, 1, 1, 1, 2, 2, 3, 9]);
    }

    #[test]
    fn finds_the_first_bad_commit() {
        let repo = temp_repo();
        let p = repo.path();
        let mut shas = vec![];
        for i in 0..8 {
            commit_file(p, "a.txt", &format!("{i}\n"));
            shas.push(head(p));
        }
        let culprit = shas[5].clone();
        assert_eq!(state(p).unwrap(), None);
        // Le dernier est mauvais : pas encore de bon, rien d'extrait.
        let (_, st) = mark(p, "bad", Some(&shas[7]), true).unwrap();
        assert_eq!(st.bad.as_deref(), Some(shas[7].as_str()));
        assert_eq!(st.remaining, None);
        assert_eq!(head(p), shas[7]);
        // Une modification locale ne bloque pas : auto-stash.
        std::fs::write(p.join("a.txt"), "local\n").unwrap();
        let (res, mut st) = mark(p, "good", Some(&shas[0]), true).unwrap();
        assert!(res.stashed);
        assert_eq!(st.remaining, Some(6));
        assert_eq!(st.candidates.len(), 7);
        // La modification (conflit au retour du stash) est jetée pour la suite du test.
        run(Some(p), &["reset", "-q", "--hard"]).unwrap();
        let _ = run(Some(p), &["stash", "drop", "-q"]);
        let mut guard = 0;
        while st.first_bad.is_none() {
            let cur = st.current.clone().unwrap();
            let idx = shas.iter().position(|s| *s == cur).unwrap();
            let verdict = if idx >= 5 { "bad" } else { "good" };
            st = mark(p, verdict, None, true).unwrap().1;
            guard += 1;
            assert!(guard < 6);
        }
        assert_eq!(st.first_bad.as_deref(), Some(culprit.as_str()));
        reset(p, true).unwrap();
        assert_eq!(state(p).unwrap(), None);
        assert_eq!(run(Some(p), &["branch", "--show-current"]).unwrap(), "main");
    }

    #[test]
    fn only_skipped_commits_left_is_ambiguous() {
        let repo = temp_repo();
        let p = repo.path();
        let mut shas = vec![];
        for i in 0..3 {
            commit_file(p, "a.txt", &format!("{i}\n"));
            shas.push(head(p));
        }
        mark(p, "bad", Some(&shas[2]), true).unwrap();
        let (_, st) = mark(p, "good", Some(&shas[0]), true).unwrap();
        assert_eq!(st.current.as_deref(), Some(shas[1].as_str()));
        let (_, st) = mark(p, "skip", None, true).unwrap();
        assert_eq!(st.first_bad, None);
        assert_eq!(st.possible, vec![shas[2].clone(), shas[1].clone()]);
        reset(p, true).unwrap();
    }

    #[test]
    fn a_refused_first_mark_leaves_no_bisect() {
        let repo = temp_repo();
        let p = repo.path();
        commit_file(p, "a.txt", "1");
        assert!(mark(p, "bad", Some("0123456789abcdef0123456789abcdef01234567"), true).is_err());
        assert!(!in_progress(p));
    }

    #[test]
    fn refuses_unknown_verdicts_and_skip_before_start() {
        let repo = temp_repo();
        let p = repo.path();
        commit_file(p, "a.txt", "1");
        assert_eq!(mark(p, "maybe", None, true).unwrap_err(), "invalid_verdict");
        assert_eq!(mark(p, "skip", None, true).unwrap_err(), "bisect_not_started");
        assert!(reset(p, true).is_ok());
    }
}
