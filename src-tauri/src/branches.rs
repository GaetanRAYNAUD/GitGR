//! Branches et réseau : checkout (avec auto-stash), création / renommage / suppression de
//! branches, fetch, pull, push, stash pop, et opérations en cours (merge, rebase…).
//!
//! **Auto-stash** (cf. notes §2.2) : si la copie de travail est sale, les modifications sont
//! mises de côté (`stash push -u`), l'opération est faite, puis le stash est réappliqué. Si la
//! réapplication donne des conflits, le stash est **gardé** : rien n'est jamais perdu.
//!
//! Les erreurs connues sont renvoyées sous forme de codes (`branch_not_merged`,
//! `push_rejected`, `auth_failed`…), traduits côté interface.

use crate::git::{run, run_env};
use crate::history::check_dir;
use serde::Serialize;
use std::path::{Path, PathBuf};

/// Préfixe des messages de stash créés par l'auto-stash.
pub const AUTOSTASH_PREFIX: &str = "GitGR-autostash: ";

/// Résultat d'une opération qui peut passer par l'auto-stash.
#[derive(Serialize, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OpResult {
    /// Des modifications ont été mises de côté puis réappliquées.
    pub stashed: bool,
    /// Le stash n'a pas pu être réappliqué proprement : il est conservé (conflits éventuels
    /// dans la copie de travail).
    pub stash_kept: bool,
    /// L'opération elle-même s'est arrêtée sur des conflits (merge / rebase en cours).
    pub conflicts: bool,
}

// ---------------------------------------------------------------------------
// Vérifications
// ---------------------------------------------------------------------------

/// Nom de branche valide pour git (`check-ref-format --branch`), jamais pris pour une option.
fn check_branch_name(path: &Path, name: &str) -> Result<(), String> {
    if name.is_empty() || name.starts_with('-') || name.trim() != name {
        return Err("invalid_branch_name".into());
    }
    run(Some(path), &["check-ref-format", "--branch", name]).map(|_| ()).map_err(|_| "invalid_branch_name".into())
}

fn ref_exists(path: &Path, full: &str) -> bool {
    run(Some(path), &["rev-parse", "-q", "--verify", full]).is_ok()
}

fn local_exists(path: &Path, name: &str) -> bool {
    ref_exists(path, &format!("refs/heads/{name}"))
}

/// Branche courante (`None` si HEAD détachée).
fn current_branch(path: &Path) -> Option<String> {
    run(Some(path), &["symbolic-ref", "-q", "--short", "HEAD"]).ok()
}

/// Copie de travail sale (fichiers non suivis compris, ignorés exclus).
fn is_dirty(path: &Path) -> Result<bool, String> {
    Ok(!run(Some(path), &["status", "--porcelain", "--untracked-files=all"])?.is_empty())
}

fn has_conflicts(path: &Path) -> bool {
    run(Some(path), &["diff", "--name-only", "--diff-filter=U"]).map(|o| !o.is_empty()).unwrap_or(false)
}

/// Point de départ d'une branche : SHA ou nom de ref existant (jamais une option).
fn check_start(path: &Path, start: &str) -> Result<(), String> {
    if start.starts_with('-') || run(Some(path), &["rev-parse", "-q", "--verify", &format!("{start}^{{commit}}")]).is_err() {
        return Err("invalid_start_point".into());
    }
    Ok(())
}

/// Dossier `.git` du dépôt, gardé en mémoire : il ne change pas, et `status` le consulte à
/// chaque rafraîchissement (opération en cours). Relu s'il a disparu (dépôt déplacé…).
fn git_dir(path: &Path) -> Result<PathBuf, String> {
    use std::collections::HashMap;
    use std::sync::{Mutex, OnceLock};
    static CACHE: OnceLock<Mutex<HashMap<PathBuf, PathBuf>>> = OnceLock::new();
    let cache = CACHE.get_or_init(Default::default);
    if let Some(dir) = cache.lock().unwrap().get(path).filter(|d| d.is_dir()) {
        return Ok(dir.clone());
    }
    let dir = PathBuf::from(run(Some(path), &["rev-parse", "--absolute-git-dir"])?);
    cache.lock().unwrap().insert(path.to_path_buf(), dir.clone());
    Ok(dir)
}

// ---------------------------------------------------------------------------
// Opération en cours (merge, rebase, cherry-pick, revert)
// ---------------------------------------------------------------------------

/// Opération laissée en cours par git (conflits à résoudre) : "merge", "rebase",
/// "cherry-pick" ou "revert".
pub fn operation(path: &Path) -> Option<&'static str> {
    let dir = git_dir(path).ok()?;
    if dir.join("rebase-merge").is_dir() || dir.join("rebase-apply").is_dir() {
        Some("rebase")
    } else if dir.join("MERGE_HEAD").is_file() {
        Some("merge")
    } else if dir.join("CHERRY_PICK_HEAD").is_file() {
        Some("cherry-pick")
    } else if dir.join("REVERT_HEAD").is_file() {
        Some("revert")
    } else {
        None
    }
}

/// Message préparé par git pour terminer un merge (`MERGE_MSG`, sans les commentaires).
pub fn merge_message(path: &Path) -> Option<String> {
    let text = std::fs::read_to_string(git_dir(path).ok()?.join("MERGE_MSG")).ok()?;
    let msg: Vec<&str> = text.lines().filter(|l| !l.starts_with('#')).collect();
    let msg = msg.join("\n").trim().to_string();
    (!msg.is_empty()).then_some(msg)
}

/// Annule l'opération en cours (retour à l'état d'avant).
pub fn abort_operation(path: &Path) -> Result<(), String> {
    check_dir(path)?;
    let op = operation(path).ok_or("no_operation")?;
    run(Some(path), &[op, "--abort"]).map(|_| ())
}

/// Poursuit l'opération en cours une fois les conflits résolus et indexés (rebase,
/// cherry-pick, revert ; un merge se termine par un commit).
pub fn continue_operation(path: &Path) -> Result<OpResult, String> {
    check_dir(path)?;
    let op = operation(path).ok_or("no_operation")?;
    if op == "merge" {
        return Err("merge_needs_commit".into());
    }
    if has_conflicts(path) {
        return Err("unresolved_conflicts".into());
    }
    // Pas d'éditeur : le message d'origine est repris tel quel.
    let res = run_env(Some(path), &[op, "--continue"], &[("GIT_EDITOR", "true")]);
    match res {
        Ok(_) => Ok(OpResult::default()),
        // Le commit suivant du rebase est lui aussi en conflit.
        Err(_) if operation(path).is_some() && has_conflicts(path) => Ok(OpResult { conflicts: true, ..Default::default() }),
        Err(e) => Err(classify(&e)),
    }
}

// ---------------------------------------------------------------------------
// Auto-stash
// ---------------------------------------------------------------------------

/// Réapplique le dernier stash, état de l'index compris si possible. Faux si le stash a dû
/// être gardé (conflits, fichier non suivi déjà présent…).
fn pop_stash(path: &Path) -> bool {
    if run(Some(path), &["stash", "pop", "-q", "--index"]).is_ok() {
        return true;
    }
    // `--index` échoue sans rien toucher quand l'index ne peut pas être restauré ; sans
    // lui, les modifications reviennent (non indexées). Si la copie de travail a déjà été
    // modifiée (conflits), on n'essaie pas une seconde fois.
    if has_conflicts(path) || is_dirty(path).unwrap_or(true) {
        return false;
    }
    run(Some(path), &["stash", "pop", "-q"]).is_ok()
}

/// Lance `op` (déjà classée : renvoie des codes d'erreur). Le stash n'est fait **que si git
/// refuse** à cause des modifications locales (`local_changes_conflict`) : sinon git les
/// garde telles quelles, sans réécrire un seul fichier. Les fichiers ne restent ainsi
/// stashés que lorsque c'est indispensable — moins de risque de les « perdre de vue » si
/// l'app est interrompue entre-temps (cf. le bandeau de récupération côté interface).
/// Avec le stash : `op` est relancée, puis les modifications réappliquées ; si `op` échoue
/// encore, elles sont réappliquées tout de suite (HEAD n'a pas bougé).
fn with_autostash(
    path: &Path,
    auto_stash: bool,
    label: &str,
    op: impl Fn() -> Result<OpResult, String>,
) -> Result<OpResult, String> {
    if has_conflicts(path) {
        return Err("unresolved_conflicts".into());
    }
    match op() {
        Err(e) if e == "local_changes_conflict" && auto_stash && is_dirty(path)? => {}
        other => return other,
    }
    let message = format!("{AUTOSTASH_PREFIX}{label}");
    run(Some(path), &["stash", "push", "-q", "-u", "-m", &message])?;
    match op() {
        Err(e) => {
            pop_stash(path);
            Err(e)
        }
        // L'opération attend la résolution de ses conflits : le stash attendra aussi.
        Ok(r) if r.conflicts => Ok(OpResult { stashed: true, stash_kept: true, conflicts: true }),
        Ok(_) => {
            let clean = pop_stash(path);
            Ok(OpResult { stashed: true, stash_kept: !clean, conflicts: false })
        }
    }
}

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

fn switch(path: &Path, args: &[&str]) -> Result<OpResult, String> {
    let mut all = vec!["switch", "-q"];
    all.extend_from_slice(args);
    run(Some(path), &all).map(|_| OpResult::default()).map_err(|e| classify(&e))
}

/// Passe sur la branche locale `name`.
pub fn checkout(path: &Path, name: &str, auto_stash: bool) -> Result<OpResult, String> {
    check_dir(path)?;
    if name.starts_with('-') || !local_exists(path, name) {
        return Err("branch_not_found".into());
    }
    if current_branch(path).as_deref() == Some(name) {
        return Ok(OpResult::default());
    }
    let label = current_branch(path).unwrap_or_else(|| "HEAD".into());
    with_autostash(path, auto_stash, &label, || switch(path, &[name]))
}

/// Passe sur la branche distante `remote_branch` (`origin/feature/x`) : la branche locale du
/// même nom si elle existe, sinon une nouvelle branche locale qui la suit. Renvoie aussi le
/// nom de la branche locale.
pub fn checkout_remote(path: &Path, remote_branch: &str, auto_stash: bool) -> Result<(OpResult, String), String> {
    check_dir(path)?;
    if remote_branch.starts_with('-') || !ref_exists(path, &format!("refs/remotes/{remote_branch}")) {
        return Err("branch_not_found".into());
    }
    let local = local_name_of(path, remote_branch).ok_or("branch_not_found")?;
    if local_exists(path, &local) {
        return checkout(path, &local, auto_stash).map(|r| (r, local));
    }
    check_branch_name(path, &local)?;
    let label = current_branch(path).unwrap_or_else(|| "HEAD".into());
    let full = format!("refs/remotes/{remote_branch}");
    let r = with_autostash(path, auto_stash, &label, || switch(path, &["-c", &local, "--track", &full]))?;
    Ok((r, local))
}

/// Nom de la branche locale correspondant à une branche distante : `origin/feature/x` →
/// `feature/x` (le nom du remote, qui peut contenir des `/`, est retiré).
fn local_name_of(path: &Path, remote_branch: &str) -> Option<String> {
    let remotes = run(Some(path), &["remote"]).ok()?;
    // Le remote le plus long qui correspond (`origin` et `origin/miroir` peuvent coexister).
    remotes
        .lines()
        .filter_map(|r| Some((r.len(), remote_branch.strip_prefix(r)?.strip_prefix('/')?)))
        .filter(|(_, rest)| !rest.is_empty())
        .max_by_key(|(len, _)| *len)
        .map(|(_, rest)| rest.to_string())
}

/// Détache HEAD sur un commit.
pub fn checkout_detached(path: &Path, sha: &str, auto_stash: bool) -> Result<OpResult, String> {
    check_dir(path)?;
    check_start(path, sha)?;
    let label = current_branch(path).unwrap_or_else(|| "HEAD".into());
    with_autostash(path, auto_stash, &label, || switch(path, &["--detach", sha]))
}

// ---------------------------------------------------------------------------
// Créer, renommer, supprimer
// ---------------------------------------------------------------------------

/// Crée la branche `name` sur `start` (HEAD si absent), et passe dessus si `checkout`.
pub fn create_branch(path: &Path, name: &str, start: Option<&str>, checkout: bool, auto_stash: bool) -> Result<OpResult, String> {
    check_dir(path)?;
    check_branch_name(path, name)?;
    if local_exists(path, name) {
        return Err("branch_exists".into());
    }
    if let Some(s) = start {
        check_start(path, s)?;
    }
    let start = start.unwrap_or("HEAD");
    if !checkout {
        run(Some(path), &["branch", "--no-track", name, start]).map_err(|e| classify(&e))?;
        return Ok(OpResult::default());
    }
    // Depuis le commit courant, git garde les modifications telles quelles : pas de stash.
    let commit = |r: &str| run(Some(path), &["rev-parse", "-q", "--verify", &format!("{r}^{{commit}}")]).ok();
    if commit(start) == commit("HEAD") {
        return switch(path, &["--no-track", "-c", name, start]);
    }
    let label = current_branch(path).unwrap_or_else(|| "HEAD".into());
    with_autostash(path, auto_stash, &label, || switch(path, &["--no-track", "-c", name, start]))
}

pub fn rename_branch(path: &Path, old: &str, new: &str) -> Result<(), String> {
    check_dir(path)?;
    if old.starts_with('-') || !local_exists(path, old) {
        return Err("branch_not_found".into());
    }
    check_branch_name(path, new)?;
    if old == new {
        return Ok(());
    }
    if local_exists(path, new) {
        return Err("branch_exists".into());
    }
    run(Some(path), &["branch", "-m", old, new]).map(|_| ()).map_err(|e| classify(&e))
}

/// Supprime une branche locale ; sans `force`, refusé si elle n'est pas fusionnée.
pub fn delete_branch(path: &Path, name: &str, force: bool) -> Result<(), String> {
    check_dir(path)?;
    if name.starts_with('-') || !local_exists(path, name) {
        return Err("branch_not_found".into());
    }
    if current_branch(path).as_deref() == Some(name) {
        return Err("branch_is_current".into());
    }
    run(Some(path), &["branch", if force { "-D" } else { "-d" }, name]).map(|_| ()).map_err(|e| classify(&e))
}

/// Supprime une branche sur son remote (`origin/feature/x`).
pub fn delete_remote_branch(path: &Path, remote_branch: &str) -> Result<(), String> {
    check_dir(path)?;
    if remote_branch.starts_with('-') || !ref_exists(path, &format!("refs/remotes/{remote_branch}")) {
        return Err("branch_not_found".into());
    }
    let branch = local_name_of(path, remote_branch).ok_or("branch_not_found")?;
    let remote = &remote_branch[..remote_branch.len() - branch.len() - 1];
    run(Some(path), &["push", "-q", remote, "--delete", &format!("refs/heads/{branch}")])
        .map(|_| ())
        .map_err(|e| classify(&e))
}

// ---------------------------------------------------------------------------
// Réseau
// ---------------------------------------------------------------------------

fn remotes(path: &Path) -> Vec<String> {
    run(Some(path), &["remote"]).map(|o| o.lines().map(str::to_string).collect()).unwrap_or_default()
}

/// Récupère toutes les remotes ; les branches distantes supprimées sont retirées.
pub fn fetch(path: &Path) -> Result<(), String> {
    check_dir(path)?;
    if remotes(path).is_empty() {
        return Err("no_remote".into());
    }
    run(Some(path), &["fetch", "-q", "--all", "--prune"]).map(|_| ()).map_err(|e| classify(&e))
}

/// Remote et branche distante suivies par `branch` (`branch.<b>.remote` / `.merge`).
fn upstream_of(path: &Path, branch: &str) -> Option<(String, String)> {
    let remote = run(Some(path), &["config", "--get", &format!("branch.{branch}.remote")]).ok()?;
    let merge = run(Some(path), &["config", "--get", &format!("branch.{branch}.merge")]).ok()?;
    Some((remote, merge))
}

/// Tire la branche courante depuis sa branche distante. `strategy` : "ff-only" (avance
/// rapide uniquement, `not_fast_forward` si les branches ont divergé), "merge" ou "rebase".
pub fn pull(path: &Path, strategy: &str, auto_stash: bool) -> Result<OpResult, String> {
    check_dir(path)?;
    let mode = match strategy {
        "ff-only" => "--ff-only",
        "merge" => "--no-rebase",
        "rebase" => "--rebase",
        _ => return Err("invalid_strategy".into()),
    };
    let branch = current_branch(path).ok_or("detached_head")?;
    if upstream_of(path, &branch).is_none() {
        return Err("no_upstream".into());
    }
    if operation(path).is_some() {
        return Err("operation_in_progress".into());
    }
    with_autostash(path, auto_stash, &branch, || {
        match run_env(Some(path), &["pull", "-q", mode, "--no-edit"], &[("GIT_EDITOR", "true")]) {
            Ok(_) => Ok(OpResult::default()),
            Err(_) if operation(path).is_some() => Ok(OpResult { conflicts: true, ..Default::default() }),
            Err(e) => match classify(&e) {
                // `pull --rebase` refuse une copie sale même sans rien à tirer : déjà à jour
                // (la distante, tout juste récupérée, est contenue dans HEAD), rien à faire.
                code if code == "local_changes_conflict" && contains_upstream(path) => Ok(OpResult::default()),
                code => Err(code),
            },
        }
    })
}

/// HEAD contient déjà la branche distante suivie (rien à tirer).
fn contains_upstream(path: &Path) -> bool {
    run(Some(path), &["merge-base", "--is-ancestor", "@{u}", "HEAD"]).is_ok()
}

/// Pousse la branche courante vers sa branche distante. Sans branche distante, elle est
/// créée sur `origin` (ou l'unique remote) **et suivie** (`-u`). `force` : `--force-with-lease`
/// (refusé si la distante a bougé depuis le dernier fetch).
pub fn push(path: &Path, force: bool) -> Result<(), String> {
    check_dir(path)?;
    let branch = current_branch(path).ok_or("detached_head")?;
    let mut args = vec!["push", "-q"];
    if force {
        args.push("--force-with-lease");
    }
    let local = format!("refs/heads/{branch}");
    let refspec;
    let remote;
    match upstream_of(path, &branch) {
        Some((r, merge)) => {
            remote = r;
            refspec = format!("{local}:{merge}");
        }
        None => {
            let all = remotes(path);
            remote = if all.iter().any(|r| r == "origin") {
                "origin".to_string()
            } else {
                all.first().cloned().ok_or("no_remote")?
            };
            refspec = format!("{local}:{local}");
            args.push("-u");
        }
    }
    args.push(&remote);
    args.push(&refspec);
    run(Some(path), &args).map(|_| ()).map_err(|e| classify(&e))
}

// ---------------------------------------------------------------------------
// Stash
// ---------------------------------------------------------------------------

/// Dernier stash quand il vient de l'auto-stash : des modifications mises de côté par GitGR
/// et pas encore réappliquées (conflits, ou app interrompue entre le stash et la
/// réapplication). L'interface propose alors de le réappliquer.
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AutoStash {
    pub sha: String,
    /// Message du stash (`GitGR-autostash: main`).
    pub message: String,
}

/// Pile de stash : nombre d'entrées, et le dernier stash s'il vient de l'auto-stash. Un
/// seul appel à git (lu à chaque rafraîchissement des refs).
pub fn stash_info(path: &Path) -> (u32, Option<AutoStash>) {
    // `%gs` : « On main: GitGR-autostash: main » (ou « WIP on … » pour un stash sans message).
    let out = run(Some(path), &["stash", "list", "--format=%H%x1f%gs"]).unwrap_or_default();
    let mut lines = out.lines().filter(|l| !l.is_empty());
    let autostash = lines.next().and_then(|top| {
        let (sha, subject) = top.split_once('\x1f')?;
        let start = subject.find(AUTOSTASH_PREFIX)?;
        Some(AutoStash { sha: sha.to_string(), message: subject[start..].to_string() })
    });
    let count = if out.is_empty() { 0 } else { 1 + lines.count() as u32 };
    (count, autostash)
}

/// Nombre d'entrées dans la pile de stash.
pub fn stash_count(path: &Path) -> u32 {
    stash_info(path).0
}

/// Réapplique et retire le dernier stash. En cas de conflit, il est gardé (`stash_kept`).
pub fn stash_pop(path: &Path) -> Result<OpResult, String> {
    check_dir(path)?;
    if stash_count(path) == 0 {
        return Err("no_stash".into());
    }
    if has_conflicts(path) {
        return Err("unresolved_conflicts".into());
    }
    let before = is_dirty(path)?;
    if pop_stash(path) {
        return Ok(OpResult::default());
    }
    // Rien n'a bougé (fichiers locaux qui seraient écrasés) : une vraie erreur.
    if !has_conflicts(path) && is_dirty(path)? == before {
        return Err("stash_would_overwrite".into());
    }
    Ok(OpResult { stash_kept: true, ..Default::default() })
}

// ---------------------------------------------------------------------------
// Erreurs
// ---------------------------------------------------------------------------

/// Codes pour les erreurs connues de checkout, branches et réseau ; sinon le message de git.
pub fn classify(stderr: &str) -> String {
    let s = stderr;
    let has = |p: &str| s.contains(p);
    let code = if has("would be overwritten by checkout")
        || has("would be overwritten by merge")
        || has("cannot pull with rebase")
        || has("cannot rebase: You have unstaged changes")
        || has("Please commit or stash them")
    {
        "local_changes_conflict"
    } else if has("not fully merged") {
        "branch_not_merged"
    } else if has("Not possible to fast-forward") || has("not possible to fast-forward") {
        "not_fast_forward"
    } else if has("stale info") {
        "push_stale"
    } else if has("[rejected]") || has("non-fast-forward") || has("fetch first") {
        "push_rejected"
    } else if has("Host key verification failed") {
        "host_key_unknown"
    } else if has("Authentication failed")
        || has("could not read Username")
        || has("could not read Password")
        || has("terminal prompts disabled")
        || has("Permission denied (publickey")
        || has("Access denied")
        || has("The requested URL returned error: 403")
    {
        "auth_failed"
    } else if has("Could not resolve host")
        || has("Could not resolve hostname")
        || has("Connection timed out")
        || has("Connection refused")
        || has("Failed to connect")
        || has("Network is unreachable")
    {
        "network_unreachable"
    } else if has("Repository not found") || has("does not appear to be a git repository") {
        "remote_not_found"
    } else if let Some(code) = crate::git::classify_error(s) {
        code
    } else {
        return s.to_string();
    };
    code.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::tests::{commit_file, temp_repo};

    fn git(repo: &Path, args: &[&str]) -> String {
        run(Some(repo), args).unwrap()
    }

    fn read(repo: &Path, name: &str) -> String {
        std::fs::read_to_string(repo.join(name)).unwrap()
    }

    /// Un dépôt nu (« distant ») et un clone avec un premier commit poussé sur `main`.
    fn with_remote() -> (tempfile::TempDir, tempfile::TempDir) {
        let remote = tempfile::tempdir().unwrap();
        git(remote.path(), &["init", "-q", "--bare", "-b", "main"]);
        let a = temp_repo();
        git(a.path(), &["remote", "add", "origin", &remote.path().to_string_lossy()]);
        commit_file(a.path(), "f.txt", "1\n");
        git(a.path(), &["push", "-q", "-u", "origin", "main"]);
        (remote, a)
    }

    /// Un second clone du même distant, avec une identité.
    fn clone_of(remote: &Path) -> tempfile::TempDir {
        let b = tempfile::tempdir().unwrap();
        // autocrlf dès le clone : sinon la copie extraite par Git pour Windows paraît modifiée.
        git(b.path(), &["clone", "-q", "-c", "core.autocrlf=false", &remote.to_string_lossy(), "."]);
        for (k, v) in [("user.name", "B"), ("user.email", "b@exemple.fr"), ("commit.gpgsign", "false")] {
            git(b.path(), &["config", k, v]);
        }
        b
    }

    fn stash_list(repo: &Path) -> String {
        git(repo, &["stash", "list"])
    }

    #[test]
    fn classifies_errors() {
        assert_eq!(classify("error: The following untracked working tree files would be overwritten by checkout:"), "local_changes_conflict");
        assert_eq!(classify("error: the branch 'x' is not fully merged."), "branch_not_merged");
        assert_eq!(classify("fatal: Not possible to fast-forward, aborting."), "not_fast_forward");
        assert_eq!(classify(" ! [rejected]        main -> main (fetch first)"), "push_rejected");
        assert_eq!(classify(" ! [rejected]        main -> main (stale info)"), "push_stale");
        assert_eq!(classify("git@github.com: Permission denied (publickey)."), "auth_failed");
        assert_eq!(classify("fatal: could not read Username for 'https://github.com': terminal prompts disabled"), "auth_failed");
        assert_eq!(classify("ssh: Could not resolve hostname gitlab.local: Name or service not known"), "network_unreachable");
        assert_eq!(classify("Host key verification failed."), "host_key_unknown");
        assert_eq!(classify("fatal: autre chose"), "fatal: autre chose");
    }

    #[test]
    fn checkout_without_need_does_not_stash() {
        // Git garde lui-même les modifications qui ne gênent pas : aucun fichier réécrit.
        let repo = temp_repo();
        let p = repo.path();
        commit_file(p, "a.txt", "a\n");
        git(p, &["switch", "-q", "-c", "feature"]);
        commit_file(p, "c.txt", "c\n");
        git(p, &["switch", "-q", "main"]);
        std::fs::write(p.join("a.txt"), "a modifié\n").unwrap();
        let r = checkout(p, "feature", true).unwrap();
        assert_eq!(r, OpResult::default());
        assert_eq!(read(p, "a.txt"), "a modifié\n");
        assert_eq!(stash_list(p), "");
    }

    #[test]
    fn checkout_with_autostash_brings_changes_along() {
        let repo = temp_repo();
        let p = repo.path();
        commit_file(p, "a.txt", "1\n2\n3\n4\n5\n");
        git(p, &["switch", "-q", "-c", "feature"]);
        commit_file(p, "a.txt", "un\n2\n3\n4\n5\n");
        git(p, &["switch", "-q", "main"]);
        // Même fichier que la branche cible (git refuse), autre endroit (réapplication propre).
        std::fs::write(p.join("a.txt"), "1\n2\n3\n4\ncinq\n").unwrap();
        std::fs::write(p.join("b.txt"), "nouveau\n").unwrap();
        git(p, &["add", "b.txt"]);

        let r = checkout(p, "feature", true).unwrap();
        assert_eq!(r, OpResult { stashed: true, stash_kept: false, conflicts: false });
        assert_eq!(current_branch(p).as_deref(), Some("feature"));
        assert_eq!(read(p, "a.txt"), "un\n2\n3\n4\ncinq\n");
        // L'index est restauré lui aussi.
        assert_eq!(git(p, &["diff", "--cached", "--name-only"]), "b.txt");
        assert_eq!(stash_list(p), "");
    }

    #[test]
    fn autostash_conflict_keeps_the_stash() {
        let repo = temp_repo();
        let p = repo.path();
        commit_file(p, "a.txt", "main\n");
        git(p, &["switch", "-q", "-c", "feature"]);
        commit_file(p, "a.txt", "feature\n");
        git(p, &["switch", "-q", "main"]);
        std::fs::write(p.join("a.txt"), "local\n").unwrap();

        // Sans auto-stash, git refuse : les modifications seraient écrasées.
        assert_eq!(checkout(p, "feature", false).unwrap_err(), "local_changes_conflict");
        assert_eq!(current_branch(p).as_deref(), Some("main"));

        let r = checkout(p, "feature", true).unwrap();
        assert_eq!(r, OpResult { stashed: true, stash_kept: true, conflicts: false });
        assert_eq!(current_branch(p).as_deref(), Some("feature"));
        assert!(stash_list(p).contains(&format!("{AUTOSTASH_PREFIX}main")));
        assert_eq!(stash_info(p).1.unwrap().message, format!("{AUTOSTASH_PREFIX}main"));
        assert!(has_conflicts(p), "le conflit est visible dans la copie de travail");
    }

    #[test]
    fn checkout_on_a_clean_tree_does_not_stash() {
        let repo = temp_repo();
        let p = repo.path();
        commit_file(p, "a.txt", "a\n");
        git(p, &["branch", "feature"]);
        assert_eq!(checkout(p, "feature", true).unwrap(), OpResult::default());
        assert_eq!(checkout(p, "absente", true).unwrap_err(), "branch_not_found");
        assert_eq!(checkout(p, "--orphan", true).unwrap_err(), "branch_not_found");
    }

    #[test]
    fn create_rename_and_delete_branches() {
        let repo = temp_repo();
        let p = repo.path();
        commit_file(p, "a.txt", "a\n");
        let first = git(p, &["rev-parse", "HEAD"]);
        commit_file(p, "a.txt", "b\n");

        assert_eq!(create_branch(p, "pas bon", None, false, true).unwrap_err(), "invalid_branch_name");
        assert_eq!(create_branch(p, "-x", None, false, true).unwrap_err(), "invalid_branch_name");
        assert_eq!(create_branch(p, "x", Some("--all"), false, true).unwrap_err(), "invalid_start_point");

        create_branch(p, "old", Some(&first), false, true).unwrap();
        assert_eq!(git(p, &["rev-parse", "old"]), first);
        assert_eq!(current_branch(p).as_deref(), Some("main"));
        assert_eq!(create_branch(p, "old", None, false, true).unwrap_err(), "branch_exists");

        create_branch(p, "feature/new", None, true, true).unwrap();
        assert_eq!(current_branch(p).as_deref(), Some("feature/new"));

        rename_branch(p, "old", "ancienne").unwrap();
        assert!(local_exists(p, "ancienne") && !local_exists(p, "old"));
        assert_eq!(rename_branch(p, "ancienne", "main").unwrap_err(), "branch_exists");

        assert_eq!(delete_branch(p, "feature/new", false).unwrap_err(), "branch_is_current");
        git(p, &["switch", "-q", "main"]);
        delete_branch(p, "feature/new", false).unwrap(); // au même commit que main : fusionnée
        // `ancienne` est un ancêtre de main : fusionnée elle aussi.
        delete_branch(p, "ancienne", false).unwrap();

        git(p, &["switch", "-q", "-c", "wip"]);
        commit_file(p, "c.txt", "c\n");
        git(p, &["switch", "-q", "main"]);
        assert_eq!(delete_branch(p, "wip", false).unwrap_err(), "branch_not_merged");
        delete_branch(p, "wip", true).unwrap();
        assert!(!local_exists(p, "wip"));
    }

    #[test]
    fn checkout_remote_creates_a_tracking_branch() {
        let (remote, a) = with_remote();
        git(a.path(), &["switch", "-q", "-c", "feature/x"]);
        commit_file(a.path(), "x.txt", "x\n");
        git(a.path(), &["push", "-q", "origin", "feature/x"]);

        let b = clone_of(remote.path());
        let (r, local) = checkout_remote(b.path(), "origin/feature/x", true).unwrap();
        assert_eq!((r, local.as_str()), (OpResult::default(), "feature/x"));
        assert_eq!(current_branch(b.path()).as_deref(), Some("feature/x"));
        assert_eq!(git(b.path(), &["rev-parse", "--abbrev-ref", "@{u}"]), "origin/feature/x");

        // La locale existe déjà : on passe simplement dessus.
        git(b.path(), &["switch", "-q", "main"]);
        let (_, again) = checkout_remote(b.path(), "origin/feature/x", true).unwrap();
        assert_eq!(again, "feature/x");
        assert_eq!(current_branch(b.path()).as_deref(), Some("feature/x"));
    }

    #[test]
    fn push_sets_the_upstream_of_a_new_branch() {
        let (remote, a) = with_remote();
        let p = a.path();
        git(p, &["switch", "-q", "-c", "nouvelle"]);
        commit_file(p, "n.txt", "n\n");
        push(p, false).unwrap();
        assert_eq!(git(p, &["rev-parse", "--abbrev-ref", "@{u}"]), "origin/nouvelle");
        assert_eq!(git(remote.path(), &["rev-parse", "nouvelle"]), git(p, &["rev-parse", "HEAD"]));

        git(p, &["switch", "-q", "--detach"]);
        assert_eq!(push(p, false).unwrap_err(), "detached_head");
    }

    #[test]
    fn push_rejected_then_forced_with_lease() {
        let (remote, a) = with_remote();
        let b = clone_of(remote.path());
        commit_file(b.path(), "b.txt", "b\n");
        git(b.path(), &["push", "-q"]);

        commit_file(a.path(), "a.txt", "a\n");
        assert_eq!(push(a.path(), false).unwrap_err(), "push_rejected");
        // Le lease se base sur origin/main connu localement : périmé tant qu'on n'a pas fetch.
        assert_eq!(push(a.path(), true).unwrap_err(), "push_stale");
        fetch(a.path()).unwrap();
        push(a.path(), true).unwrap();
        assert_eq!(git(remote.path(), &["rev-parse", "main"]), git(a.path(), &["rev-parse", "HEAD"]));
    }

    #[test]
    fn pull_strategies() {
        let (remote, a) = with_remote();
        let b = clone_of(remote.path());
        commit_file(b.path(), "b.txt", "b\n");
        git(b.path(), &["push", "-q"]);

        // Avance rapide possible.
        pull(a.path(), "ff-only", true).unwrap();
        assert_eq!(read(a.path(), "b.txt"), "b\n");

        // Branches divergentes : refusé en ff-only, linéaire en rebase.
        commit_file(b.path(), "b2.txt", "b2\n");
        git(b.path(), &["push", "-q"]);
        commit_file(a.path(), "a.txt", "a\n");
        assert_eq!(pull(a.path(), "ff-only", true).unwrap_err(), "not_fast_forward");
        // Modification locale non commitée : auto-stash autour du pull.
        std::fs::write(a.path().join("f.txt"), "local\n").unwrap();
        let r = pull(a.path(), "rebase", true).unwrap();
        assert_eq!(r, OpResult { stashed: true, stash_kept: false, conflicts: false });
        assert_eq!(read(a.path(), "f.txt"), "local\n");
        assert_eq!(git(a.path(), &["rev-list", "--count", "--merges", "HEAD"]), "0");
        assert_eq!(git(a.path(), &["rev-parse", "HEAD~1"]), git(b.path(), &["rev-parse", "HEAD"]));

        assert_eq!(pull(a.path(), "autre", true).unwrap_err(), "invalid_strategy");

        // Déjà à jour avec une copie sale : rien n'est stashé, même en rebase.
        let r = pull(a.path(), "rebase", true).unwrap();
        assert_eq!(r, OpResult::default());
        assert_eq!(stash_list(a.path()), "");
    }

    #[test]
    fn pull_merge_conflict_then_abort() {
        let (remote, a) = with_remote();
        let b = clone_of(remote.path());
        commit_file(b.path(), "f.txt", "b\n");
        git(b.path(), &["push", "-q"]);
        commit_file(a.path(), "f.txt", "a\n");

        let r = pull(a.path(), "merge", true).unwrap();
        assert!(r.conflicts);
        assert_eq!(operation(a.path()), Some("merge"));
        assert!(merge_message(a.path()).unwrap().starts_with("Merge branch 'main'"));
        assert_eq!(continue_operation(a.path()).unwrap_err(), "merge_needs_commit");
        assert_eq!(pull(a.path(), "merge", true).unwrap_err(), "operation_in_progress");

        abort_operation(a.path()).unwrap();
        assert_eq!(operation(a.path()), None);
        assert_eq!(read(a.path(), "f.txt"), "a\n");
        assert_eq!(abort_operation(a.path()).unwrap_err(), "no_operation");
    }

    #[test]
    fn rebase_conflict_then_continue() {
        let (remote, a) = with_remote();
        let b = clone_of(remote.path());
        commit_file(b.path(), "f.txt", "b\n");
        git(b.path(), &["push", "-q"]);
        commit_file(a.path(), "f.txt", "a\n");

        assert!(pull(a.path(), "rebase", true).unwrap().conflicts);
        assert_eq!(operation(a.path()), Some("rebase"));
        assert_eq!(continue_operation(a.path()).unwrap_err(), "unresolved_conflicts");
        std::fs::write(a.path().join("f.txt"), "résolu\n").unwrap();
        git(a.path(), &["add", "f.txt"]);
        continue_operation(a.path()).unwrap();
        assert_eq!(operation(a.path()), None);
        assert_eq!(current_branch(a.path()).as_deref(), Some("main"));
        assert_eq!(git(a.path(), &["log", "-1", "--format=%s"]), "test");
    }

    #[test]
    fn fetch_prunes_and_remote_branch_deletion() {
        let (remote, a) = with_remote();
        git(a.path(), &["push", "-q", "origin", "main:refs/heads/temp"]);
        let b = clone_of(remote.path());
        assert!(ref_exists(b.path(), "refs/remotes/origin/temp"));

        delete_remote_branch(a.path(), "origin/temp").unwrap();
        assert!(run(Some(remote.path()), &["rev-parse", "-q", "--verify", "refs/heads/temp"]).is_err());
        fetch(b.path()).unwrap();
        assert!(!ref_exists(b.path(), "refs/remotes/origin/temp"), "branche distante supprimée retirée");

        let alone = temp_repo();
        assert_eq!(fetch(alone.path()).unwrap_err(), "no_remote");
    }

    #[test]
    fn pull_without_upstream() {
        let repo = temp_repo();
        commit_file(repo.path(), "a.txt", "a\n");
        assert_eq!(pull(repo.path(), "ff-only", true).unwrap_err(), "no_upstream");
        assert_eq!(push(repo.path(), false).unwrap_err(), "no_remote");
    }

    #[test]
    fn stash_pop_and_count() {
        let repo = temp_repo();
        let p = repo.path();
        commit_file(p, "a.txt", "a\n");
        assert_eq!(stash_pop(p).unwrap_err(), "no_stash");
        assert_eq!(stash_info(p).1, None);
        std::fs::write(p.join("a.txt"), "b\n").unwrap();
        git(p, &["stash", "push", "-q"]);
        assert_eq!(stash_count(p), 1);
        assert_eq!(stash_info(p).1, None, "stash fait à la main : pas de bandeau");
        // Un auto-stash au-dessus : compté, et proposé ; l'autre en dessous ne l'est pas.
        std::fs::write(p.join("a.txt"), "x\n").unwrap();
        git(p, &["stash", "push", "-q", "-m", &format!("{AUTOSTASH_PREFIX}main")]);
        let (count, auto) = stash_info(p);
        assert_eq!((count, auto.map(|a| a.message)), (2, Some(format!("{AUTOSTASH_PREFIX}main"))));
        git(p, &["stash", "drop", "-q"]);
        assert_eq!(stash_pop(p).unwrap(), OpResult::default());
        assert_eq!((stash_count(p), read(p, "a.txt").as_str()), (0, "b\n"));

        // Conflit : le stash est gardé.
        git(p, &["stash", "push", "-q"]);
        commit_file(p, "a.txt", "c\n");
        assert_eq!(stash_pop(p).unwrap(), OpResult { stash_kept: true, ..Default::default() });
        assert_eq!(stash_count(p), 1);
    }

    #[test]
    fn detached_checkout() {
        let repo = temp_repo();
        let p = repo.path();
        commit_file(p, "a.txt", "a\n");
        let first = git(p, &["rev-parse", "HEAD"]);
        commit_file(p, "a.txt", "b\n");
        checkout_detached(p, &first, true).unwrap();
        assert_eq!(current_branch(p), None);
        assert_eq!(git(p, &["rev-parse", "HEAD"]), first);
        assert_eq!(checkout_detached(p, "--help", true).unwrap_err(), "invalid_start_point");
    }
}
