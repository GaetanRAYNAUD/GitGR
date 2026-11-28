//! Branches et réseau : checkout (avec auto-stash), création / renommage / suppression de
//! branches, fetch, pull, push, stash pop, et opérations en cours (merge, rebase…).
//!
//! **Auto-stash** (cf. notes §2.2) : si la copie de travail est sale, les modifications sont
//! mises de côté (`stash push -u`), l'opération est faite, puis le stash est réappliqué. Si la
//! réapplication donne des conflits, le stash est **gardé** : rien n'est jamais perdu.
//!
//! Les erreurs connues sont renvoyées sous forme de codes (`branch_not_merged`,
//! `push_rejected`, `auth_failed`…), traduits côté interface.

use crate::git::{run, run_env, run_input, run_raw};
use crate::history::{check_dir, check_sha};
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

pub(crate) fn has_conflicts(path: &Path) -> bool {
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
pub(crate) fn git_dir(path: &Path) -> Result<PathBuf, String> {
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

/// Lance une commande qui peut créer des commits (merge, rebase, cherry-pick, revert,
/// `--continue`). Si git s'arrête parce que gpg-agent n'était pas prêt (cf.
/// `is_transient_gpg_error`), l'opération reste en cours, sans conflit : elle est poursuivie
/// (`--continue`) deux fois au plus, une seconde d'écart, avant de rendre l'erreur.
pub(crate) fn run_signing(path: &Path, args: &[&str], env: &[(&str, &str)]) -> Result<String, String> {
    let mut res = run_env(Some(path), args, env);
    for _ in 0..2 {
        match &res {
            Err(e) if crate::signing::is_transient_gpg_error(e) => {}
            _ => break,
        }
        let Some(op) = operation(path) else { break };
        if has_conflicts(path) {
            break;
        }
        std::thread::sleep(std::time::Duration::from_secs(1));
        res = run_env(Some(path), &[op, "--continue"], &[("GIT_EDITOR", "true")]);
    }
    res
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
    let res = run_signing(path, &[op, "--continue"], &[("GIT_EDITOR", "true")]);
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
    unstash(path, "stash@{0}", true)
}

/// Réapplique un stash (`stash_ref` : `stash@{N}`), retiré de la pile si `drop` et sans
/// conflit. D'abord avec l'index tel qu'il était, sinon sans (cf. `pop_stash`).
fn unstash(path: &Path, stash_ref: &str, drop: bool) -> bool {
    let verb = if drop { "pop" } else { "apply" };
    let state = || run(Some(path), &["status", "--porcelain", "--untracked-files=all"]).ok();
    let before = state();
    if run(Some(path), &["stash", verb, "-q", "--index", stash_ref]).is_ok() {
        return true;
    }
    // `--index` échoue sans rien toucher quand l'index ne peut pas être restauré ; sans
    // lui, les modifications reviennent (non indexées). Si ce premier essai a changé la copie
    // de travail (conflits), on n'essaie pas une seconde fois.
    if before.is_none() || state() != before {
        return false;
    }
    run(Some(path), &["stash", verb, "-q", stash_ref]).is_ok()
}

/// Dernier stash de la pile (son SHA).
fn top_stash(path: &Path) -> Option<String> {
    run(Some(path), &["rev-parse", "-q", "--verify", "refs/stash"]).ok()
}

/// Lance `op` (déjà classée : renvoie des codes d'erreur). Le stash n'est fait **que si git
/// refuse** à cause des modifications locales (`local_changes_conflict`) : sinon git les
/// garde telles quelles, sans réécrire un seul fichier. Les fichiers ne restent ainsi
/// stashés que lorsque c'est indispensable — moins de risque de les « perdre de vue » si
/// l'app est interrompue entre-temps (cf. le bandeau de récupération côté interface).
/// Avec le stash : `op` est relancée, puis les modifications réappliquées ; si `op` échoue
/// encore, elles sont réappliquées tout de suite (HEAD n'a pas bougé).
pub(crate) fn with_autostash(
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
    let before = top_stash(path);
    run(Some(path), &["stash", "push", "-q", "-u", "-m", &message])?;
    // Rien n'a été mis de côté (git n'a rien trouvé à stasher) : réappliquer « le dernier
    // stash » toucherait à un stash de l'utilisateur. Le refus de git est rendu tel quel.
    if top_stash(path) == before {
        return Err("local_changes_conflict".into());
    }
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
    // Dépôt sans commit : aucun point de départ à donner, la branche à naître change de nom.
    if start == "HEAD" && commit("HEAD").is_none() {
        return switch(path, &["--no-track", "-c", name]);
    }
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

/// Déplace une branche locale qui n'est pas la courante sur `sha` (`git branch -f`) ; les
/// commits qu'elle seule contenait restent dans son reflog.
pub fn move_branch(path: &Path, name: &str, sha: &str) -> Result<(), String> {
    check_dir(path)?;
    check_sha(sha)?;
    if name.starts_with('-') || !local_exists(path, name) {
        return Err("branch_not_found".into());
    }
    if current_branch(path).as_deref() == Some(name) {
        return Err("same_branch".into());
    }
    run(Some(path), &["branch", "-f", name, sha]).map(|_| ()).map_err(|e| {
        if e.contains("used by worktree") || e.contains("checked out at") { "branch_checked_out".into() } else { classify(&e) }
    })
}

/// Annuler / rétablir (cf. `store/undo.ts`) : remet la branche `branch` (`None` : HEAD
/// détachée) de `expected` à `target`, seulement si elle est toujours sur `expected`
/// (`undo_stale` sinon : le dépôt a changé depuis). `expected` absent : la branche ne doit pas
/// exister (elle est recréée) ; `target` absent : elle est supprimée. La branche courante (ou
/// HEAD) passe par `reset` : `mode` « soft » (annuler un commit : ses modifications restent
/// indexées) ou « keep » (les modifications en cours sont gardées ; refusé, sans rien toucher,
/// si elles touchent les mêmes fichiers : `undo_local_changes`).
pub fn set_branch_tip(path: &Path, branch: Option<&str>, expected: Option<&str>, target: Option<&str>, mode: &str) -> Result<(), String> {
    check_dir(path)?;
    for sha in expected.iter().chain(target.iter()) {
        check_sha(sha)?;
    }
    let flag = match mode {
        "soft" => "--soft",
        "keep" => "--keep",
        _ => return Err(format!("unknown mode: {mode}")),
    };
    if operation(path).is_some() {
        return Err("operation_in_progress".into());
    }
    let tip = |r: &str| run(Some(path), &["rev-parse", "-q", "--verify", &format!("{r}^{{commit}}")]).ok();
    let current = current_branch(path);
    let reset = |expected: Option<&str>, target: Option<&str>, at: &str| -> Result<(), String> {
        let (Some(expected), Some(target)) = (expected, target) else { return Err("undo_stale".into()) };
        if tip(at).as_deref() != Some(expected) {
            return Err("undo_stale".into());
        }
        run(Some(path), &["reset", "-q", flag, target]).map(|_| ()).map_err(|e| {
            if e.contains("not uptodate") || e.contains("Cannot do a keep reset") { "undo_local_changes".into() } else { classify(&e) }
        })
    };
    let Some(branch) = branch else {
        if current.is_some() {
            return Err("undo_stale".into());
        }
        return reset(expected, target, "HEAD");
    };
    if branch.starts_with('-') {
        return Err("branch_not_found".into());
    }
    if current.as_deref() == Some(branch) {
        return reset(expected, target, "HEAD");
    }
    let full = format!("refs/heads/{branch}");
    if tip(&full).as_deref() != expected {
        return Err("undo_stale".into());
    }
    let msg = "GitGR: annuler / rétablir";
    let res = match (expected, target) {
        (_, Some(t)) => {
            check_branch_name(path, branch)?;
            // Ancienne valeur vide : la branche ne doit pas exister (recréée).
            run(Some(path), &["update-ref", "-m", msg, &full, t, expected.unwrap_or("")])
        }
        (Some(e), None) => run(Some(path), &["update-ref", "-m", msg, "-d", &full, e]),
        (None, None) => return Ok(()),
    };
    res.map(|_| ()).map_err(|e| classify(&e))
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
// Tags
// ---------------------------------------------------------------------------

fn check_tag_name(path: &Path, name: &str) -> Result<(), String> {
    if name.is_empty() || name.starts_with('-') || name.trim() != name {
        return Err("invalid_tag_name".into());
    }
    run(Some(path), &["check-ref-format", &format!("refs/tags/{name}")]).map(|_| ()).map_err(|_| "invalid_tag_name".into())
}

fn tag_exists(path: &Path, name: &str) -> bool {
    ref_exists(path, &format!("refs/tags/{name}"))
}

/// Remote choisi quand on n'en donne pas : `origin` s'il existe, sinon le premier.
fn default_remote(path: &Path, to: Option<&str>) -> Result<String, String> {
    let all = remotes(path);
    match to {
        Some(r) if all.iter().any(|x| x == r) => Ok(r.to_string()),
        Some(_) => Err("remote_not_found".into()),
        None if all.iter().any(|r| r == "origin") => Ok("origin".into()),
        None => all.first().cloned().ok_or_else(|| "no_remote".into()),
    }
}

/// Crée le tag `name` sur `target` (HEAD si absent) : annoté si `message` est donné (auteur :
/// l'identité du dépôt), léger sinon.
pub fn create_tag(path: &Path, name: &str, target: Option<&str>, message: Option<&str>) -> Result<(), String> {
    check_dir(path)?;
    check_tag_name(path, name)?;
    if tag_exists(path, name) {
        return Err("tag_exists".into());
    }
    let target = target.unwrap_or("HEAD");
    check_start(path, target)?;
    match message.map(str::trim).filter(|m| !m.is_empty()) {
        // Message sur l'entrée standard : il peut contenir n'importe quoi, plusieurs lignes comprises.
        Some(m) => run_input(Some(path), &["tag", "-a", "-F", "-", "--", name, target], m),
        // Tag léger : sans objet à signer ; `tag.gpgSign` (signature du profil) en ferait un tag
        // annoté et ouvrirait un éditeur.
        None => run(Some(path), &["-c", "tag.gpgSign=false", "tag", "--", name, target]),
    }
    .map(|_| ())
    .map_err(|e| classify(&e))
}

pub fn delete_tag(path: &Path, name: &str) -> Result<(), String> {
    check_dir(path)?;
    if name.starts_with('-') || !tag_exists(path, name) {
        return Err("tag_not_found".into());
    }
    run(Some(path), &["tag", "-d", "--", name]).map(|_| ()).map_err(|e| classify(&e))
}

/// Pousse le tag `name` vers `to` (`origin` ou le premier remote si absent) ; renvoie le remote.
pub fn push_tag(path: &Path, name: &str, to: Option<&str>) -> Result<String, String> {
    check_dir(path)?;
    if name.starts_with('-') || !tag_exists(path, name) {
        return Err("tag_not_found".into());
    }
    let remote = default_remote(path, to)?;
    let spec = format!("refs/tags/{name}:refs/tags/{name}");
    run(Some(path), &["push", "-q", &remote, &spec]).map_err(|e| classify(&e))?;
    Ok(remote)
}

/// Supprime le tag `name` sur `to` (`origin` ou le premier remote si absent) ; renvoie le remote.
pub fn delete_remote_tag(path: &Path, name: &str, to: Option<&str>) -> Result<String, String> {
    check_dir(path)?;
    check_tag_name(path, name).map_err(|_| "tag_not_found".to_string())?;
    let remote = default_remote(path, to)?;
    // Un tag absent du remote n'est pas une erreur pour git : la suppression est idempotente.
    run(Some(path), &["push", "-q", &remote, "--delete", &format!("refs/tags/{name}")]).map_err(|e| classify(&e))?;
    Ok(remote)
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
    pull_source(path, strategy, auto_stash, None)
}

/// Tire la branche `branch` du remote `remote` dans la branche courante (« Tirer depuis… »),
/// sans toucher à la branche distante suivie.
pub fn pull_from(path: &Path, remote: &str, branch: &str, strategy: &str, auto_stash: bool) -> Result<OpResult, String> {
    check_dir(path)?;
    if !remotes(path).iter().any(|r| r == remote) {
        return Err("remote_not_found".into());
    }
    check_branch_name(path, branch)?;
    pull_source(path, strategy, auto_stash, Some((remote, &format!("refs/heads/{branch}"))))
}

/// `source` : remote et ref à tirer ; absente : la branche distante suivie.
fn pull_source(path: &Path, strategy: &str, auto_stash: bool, source: Option<(&str, &str)>) -> Result<OpResult, String> {
    check_dir(path)?;
    let mode = match strategy {
        "ff-only" => "--ff-only",
        "merge" => "--no-rebase",
        "rebase" => "--rebase",
        _ => return Err("invalid_strategy".into()),
    };
    let branch = current_branch(path).ok_or("detached_head")?;
    let remote = match source {
        Some((remote, _)) => remote.to_string(),
        None => upstream_of(path, &branch).ok_or("no_upstream")?.0,
    };
    if operation(path).is_some() {
        return Err("operation_in_progress".into());
    }
    let mut pull_args = vec!["pull", "-q", mode, "--no-edit"];
    let mut fetch_args = vec!["fetch", "-q", remote.as_str()];
    if let Some((remote, source_ref)) = source {
        pull_args.extend([remote, source_ref]);
        fetch_args.push(source_ref);
    }
    // Ce qui est tiré, une fois récupéré : la branche suivie, ou ce que le fetch vient de lire.
    let pulled = if source.is_some() { "FETCH_HEAD" } else { "@{u}" };
    with_autostash(path, auto_stash, &branch, || {
        match run_env(Some(path), &pull_args, &[("GIT_EDITOR", "true")]) {
            Ok(_) => Ok(OpResult::default()),
            Err(_) if operation(path).is_some() && has_conflicts(path) => Ok(OpResult { conflicts: true, ..Default::default() }),
            // Arrêt sans conflit (signature refusée, hook…) : il n'y a rien à résoudre. On revient
            // à l'état d'avant le pull et l'erreur de git est rendue ; si l'annulation échoue,
            // l'opération reste en cours, à poursuivre ou annuler depuis l'interface.
            Err(e) if operation(path).is_some() => match abort_operation(path) {
                Ok(()) => Err(classify(&e)),
                Err(_) => Ok(OpResult { conflicts: true, ..Default::default() }),
            },
            Err(e) => match classify(&e) {
                // `pull --rebase` refuse une copie sale même sans rien à tirer, et avant d'avoir
                // récupéré la distante : on la récupère, pour ne pas conclure « déjà à jour »
                // sur un état périmé. Contenue dans HEAD : rien à faire.
                code if code == "local_changes_conflict" => {
                    if mode == "--rebase" && remote != "." {
                        run(Some(path), &fetch_args).map_err(|e| classify(&e))?;
                    }
                    if contains(path, pulled) { Ok(OpResult::default()) } else { Err(code) }
                }
                code => Err(code),
            },
        }
    })
}

/// HEAD contient déjà ce commit (rien à tirer).
fn contains(path: &Path, commit: &str) -> bool {
    run(Some(path), &["merge-base", "--is-ancestor", commit, "HEAD"]).is_ok()
}

/// Met à jour une branche locale qui n'est pas la courante depuis sa branche suivie, sans
/// checkout : `git fetch <remote> <merge>:refs/heads/<branch>`, en avance rapide seulement
/// (`not_fast_forward` si elles ont divergé). Remote « . » : la branche locale suivie.
/// Renvoie faux si la branche était déjà à jour (ou en avance : rien à tirer).
pub fn fast_forward_branch(path: &Path, branch: &str) -> Result<bool, String> {
    check_dir(path)?;
    if branch.starts_with('-') || !local_exists(path, branch) {
        return Err("branch_not_found".into());
    }
    if current_branch(path).as_deref() == Some(branch) {
        return Err("same_branch".into());
    }
    let (remote, merge) = upstream_of(path, branch).ok_or("no_upstream")?;
    let local = format!("refs/heads/{branch}");
    let before = run(Some(path), &["rev-parse", &local])?;
    let refspec = format!("{merge}:{local}");
    // Sans `-q` : git ne dirait pas pourquoi il refuse.
    match run(Some(path), &["fetch", &remote, &refspec]) {
        Ok(_) => Ok(run(Some(path), &["rev-parse", &local])? != before),
        Err(e) if e.contains("[rejected]") || e.contains("non-fast-forward") => {
            // Refusé aussi quand la branche est en avance (git la ferait reculer) : rien à tirer.
            run(Some(path), &["fetch", "-q", &remote, &merge]).map_err(|e| classify(&e))?;
            let ahead = run(Some(path), &["merge-base", "--is-ancestor", "FETCH_HEAD", &local]).is_ok();
            if ahead { Ok(false) } else { Err("not_fast_forward".into()) }
        }
        Err(e) if e.contains("checked out") || e.contains("refusing to fetch into") => Err("branch_checked_out".into()),
        Err(e) => Err(classify(&e)),
    }
}

/// Branche suivie par `branch` : `upstream` = branche distante (`origin/x`) ; `None` : ne plus
/// rien suivre.
pub fn set_upstream(path: &Path, branch: &str, upstream: Option<&str>) -> Result<(), String> {
    check_dir(path)?;
    if branch.starts_with('-') || !local_exists(path, branch) {
        return Err("branch_not_found".into());
    }
    match upstream {
        Some(u) => {
            if u.starts_with('-') || !ref_exists(path, &format!("refs/remotes/{u}")) {
                return Err("branch_not_found".into());
            }
            let arg = format!("--set-upstream-to=refs/remotes/{u}");
            run(Some(path), &["branch", "-q", &arg, branch]).map(|_| ()).map_err(|e| classify(&e))
        }
        None if upstream_of(path, branch).is_none() => Ok(()),
        None => run(Some(path), &["branch", "-q", "--unset-upstream", branch]).map(|_| ()).map_err(|e| classify(&e)),
    }
}

/// Branche à fusionner ou sur laquelle rebaser : nom complet d'une branche locale ou distante.
fn check_branch_ref(path: &Path, full: &str) -> Result<(), String> {
    let kind_ok = full.starts_with("refs/heads/") || full.starts_with("refs/remotes/");
    if !kind_ok || !ref_exists(path, full) {
        return Err("branch_not_found".into());
    }
    Ok(())
}

/// Lance une commande qui peut s'arrêter sur des conflits (merge, rebase). Conflits : l'opération
/// reste en cours. Arrêt sans conflit (signature refusée, hook…) : annulée, erreur de git rendue
/// (comme pour le pull).
fn run_stoppable(path: &Path, args: &[&str]) -> Result<OpResult, String> {
    match run_signing(path, args, &[("GIT_EDITOR", "true")]) {
        Ok(_) => Ok(OpResult::default()),
        Err(_) if operation(path).is_some() && has_conflicts(path) => Ok(OpResult { conflicts: true, ..Default::default() }),
        Err(e) if operation(path).is_some() => match abort_operation(path) {
            Ok(()) => Err(classify(&e)),
            Err(_) => Ok(OpResult { conflicts: true, ..Default::default() }),
        },
        Err(e) => Err(classify(&e)),
    }
}

/// Fusionne la branche `full` (`refs/heads/x` ou `refs/remotes/origin/x`) dans la branche
/// courante, avec l'auto-stash ; avance rapide quand c'est possible, sinon commit de merge.
pub fn merge_branch(path: &Path, full: &str, auto_stash: bool) -> Result<OpResult, String> {
    check_dir(path)?;
    check_branch_ref(path, full)?;
    let branch = current_branch(path).ok_or("detached_head")?;
    if full == format!("refs/heads/{branch}") {
        return Err("same_branch".into());
    }
    if operation(path).is_some() {
        return Err("operation_in_progress".into());
    }
    with_autostash(path, auto_stash, &branch, || run_stoppable(path, &["merge", "--no-edit", full]))
}

/// Rejoue les commits de la branche courante sur la branche `full`, avec l'auto-stash.
pub fn rebase_onto(path: &Path, full: &str, auto_stash: bool) -> Result<OpResult, String> {
    check_dir(path)?;
    check_branch_ref(path, full)?;
    let branch = current_branch(path).ok_or("detached_head")?;
    if full == format!("refs/heads/{branch}") {
        return Err("same_branch".into());
    }
    if operation(path).is_some() {
        return Err("operation_in_progress".into());
    }
    // Déjà à jour : rien à rejouer, et git refuserait une copie sale sans raison.
    if contains(path, full) {
        return Ok(OpResult::default());
    }
    with_autostash(path, auto_stash, &branch, || run_stoppable(path, &["rebase", full]))
}

/// Pousse la branche courante. `to` : remote choisi (« Pousser vers… ») ; absent : celui de la
/// branche distante suivie, sinon `origin` (ou le premier remote). Sur le remote de la branche
/// suivie, elle va vers celle-ci ; ailleurs, vers la branche du même nom. Une branche qui n'en
/// suit aucune suit celle qui est créée (`-u`). `force` : `--force-with-lease` (refusé si la
/// distante a bougé depuis le dernier fetch).
pub fn push(path: &Path, force: bool, to: Option<&str>) -> Result<(), String> {
    check_dir(path)?;
    let branch = current_branch(path).ok_or("detached_head")?;
    push_branch(path, &branch, force, to)
}

/// Pousse la branche locale `branch`, courante ou non, avec les mêmes règles que `push`.
pub fn push_branch(path: &Path, branch: &str, force: bool, to: Option<&str>) -> Result<(), String> {
    check_dir(path)?;
    if branch.starts_with('-') || !local_exists(path, branch) {
        return Err("branch_not_found".into());
    }
    let all = remotes(path);
    if to.is_some_and(|r| !all.iter().any(|x| x == r)) {
        return Err("remote_not_found".into());
    }
    let mut args = vec!["push", "-q"];
    if force {
        args.push("--force-with-lease");
    }
    let local = format!("refs/heads/{branch}");
    // Branche qui suit une branche locale (remote « . ») : ce n'est pas une destination de
    // push — on y écraserait l'autre branche. Elle part vers le remote, sans changer ce suivi.
    let upstream = upstream_of(path, branch);
    let tracks_local = upstream.as_ref().is_some_and(|(r, _)| r == ".");
    let upstream = upstream.filter(|_| !tracks_local);
    let remote = match (to, &upstream) {
        (Some(r), _) => r.to_string(),
        (None, Some((r, _))) => r.clone(),
        (None, None) if all.iter().any(|r| r == "origin") => "origin".to_string(),
        (None, None) => all.first().cloned().ok_or("no_remote")?,
    };
    let refspec = match &upstream {
        Some((r, merge)) if *r == remote => format!("{local}:{merge}"),
        _ => format!("{local}:{local}"),
    };
    if upstream.is_none() && !tracks_local {
        args.push("-u");
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

/// Une entrée de la pile de stash, la plus récente d'abord.
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StashEntry {
    pub sha: String,
    /// Commit sur lequel le stash a été fait.
    pub base: String,
    /// `On main: message` ou `WIP on main: abc1234 sujet` (cf. `%gs`).
    pub message: String,
    pub time: i64,
}

pub fn list_stashes(path: &Path) -> Result<Vec<StashEntry>, String> {
    check_dir(path)?;
    let out = run(Some(path), &["stash", "list", "--format=%H%x1f%P%x1f%ct%x1f%gs"])?;
    Ok(out
        .lines()
        .filter_map(|l| {
            let mut it = l.splitn(4, '\x1f');
            let sha = it.next()?.to_string();
            let base = it.next()?.split(' ').next().unwrap_or_default().to_string();
            let time = it.next()?.parse().unwrap_or(0);
            Some(StashEntry { sha, base, message: it.next().unwrap_or_default().to_string(), time })
        })
        .collect())
}

/// `stash@{N}` du stash `sha` dans la pile actuelle (les numéros bougent : on part du SHA).
fn stash_ref(path: &Path, sha: &str) -> Result<String, String> {
    let out = run(Some(path), &["stash", "list", "--format=%H"])?;
    out.lines().position(|l| l == sha).map(|i| format!("stash@{{{i}}}")).ok_or_else(|| "stash_missing".to_string())
}

/// Réapplique un stash de la pile, et le retire (`drop`) s'il n'y a pas de conflit.
pub fn stash_apply(path: &Path, sha: &str, drop: bool) -> Result<OpResult, String> {
    check_dir(path)?;
    let r = stash_ref(path, sha)?;
    if has_conflicts(path) {
        return Err("unresolved_conflicts".into());
    }
    let before = is_dirty(path)?;
    if unstash(path, &r, drop) {
        return Ok(OpResult::default());
    }
    if !has_conflicts(path) && is_dirty(path)? == before {
        return Err("stash_would_overwrite".into());
    }
    // Conflits : le stash reste dans la pile (toujours le cas avec `apply`).
    Ok(OpResult { stash_kept: true, ..Default::default() })
}

/// Nouvelle branche `name` sur le commit d'où part le stash, extraite, avec le stash réappliqué
/// (et retiré de la pile s'il passe sans conflit) : `git stash branch`.
pub fn stash_branch(path: &Path, sha: &str, name: &str) -> Result<(), String> {
    check_dir(path)?;
    if name.is_empty() || name.starts_with('-') {
        return Err("invalid_branch_name".into());
    }
    let r = stash_ref(path, sha)?;
    run(Some(path), &["stash", "branch", name, &r]).map(|_| ())
}

/// Renomme un stash. Git n'a pas de commande pour ça : l'entrée est retirée puis le même
/// commit remis dans la pile avec le nouveau message (`stash store`). Il passe donc en haut
/// de la pile. Garde la branche d'origine dans le sujet (`On main: …`).
pub fn stash_rename(path: &Path, sha: &str, message: &str) -> Result<(), String> {
    check_dir(path)?;
    let message = message.trim();
    if message.is_empty() || message.contains('\n') {
        return Err("stash_message_invalid".into());
    }
    let entry = list_stashes(path)?.into_iter().find(|s| s.sha == sha).ok_or_else(|| "stash_missing".to_string())?;
    let branch = entry
        .message
        .strip_prefix("WIP on ")
        .or_else(|| entry.message.strip_prefix("On "))
        .and_then(|rest| rest.split_once(": "))
        .map(|(b, _)| b.to_string());
    let subject = match branch {
        Some(b) => format!("On {b}: {message}"),
        None => message.to_string(),
    };
    // `stash store` d'un commit déjà en haut de la pile n'ajoute rien au reflog : on retire
    // d'abord l'entrée, puis on la remet (le commit reste, rien n'est perdu entre les deux).
    let old = stash_ref(path, sha)?;
    run(Some(path), &["stash", "drop", "-q", &old])?;
    if let Err(e) = run(Some(path), &["stash", "store", "-q", "-m", &subject, sha]) {
        let _ = run(Some(path), &["stash", "store", "-q", "-m", &entry.message, sha]);
        return Err(e);
    }
    Ok(())
}

/// Supprime un stash de la pile.
pub fn stash_drop(path: &Path, sha: &str) -> Result<(), String> {
    check_dir(path)?;
    let r = stash_ref(path, sha)?;
    run(Some(path), &["stash", "drop", "-q", &r]).map(|_| ())
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
// Reset
// ---------------------------------------------------------------------------

/// Déplace la branche courante (ou HEAD détachée) sur `sha` : `soft` garde l'index et la copie
/// de travail, `mixed` garde la copie de travail, `hard` les remet à l'état du commit.
pub fn reset_to(path: &Path, sha: &str, mode: &str) -> Result<(), String> {
    check_dir(path)?;
    check_sha(sha)?;
    let flag = match mode {
        "soft" => "--soft",
        "mixed" => "--mixed",
        "hard" => "--hard",
        _ => return Err(format!("unknown reset mode: {mode}")),
    };
    if operation(path).is_some() {
        return Err("operation_in_progress".into());
    }
    run(Some(path), &["reset", "-q", flag, sha]).map(|_| ()).map_err(|e| classify(&e))
}

// ---------------------------------------------------------------------------
// Cherry-pick
// ---------------------------------------------------------------------------

/// Applique les commits donnés (du plus ancien au plus récent) sur la branche courante, avec
/// l'auto-stash. Un commit déjà présent sur la branche (vide une fois appliqué) est sauté ;
/// sur un conflit, le cherry-pick reste en cours (Continuer / Annuler). Les merges sont
/// refusés (il faudrait choisir le parent de référence).
pub fn cherry_pick(path: &Path, shas: &[String], auto_stash: bool) -> Result<OpResult, String> {
    apply_commits(path, "cherry-pick", shas, auto_stash)
}

/// Annule les commits donnés (du plus récent au plus ancien) par de nouveaux commits, avec
/// l'auto-stash ; mêmes règles que `cherry_pick` (déjà annulé : sauté ; conflit : en cours ;
/// merges refusés).
pub fn revert(path: &Path, shas: &[String], auto_stash: bool) -> Result<OpResult, String> {
    apply_commits(path, "revert", shas, auto_stash)
}

// ---------------------------------------------------------------------------
// Squash
// ---------------------------------------------------------------------------

/// Réunit en un seul commit une suite contiguë de commits de la branche courante (`shas` :
/// du plus récent au plus ancien, chacun premier parent du précédent, sans merge). Le nouveau
/// commit garde l'auteur et la date du plus ancien, l'arbre du plus récent, et `message` ; les
/// commits qui suivaient sont rejoués dessus (`rebase --onto`, auto-stash). Refusé si un merge
/// suit la plage, et, sans `allow_pushed`, si un de ces commits est déjà sur une branche
/// distante (`squash_pushed` : il faudrait forcer le push).
pub fn squash(path: &Path, shas: &[String], message: &str, allow_pushed: bool, auto_stash: bool) -> Result<OpResult, String> {
    check_dir(path)?;
    if shas.len() < 2 {
        return Err("no_commits".into());
    }
    for s in shas {
        check_sha(s)?;
    }
    let message = message.trim();
    if message.is_empty() {
        return Err("empty_message".into());
    }
    if operation(path).is_some() {
        return Err("operation_in_progress".into());
    }
    let parents = |s: &str| -> Result<Vec<String>, String> {
        let line = run(Some(path), &["rev-list", "--parents", "-n", "1", s])?;
        Ok(line.split_whitespace().skip(1).map(str::to_string).collect())
    };
    for (i, s) in shas.iter().enumerate() {
        let p = parents(s)?;
        if p.len() > 1 {
            return Err("squash_merge".into());
        }
        if let Some(next) = shas.get(i + 1) {
            if p.first() != Some(next) {
                return Err("squash_not_contiguous".into());
            }
        }
    }
    let tip = &shas[0];
    let oldest = &shas[shas.len() - 1];
    let base = parents(oldest)?.into_iter().next().ok_or("squash_root")?;
    let head = run(Some(path), &["rev-parse", "HEAD"])?;
    if run(Some(path), &["merge-base", "--is-ancestor", tip, &head]).is_err() {
        return Err("squash_not_on_branch".into());
    }
    if !run(Some(path), &["rev-list", "--merges", &format!("{tip}..{head}")])?.is_empty() {
        return Err("squash_merges_after".into());
    }
    if !allow_pushed && !run(Some(path), &["branch", "-r", "--contains", oldest])?.is_empty() {
        return Err("squash_pushed".into());
    }
    // Auteur et date du plus ancien, comme `rebase -i` avec `squash`.
    let who = run(Some(path), &["log", "-1", "--format=%an%x1f%ae%x1f%ad", "--date=raw", oldest])?;
    let mut who = who.splitn(3, '\x1f');
    let (name, email, date) = (who.next().unwrap_or(""), who.next().unwrap_or(""), who.next().unwrap_or(""));
    let tree = format!("{tip}^{{tree}}");
    let new = run_env(
        Some(path),
        &["commit-tree", &tree, "-p", &base, "-m", message],
        &[("GIT_AUTHOR_NAME", name), ("GIT_AUTHOR_EMAIL", email), ("GIT_AUTHOR_DATE", date)],
    )
    .map_err(|e| classify(&e))?;
    check_sha(&new)?;
    let label = current_branch(path).unwrap_or_else(|| "HEAD".into());
    if *tip == head {
        // Même arbre : l'index et la copie de travail ne bougent pas.
        let reason = format!("squash: {} commits", shas.len());
        return run_env(Some(path), &["reset", "-q", "--soft", &new], &[("GIT_REFLOG_ACTION", &reason)])
            .map(|_| OpResult::default())
            .map_err(|e| classify(&e));
    }
    with_autostash(path, auto_stash, &label, || match run_signing(path, &["rebase", "-q", "--onto", &new, tip], &[("GIT_EDITOR", "true")]) {
        Ok(_) => Ok(OpResult::default()),
        Err(_) if operation(path) == Some("rebase") && has_conflicts(path) => Ok(OpResult { conflicts: true, ..Default::default() }),
        Err(e) => Err(classify(&e)),
    })
}

/// Cherry-pick de `shas` (du plus ancien au plus récent) sur la branche locale `branch` **sans
/// la checkout** : chaque arbre est calculé par `git merge-tree --write-tree` (git 2.38 et plus),
/// le commit créé par `commit-tree` (auteur et message d'origine), puis la branche avancée d'un
/// coup (`update-ref` avec l'ancienne valeur attendue). La copie de travail n'est pas touchée.
/// `needs_checkout` quand ce n'est pas possible ainsi : conflit, merge, commit racine, branche
/// courante ou extraite ailleurs, git trop ancien — l'interface passe alors par un checkout.
/// Renvoie le nombre de commits ajoutés (ceux déjà présents sont sautés).
pub fn cherry_pick_to_branch(path: &Path, branch: &str, shas: &[String]) -> Result<usize, String> {
    check_dir(path)?;
    if shas.is_empty() {
        return Err("no_commits".into());
    }
    for s in shas {
        check_sha(s)?;
    }
    if branch.starts_with('-') || !local_exists(path, branch) {
        return Err("branch_not_found".into());
    }
    if current_branch(path).as_deref() == Some(branch) {
        return Err("needs_checkout".into());
    }
    // Extraite dans un autre worktree : sa copie de travail ne suivrait pas.
    let full = format!("refs/heads/{branch}");
    let used = run(Some(path), &["worktree", "list", "--porcelain"]).unwrap_or_default();
    if used.lines().any(|l| l == format!("branch {full}")) {
        return Err("needs_checkout".into());
    }
    let old = run(Some(path), &["rev-parse", "--verify", &full])?;
    let mut tip = old.clone();
    let mut added = 0;
    for sha in shas {
        let parents = run(Some(path), &["rev-list", "--parents", "-n", "1", sha])?;
        let parents: Vec<&str> = parents.split_whitespace().skip(1).collect();
        if parents.len() != 1 {
            return Err("needs_checkout".into());
        }
        let base = format!("--merge-base={}", parents[0]);
        // Sortie : l'arbre (code 0), ou l'arbre et les conflits (code 1) ; option inconnue : git ancien.
        let tree = match run(Some(path), &["merge-tree", "--write-tree", "--messages", &base, &tip, sha]) {
            Ok(out) => out.lines().next().unwrap_or("").trim().to_string(),
            Err(_) => return Err("needs_checkout".into()),
        };
        check_sha(&tree).map_err(|_| "needs_checkout".to_string())?;
        // Rien de nouveau (déjà appliqué) : sauté, comme `cherry-pick` avec un commit vide.
        if tree == run(Some(path), &["rev-parse", &format!("{tip}^{{tree}}")])? {
            continue;
        }
        let who = run(Some(path), &["log", "-1", "--format=%an%x1f%ae%x1f%ad", "--date=raw", sha])?;
        let mut who = who.splitn(3, '\x1f');
        let (name, email, date) = (who.next().unwrap_or(""), who.next().unwrap_or(""), who.next().unwrap_or(""));
        let message = run_raw(Some(path), &["log", "-1", "--format=%B", sha])?;
        let new = crate::git::run_input_env(
            Some(path),
            &["commit-tree", &tree, "-p", &tip, "-F", "-"],
            &message,
            &[("GIT_AUTHOR_NAME", name), ("GIT_AUTHOR_EMAIL", email), ("GIT_AUTHOR_DATE", date)],
        )
        .map_err(|e| classify(&e))?;
        check_sha(&new)?;
        tip = new;
        added += 1;
    }
    if added > 0 {
        let reason = format!("cherry-pick: {added} commit(s) sur {branch}");
        run(Some(path), &["update-ref", "-m", &reason, &full, &tip, &old]).map_err(|e| classify(&e))?;
    }
    Ok(added)
}

/// Suite de cherry-pick / revert gardée par git (`.git/sequencer`).
fn sequencer(path: &Path) -> bool {
    git_dir(path).map(|d| d.join("sequencer").is_dir()).unwrap_or(false)
}

/// `verb` : « cherry-pick » ou « revert » (même séquenceur de git, mêmes arrêts).
fn apply_commits(path: &Path, verb: &'static str, shas: &[String], auto_stash: bool) -> Result<OpResult, String> {
    check_dir(path)?;
    if shas.is_empty() {
        return Err("no_commits".into());
    }
    for s in shas {
        check_sha(s)?;
    }
    if operation(path).is_some() {
        return Err("operation_in_progress".into());
    }
    for s in shas {
        let line = run(Some(path), &["rev-list", "--parents", "-n", "1", s.as_str()])?;
        if line.split_whitespace().count() > 2 {
            return Err(if verb == "revert" { "revert_merge" } else { "cherry_pick_merge" }.into());
        }
    }
    let label = current_branch(path).unwrap_or_else(|| "HEAD".into());
    let editor = [("GIT_EDITOR", "true")];
    with_autostash(path, auto_stash, &label, || {
        let mut args = vec![verb, "--no-edit"];
        args.extend(shas.iter().map(String::as_str));
        let mut res = run_signing(path, &args, &editor);
        // Au plus un « skip » par commit : jamais de boucle sans fin.
        for _ in 0..=shas.len() {
            match res {
                Ok(_) => return Ok(OpResult::default()),
                Err(_) if operation(path) == Some(verb) && has_conflicts(path) => {
                    return Ok(OpResult { conflicts: true, ..Default::default() });
                }
                // Le commit est déjà sur la branche (ou déjà annulé) : vide, sauté. Tout autre
                // arrêt (signature, hook…) reste en cours, à finir ou annuler par l'utilisateur.
                Err(e) if operation(path) == Some(verb) && (e.contains("is now empty") || e.contains("nothing to commit")) => {
                    res = run_signing(path, &[verb, "--skip"], &editor)
                }
                // Un seul commit, déjà là : git s'arrête sans rien laisser en cours.
                Err(e) if operation(path).is_none() && !sequencer(path) && (e.contains("is now empty") || e.contains("nothing to commit")) => {
                    return Ok(OpResult::default());
                }
                Err(e) => {
                    // Refusé avant d'avoir commencé un commit (modifications locales) : git garde
                    // la suite dans `.git/sequencer`, qui bloquerait un nouvel essai. Les commits
                    // déjà faits restent ; ils seront sautés (vides) au nouvel essai.
                    if operation(path).is_none() && sequencer(path) {
                        let _ = run(Some(path), &[verb, "--quit"]);
                    }
                    return Err(classify(&e));
                }
            }
        }
        res.map(|_| OpResult::default()).map_err(|e| classify(&e))
    })
}

// ---------------------------------------------------------------------------
// Erreurs
// ---------------------------------------------------------------------------

/// Codes pour les erreurs connues de checkout, branches et réseau ; sinon le message de git.
pub fn classify(stderr: &str) -> String {
    let s = stderr;
    let has = |p: &str| s.contains(p);
    let code = if crate::git::is_sign_error(s) {
        "sign_failed"
    } else if has("would be overwritten by checkout")
        || has("would be overwritten by merge")
        || has("cannot pull with rebase")
        || has("cannot rebase: You have unstaged changes")
        || has("cannot rebase: Your index contains uncommitted changes")
        || has("Please commit or stash them")
    {
        "local_changes_conflict"
    } else if has("is already used by worktree") || has("is already checked out at") {
        "branch_in_worktree"
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
    } else if has("couldn't find remote ref") || has("Couldn't find remote ref") {
        "remote_ref_not_found"
    } else if has("Repository not found")
        || has("does not appear to be a git repository")
        // Chemin local absent (git sous Linux : « fatal: repository 'x' does not exist »).
        || (has("fatal: repository '") && has("' does not exist"))
    {
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

    /// gpg factice qui échoue au premier appel (agent pas prêt), puis signe.
    fn flaky_gpg(dir: &Path) -> PathBuf {
        let script = dir.join("gpg.sh");
        let count = dir.join("count");
        std::fs::write(
            &script,
            format!(
                "#!/bin/sh\nif [ ! -f '{c}' ]; then : > '{c}'; echo 'gpg: signing failed: Inappropriate ioctl for device' >&2; exit 2; fi\ncat > /dev/null\necho '[GNUPG:] SIG_CREATED D 1 8 00 0 X' >&2\necho '-----BEGIN PGP SIGNATURE-----'\necho 'x'\necho '-----END PGP SIGNATURE-----'\n",
                c = count.display()
            ),
        )
        .unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        script
    }

    #[test]
    fn cherry_pick_goes_on_when_gpg_agent_was_not_ready() {
        let repo = temp_repo();
        let p = repo.path();
        commit_file(p, "a.txt", "1\n");
        run(Some(p), &["switch", "-q", "-c", "autre"]).unwrap();
        commit_file(p, "b.txt", "b\n");
        let b = run(Some(p), &["rev-parse", "HEAD"]).unwrap();
        run(Some(p), &["switch", "-q", "main"]).unwrap();
        let tools = tempfile::tempdir().unwrap();
        let gpg = flaky_gpg(tools.path());
        for (k, v) in [("commit.gpgSign", "true"), ("user.signingKey", "X"), ("gpg.program", gpg.to_str().unwrap())] {
            run(Some(p), &["config", k, v]).unwrap();
        }
        assert_eq!(cherry_pick(p, &[b], false).unwrap(), OpResult::default());
        assert_eq!(operation(p), None);
        assert_eq!(run(Some(p), &["show", "HEAD:b.txt"]).unwrap(), "b");
    }

    #[test]
    fn cherry_pick_to_another_branch_without_checkout() {
        let repo = crate::git::tests::temp_repo();
        let p = repo.path();
        crate::git::tests::commit_file(p, "a.txt", "1\n");
        run(Some(p), &["branch", "cible"]).unwrap();
        crate::git::tests::commit_file(p, "b.txt", "b\n");
        let b = run(Some(p), &["rev-parse", "HEAD"]).unwrap();
        crate::git::tests::commit_file(p, "c.txt", "c\n");
        let c = run(Some(p), &["rev-parse", "HEAD"]).unwrap();
        std::fs::write(p.join("local.txt"), "pas touché").unwrap();
        assert_eq!(cherry_pick_to_branch(p, "cible", &[b.clone(), c.clone()]).unwrap(), 2);
        // La branche courante et la copie de travail n'ont pas bougé.
        assert_eq!(current_branch(p).as_deref(), Some("main"));
        assert_eq!(run(Some(p), &["rev-parse", "HEAD"]).unwrap(), c);
        assert!(p.join("local.txt").exists());
        let log = run(Some(p), &["log", "--format=%s", "-n", "3", "cible"]).unwrap();
        assert_eq!(log.lines().count(), 3);
        assert_eq!(run(Some(p), &["show", "cible:c.txt"]).unwrap(), "c");
        // Déjà là : sautés.
        assert_eq!(cherry_pick_to_branch(p, "cible", &[c.clone()]).unwrap(), 0);
        // Branche courante, conflit : par un checkout.
        assert_eq!(cherry_pick_to_branch(p, "main", &[b.clone()]).unwrap_err(), "needs_checkout");
        run(Some(p), &["switch", "-q", "-c", "autre", "cible~2"]).unwrap();
        crate::git::tests::commit_file(p, "c.txt", "autre\n");
        run(Some(p), &["switch", "-q", "main"]).unwrap();
        assert_eq!(cherry_pick_to_branch(p, "autre", &[c]).unwrap_err(), "needs_checkout");
    }

    #[test]
    fn tags_created_pushed_and_deleted() {
        let (remote, a) = with_remote();
        let p = a.path();
        let first = git(p, &["rev-parse", "HEAD"]);
        commit_file(p, "f.txt", "2\n");

        create_tag(p, "v1", Some(&first), None).unwrap();
        assert_eq!(git(p, &["rev-parse", "v1"]), first);
        assert_eq!(git(p, &["cat-file", "-t", "v1"]), "commit");
        create_tag(p, "v2", None, Some("Version 2\n\nDétails")).unwrap();
        assert_eq!(git(p, &["cat-file", "-t", "v2"]), "tag");
        assert_eq!(git(p, &["tag", "-l", "--format=%(contents:subject)", "v2"]), "Version 2");
        assert_eq!(create_tag(p, "v1", None, None).unwrap_err(), "tag_exists");
        assert_eq!(create_tag(p, "a b", None, None).unwrap_err(), "invalid_tag_name");
        assert_eq!(create_tag(p, "-x", None, None).unwrap_err(), "invalid_tag_name");
        assert_eq!(create_tag(p, "v3", Some("-x"), None).unwrap_err(), "invalid_start_point");

        assert_eq!(push_tag(p, "v2", None).unwrap(), "origin");
        let r = remote.path().to_string_lossy().to_string();
        let on_remote = |name: &str| run(None, &["--git-dir", &r, "rev-parse", "-q", "--verify", &format!("refs/tags/{name}")]).is_ok();
        assert!(on_remote("v2"));
        assert!(!on_remote("v1"));
        assert_eq!(push_tag(p, "v2", Some("autre")).unwrap_err(), "remote_not_found");

        assert_eq!(delete_remote_tag(p, "v2", None).unwrap(), "origin");
        assert!(!on_remote("v2"));
        delete_tag(p, "v1").unwrap();
        assert!(!tag_exists(p, "v1"));
        assert_eq!(delete_tag(p, "v1").unwrap_err(), "tag_not_found");
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
        assert_eq!(classify("fatal: couldn't find remote ref refs/heads/x"), "remote_ref_not_found");
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
        push(p, false, None).unwrap();
        assert_eq!(git(p, &["rev-parse", "--abbrev-ref", "@{u}"]), "origin/nouvelle");
        assert_eq!(git(remote.path(), &["--git-dir=.", "rev-parse", "nouvelle"]), git(p, &["rev-parse", "HEAD"]));

        git(p, &["switch", "-q", "--detach"]);
        assert_eq!(push(p, false, None).unwrap_err(), "detached_head");
    }

    #[test]
    fn push_of_a_branch_tracking_a_local_branch_goes_to_the_remote() {
        let (remote, a) = with_remote();
        let p = a.path();
        let main = git(p, &["rev-parse", "main"]);
        git(p, &["switch", "-q", "-c", "suite", "--track", "main"]);
        commit_file(p, "s.txt", "s\n");
        push(p, true, None).unwrap();
        assert_eq!(git(remote.path(), &["--git-dir=.", "rev-parse", "suite"]), git(p, &["rev-parse", "HEAD"]));
        assert_eq!(git(p, &["rev-parse", "main"]), main, "la branche locale suivie n'a pas bougé");
        assert_eq!(git(p, &["rev-parse", "--abbrev-ref", "@{u}"]), "main", "le suivi est inchangé");
    }

    #[test]
    fn branch_created_before_the_first_commit() {
        let repo = temp_repo();
        let p = repo.path();
        assert_eq!(create_branch(p, "dev", None, true, true).unwrap(), OpResult::default());
        assert_eq!(current_branch(p).as_deref(), Some("dev"));
    }

    #[test]
    fn stash_pop_falls_back_without_index_on_a_dirty_tree() {
        let repo = temp_repo();
        let p = repo.path();
        commit_file(p, "a.txt", "1\n2\n3\n4\n5\n");
        // Stash avec un changement indexé…
        std::fs::write(p.join("a.txt"), "un\n2\n3\n4\n5\n").unwrap();
        git(p, &["add", "a.txt"]);
        git(p, &["stash", "push", "-q"]);
        // … dont le contexte change ensuite : l'index ne peut plus être restauré tel quel,
        // mais les modifications se fusionnent sans conflit.
        commit_file(p, "a.txt", "1\n2\n3\nquatre\n5\n");
        // Copie de travail déjà sale, sans rapport avec le stash.
        std::fs::write(p.join("autre.txt"), "x\n").unwrap();
        assert_eq!(stash_pop(p).unwrap(), OpResult::default());
        assert_eq!(read(p, "a.txt"), "un\n2\n3\nquatre\n5\n");
        assert_eq!(stash_count(p), 0);
    }

    #[test]
    fn push_rejected_then_forced_with_lease() {
        let (remote, a) = with_remote();
        let b = clone_of(remote.path());
        commit_file(b.path(), "b.txt", "b\n");
        git(b.path(), &["push", "-q"]);

        commit_file(a.path(), "a.txt", "a\n");
        assert_eq!(push(a.path(), false, None).unwrap_err(), "push_rejected");
        // Le lease se base sur origin/main connu localement : périmé tant qu'on n'a pas fetch.
        assert_eq!(push(a.path(), true, None).unwrap_err(), "push_stale");
        fetch(a.path()).unwrap();
        push(a.path(), true, None).unwrap();
        assert_eq!(git(remote.path(), &["--git-dir=.", "rev-parse", "main"]), git(a.path(), &["rev-parse", "HEAD"]));
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

        // Copie sale et distante pas encore récupérée : le commit est tiré, pas « déjà à jour ».
        commit_file(b.path(), "b3.txt", "b3
");
        git(b.path(), &["push", "-q"]);
        let r = pull(a.path(), "rebase", true).unwrap();
        assert_eq!(r, OpResult { stashed: true, stash_kept: false, conflicts: false });
        assert_eq!(read(a.path(), "b3.txt"), "b3
");
        assert_eq!(read(a.path(), "f.txt"), "local
");

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
    fn pull_stopped_without_conflict_is_undone_and_reports_the_error() {
        let (remote, a) = with_remote();
        let b = clone_of(remote.path());
        commit_file(b.path(), "b.txt", "b
");
        git(b.path(), &["push", "-q"]);
        commit_file(a.path(), "a.txt", "a
");
        let before = git(a.path(), &["rev-parse", "HEAD"]);
        // Modification locale gênante pour le rebase : passe par l'auto-stash.
        std::fs::write(a.path().join("f.txt"), "local
").unwrap();

        // Le rebase doit re-signer le commit local, avec une clé qui n'existe pas.
        let absent = a.path().join("absente").to_string_lossy().to_string();
        let id = crate::git::Identity { name: "A".into(), email: "a@exemple.fr".into(), ssh_key: None, signing: crate::git::Signing::Ssh(absent) };
        crate::git::tests::set_identity(a.path(), Some(id));
        let res = pull(a.path(), "rebase", true);
        crate::git::tests::set_identity(a.path(), None);

        assert_eq!(res.unwrap_err(), "sign_failed");
        assert_eq!(operation(a.path()), None, "pas de rebase laissé en cours");
        assert_eq!(git(a.path(), &["rev-parse", "HEAD"]), before);
        assert_eq!(read(a.path(), "f.txt"), "local
", "modifications locales revenues");
        assert_eq!(stash_list(a.path()), "");
    }

    #[test]
    fn fetch_prunes_and_remote_branch_deletion() {
        let (remote, a) = with_remote();
        git(a.path(), &["push", "-q", "origin", "main:refs/heads/temp"]);
        let b = clone_of(remote.path());
        assert!(ref_exists(b.path(), "refs/remotes/origin/temp"));

        delete_remote_branch(a.path(), "origin/temp").unwrap();
        assert!(run(Some(remote.path()), &["--git-dir=.", "rev-parse", "-q", "--verify", "refs/heads/temp"]).is_err());
        fetch(b.path()).unwrap();
        assert!(!ref_exists(b.path(), "refs/remotes/origin/temp"), "branche distante supprimée retirée");

        let alone = temp_repo();
        assert_eq!(fetch(alone.path()).unwrap_err(), "no_remote");
    }

    /// Un second remote nu (`client`) ajouté au clone, avec `main` poussée dessus.
    fn add_remote(repo: &Path, name: &str) -> tempfile::TempDir {
        let remote = tempfile::tempdir().unwrap();
        git(remote.path(), &["init", "-q", "--bare", "-b", "main"]);
        git(repo, &["remote", "add", name, &remote.path().to_string_lossy()]);
        git(repo, &["push", "-q", name, "main"]);
        remote
    }

    #[test]
    fn push_to_a_chosen_remote() {
        let (origin, a) = with_remote();
        let p = a.path();
        let client = add_remote(p, "client");
        let head = |repo: &Path, branch: &str| git(repo, &["rev-parse", branch]);
        // Remote nu : lu avec `--git-dir` (accepté même avec `safe.bareRepository = explicit`).
        let remote_head = |repo: &Path, branch: &str| git(repo, &["--git-dir=.", "rev-parse", branch]);
        commit_file(p, "a.txt", "a\n");

        // Vers l'autre remote : même nom de branche, le suivi (origin/main) ne change pas.
        push(p, false, Some("client")).unwrap();
        assert_eq!(remote_head(client.path(), "main"), head(p, "HEAD"));
        assert_ne!(remote_head(origin.path(), "main"), head(p, "HEAD"), "origin n'a rien reçu");
        assert_eq!(git(p, &["rev-parse", "--abbrev-ref", "@{u}"]), "origin/main");
        // Vers le remote de la branche suivie : comme un push ordinaire.
        push(p, false, Some("origin")).unwrap();
        assert_eq!(remote_head(origin.path(), "main"), head(p, "HEAD"));
        assert_eq!(push(p, false, Some("absent")).unwrap_err(), "remote_not_found");

        // Branche suivie sous un autre nom : ce nom sur son remote, le sien ailleurs.
        git(p, &["switch", "-q", "-c", "locale", "--track", "origin/main"]);
        commit_file(p, "b.txt", "b\n");
        push(p, false, Some("client")).unwrap();
        assert_eq!(remote_head(client.path(), "locale"), head(p, "HEAD"));
        push(p, false, Some("origin")).unwrap();
        assert_eq!(remote_head(origin.path(), "main"), head(p, "HEAD"));

        // Branche sans suivi poussée vers un remote choisi : elle le suit.
        git(p, &["switch", "-q", "-c", "nouvelle"]);
        push(p, false, Some("client")).unwrap();
        assert_eq!(git(p, &["rev-parse", "--abbrev-ref", "@{u}"]), "client/nouvelle");
    }

    #[test]
    fn pull_from_a_chosen_remote() {
        let (_origin, a) = with_remote();
        let p = a.path();
        let client = add_remote(p, "client");
        let b = clone_of(client.path());
        commit_file(b.path(), "b.txt", "b\n");
        git(b.path(), &["push", "-q"]);

        assert_eq!(pull_from(p, "absent", "main", "ff-only", true).unwrap_err(), "remote_not_found");
        assert_eq!(pull_from(p, "client", "--all", "ff-only", true).unwrap_err(), "invalid_branch_name");
        assert_eq!(pull_from(p, "client", "absente", "ff-only", true).unwrap_err(), "remote_ref_not_found");

        // Avance rapide depuis l'autre remote ; la branche suivie reste origin/main.
        assert_eq!(pull_from(p, "client", "main", "ff-only", true).unwrap(), OpResult::default());
        assert_eq!(read(p, "b.txt"), "b\n");
        assert_eq!(git(p, &["rev-parse", "--abbrev-ref", "@{u}"]), "origin/main");

        // Branches divergentes, copie sale : refusé en ff-only, rebase avec auto-stash.
        commit_file(b.path(), "b2.txt", "b2\n");
        git(b.path(), &["push", "-q"]);
        commit_file(p, "a.txt", "a\n");
        assert_eq!(pull_from(p, "client", "main", "ff-only", true).unwrap_err(), "not_fast_forward");
        std::fs::write(p.join("f.txt"), "local\n").unwrap();
        let r = pull_from(p, "client", "main", "rebase", true).unwrap();
        assert_eq!(r, OpResult { stashed: true, stash_kept: false, conflicts: false });
        assert_eq!(git(p, &["rev-parse", "HEAD~1"]), git(b.path(), &["rev-parse", "HEAD"]));
        assert_eq!(read(p, "f.txt"), "local\n");

        // Déjà à jour avec une copie sale : rien n'est stashé, même en rebase.
        assert_eq!(pull_from(p, "client", "main", "rebase", true).unwrap(), OpResult::default());
        assert_eq!(stash_list(p), "");
    }

    #[test]
    fn fetch_reads_every_remote() {
        let (_origin, a) = with_remote();
        let p = a.path();
        let client = add_remote(p, "client");
        let b = clone_of(client.path());
        commit_file(b.path(), "b.txt", "b\n");
        git(b.path(), &["push", "-q"]);
        fetch(p).unwrap();
        assert_eq!(git(p, &["rev-parse", "client/main"]), git(b.path(), &["rev-parse", "HEAD"]));
    }

    #[test]
    fn pull_without_upstream() {
        let repo = temp_repo();
        commit_file(repo.path(), "a.txt", "a\n");
        assert_eq!(pull(repo.path(), "ff-only", true).unwrap_err(), "no_upstream");
        assert_eq!(push(repo.path(), false, None).unwrap_err(), "no_remote");
    }

    #[test]
    fn reset_and_reflog_find_a_lost_commit() {
        let repo = temp_repo();
        let p = repo.path();
        commit_file(p, "a.txt", "a\n");
        let first = git(p, &["rev-parse", "HEAD"]);
        commit_file(p, "b.txt", "b\n");
        let lost = git(p, &["rev-parse", "HEAD"]);
        std::fs::write(p.join("a.txt"), "local\n").unwrap();
        reset_to(p, &first, "soft").unwrap();
        assert_eq!(git(p, &["diff", "--cached", "--name-only"]).trim(), "b.txt");
        assert_eq!(read(p, "a.txt"), "local\n");
        reset_to(p, &lost, "hard").unwrap();
        reset_to(p, &first, "hard").unwrap();
        assert!(!p.join("b.txt").exists());
        assert_eq!(reset_to(p, &first, "dur").unwrap_err(), "unknown reset mode: dur");
        // Le commit perdu est dans le reflog de HEAD et de main.
        let head = crate::history::reflog(p, "HEAD").unwrap();
        assert_eq!(head[0].action, "reset");
        assert_eq!(head[0].sha, first);
        assert!(head.iter().any(|e| e.sha == lost && e.action == "reset"));
        assert!(head[0].time > 1_000_000_000);
        let main = crate::history::reflog(p, "main").unwrap();
        assert!(main.iter().any(|e| e.sha == lost));
        assert_eq!(crate::history::reflog(p, "absente").unwrap_err(), "branch_not_found");
        assert_eq!(crate::history::reflog(p, "--all").unwrap_err(), "invalid_branch_name");
    }

    #[test]
    fn squash_contiguous_commits() {
        let repo = temp_repo();
        let p = repo.path();
        commit_file(p, "a.txt", "a\n");
        commit_file(p, "b.txt", "b\n");
        let b = git(p, &["rev-parse", "HEAD"]);
        commit_file(p, "c.txt", "c\n");
        let c = git(p, &["rev-parse", "HEAD"]);
        commit_file(p, "d.txt", "d\n");
        let d = git(p, &["rev-parse", "HEAD"]);
        let count = |p: &Path| git(p, &["rev-list", "--count", "HEAD"]).trim().parse::<u32>().unwrap();
        // Pas contigus, ou dans le mauvais ordre : refusé.
        assert_eq!(squash(p, &[d.clone(), b.clone()], "x", false, true).unwrap_err(), "squash_not_contiguous");
        assert_eq!(squash(p, &[c.clone(), b.clone()], " ", false, true).unwrap_err(), "empty_message");
        // Au milieu de la branche : d rejoué sur le commit réuni, avec une modification locale.
        std::fs::write(p.join("a.txt"), "local\n").unwrap();
        let r = squash(p, &[c.clone(), b.clone()], "b et c", false, true).unwrap();
        assert!(!r.conflicts);
        assert_eq!(count(p), 3);
        assert_eq!(git(p, &["log", "--format=%s", "-n", "2"]).lines().collect::<Vec<_>>(), [git(p, &["log", "-1", "--format=%s", &d]).trim(), "b et c"]);
        assert!(p.join("b.txt").exists() && p.join("c.txt").exists() && p.join("d.txt").exists());
        assert_eq!(read(p, "a.txt"), "local\n");
        // En haut de la branche : HEAD et le commit d'avant.
        git(p, &["checkout", "-q", "--", "a.txt"]);
        let top: Vec<String> = git(p, &["rev-list", "-n", "2", "HEAD"]).lines().map(str::to_string).collect();
        squash(p, &top, "tout", false, true).unwrap();
        assert_eq!(count(p), 2);
        assert_eq!(git(p, &["log", "-1", "--format=%s"]).trim(), "tout");
        assert!(git(p, &["status", "--porcelain"]).trim().is_empty());
    }

    #[test]
    fn revert_several_commits() {
        let repo = temp_repo();
        let p = repo.path();
        commit_file(p, "a.txt", "a
");
        commit_file(p, "b.txt", "b
");
        let b = git(p, &["rev-parse", "HEAD"]);
        commit_file(p, "c.txt", "c
");
        let c = git(p, &["rev-parse", "HEAD"]);
        // Du plus récent au plus ancien : deux commits d'annulation.
        assert_eq!(revert(p, &[c.clone(), b.clone()], true).unwrap(), OpResult::default());
        assert!(!p.join("b.txt").exists() && !p.join("c.txt").exists());
        assert!(git(p, &["log", "--format=%s", "-n", "1"]).starts_with("Revert"));
        // Déjà annulé : sauté sans erreur ni commit vide.
        let before = git(p, &["rev-parse", "HEAD"]);
        assert_eq!(revert(p, &[c], true).unwrap(), OpResult::default());
        assert_eq!(git(p, &["rev-parse", "HEAD"]), before);
        assert_eq!(operation(p), None);
    }

    #[test]
    fn cherry_pick_several_commits() {
        let repo = temp_repo();
        let p = repo.path();
        commit_file(p, "a.txt", "a\n");
        git(p, &["checkout", "-q", "-b", "autre"]);
        commit_file(p, "b.txt", "b\n");
        let b = git(p, &["rev-parse", "HEAD"]);
        commit_file(p, "c.txt", "c\n");
        let c = git(p, &["rev-parse", "HEAD"]);
        commit_file(p, "a.txt", "a modifié\n");
        let conflict = git(p, &["rev-parse", "HEAD"]);
        git(p, &["checkout", "-q", "main"]);
        // Déjà appliqué sur main : sauté sans erreur.
        git(p, &["cherry-pick", &b]);
        std::fs::write(p.join("local.txt"), "garde\n").unwrap();
        let r = cherry_pick(p, &[b.clone(), c.clone()], true).unwrap();
        assert_eq!(r, OpResult::default());
        assert!(p.join("c.txt").exists());
        assert_eq!(read(p, "local.txt"), "garde\n");
        assert_eq!(git(p, &["log", "--format=%s", "-n", "3"]).lines().count(), 3);
        // Modifications locales sur un fichier touché par le second commit : refusé, puis
        // refait avec l'auto-stash (le premier, déjà appliqué, est sauté au nouvel essai).
        commit_file(p, "d.txt", "d
");
        git(p, &["checkout", "-q", "autre"]);
        commit_file(p, "e.txt", "e
");
        let e = git(p, &["rev-parse", "HEAD"]);
        commit_file(p, "d.txt", "d autre
");
        let d = git(p, &["rev-parse", "HEAD"]);
        git(p, &["checkout", "-q", "main"]);
        std::fs::write(p.join("d.txt"), "d local
").unwrap();
        assert_eq!(cherry_pick(p, &[e.clone(), d.clone()], false).unwrap_err(), "local_changes_conflict");
        assert!(!git_dir(p).unwrap().join("sequencer").exists());
        let r = cherry_pick(p, &[e, d], true).unwrap();
        assert!(r.stashed);
        assert_eq!(git(p, &["log", "--format=%s", "-n", "1"]).trim(), git(p, &["log", "--format=%s", "-n", "1", "autre"]).trim());
        git(p, &["reset", "-q", "--hard"]);
        git(p, &["stash", "clear"]);
        // Conflit : le cherry-pick reste en cours.
        let _ = std::fs::remove_file(p.join("local.txt"));
        commit_file(p, "a.txt", "a sur main\n");
        let r = cherry_pick(p, &[conflict], true).unwrap();
        assert!(r.conflicts);
        assert_eq!(operation(p), Some("cherry-pick"));
        assert_eq!(cherry_pick(p, &[c.clone()], true).unwrap_err(), "operation_in_progress");
        abort_operation(p).unwrap();
        assert_eq!(cherry_pick(p, &[], true).unwrap_err(), "no_commits");
    }

    #[test]
    fn stash_list_apply_and_drop() {
        let repo = temp_repo();
        let p = repo.path();
        commit_file(p, "a.txt", "a
");
        std::fs::write(p.join("a.txt"), "un
").unwrap();
        git(p, &["stash", "push", "-q", "-m", "premier"]);
        std::fs::write(p.join("b.txt"), "b
").unwrap();
        git(p, &["stash", "push", "-q", "-u", "-m", "second"]);
        let list = list_stashes(p).unwrap();
        assert_eq!(list.iter().map(|s| s.message.as_str()).collect::<Vec<_>>(), ["On main: second", "On main: premier"]);
        assert_eq!(list[0].base.len(), 40);
        // Le plus ancien, gardé dans la pile.
        stash_apply(p, &list[1].sha, false).unwrap();
        assert_eq!(std::fs::read_to_string(p.join("a.txt")).unwrap(), "un
");
        assert_eq!(stash_count(p), 2);
        git(p, &["checkout", "-q", "--", "a.txt"]);
        // Le second, retiré : il était au-dessus, le premier devient stash@{0}.
        stash_apply(p, &list[0].sha, true).unwrap();
        assert!(p.join("b.txt").exists());
        assert_eq!(list_stashes(p).unwrap().len(), 1);
        // Renommé : même commit, nouveau message, branche gardée ; un seul exemplaire.
        stash_rename(p, &list[1].sha, "renommé").unwrap();
        assert_eq!(list_stashes(p).unwrap().iter().map(|s| (s.sha.as_str(), s.message.as_str())).collect::<Vec<_>>(), [(list[1].sha.as_str(), "On main: renommé")]);
        assert_eq!(stash_rename(p, &list[1].sha, " ").unwrap_err(), "stash_message_invalid");
        // Le premier, sur une branche à lui : extraite, le stash appliqué puis retiré.
        git(p, &["checkout", "-q", "--", "."]);
        std::fs::remove_file(p.join("b.txt")).unwrap();
        stash_branch(p, &list[1].sha, "reprise").unwrap();
        assert_eq!(run(Some(p), &["branch", "--show-current"]).unwrap().trim(), "reprise");
        assert_eq!(std::fs::read_to_string(p.join("a.txt")).unwrap(), "un
");
        assert_eq!(stash_count(p), 0);
        assert_eq!(stash_drop(p, &list[1].sha).unwrap_err(), "stash_missing");
        assert_eq!(stash_branch(p, &list[1].sha, "x").unwrap_err(), "stash_missing");
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

    #[test]
    fn fast_forward_of_another_branch_without_checkout() {
        let (remote, a) = with_remote();
        let p = a.path();
        git(p, &["switch", "-q", "-c", "travail"]);
        // Le distant avance sur `main` (second clone).
        let b = clone_of(remote.path());
        commit_file(b.path(), "g.txt", "g\n");
        git(b.path(), &["push", "-q"]);
        git(p, &["fetch", "-q"]);
        assert!(fast_forward_branch(p, "main").unwrap());
        assert_eq!(git(p, &["rev-parse", "main"]), git(p, &["rev-parse", "origin/main"]));
        assert_eq!(current_branch(p).as_deref(), Some("travail"));
        assert_eq!(fast_forward_branch(p, "travail").unwrap_err(), "same_branch");
        assert!(!fast_forward_branch(p, "main").unwrap(), "déjà à jour");

        // Divergé : refusé, rien ne bouge.
        git(p, &["switch", "-q", "main"]);
        commit_file(p, "local.txt", "l\n");
        let local = git(p, &["rev-parse", "main"]);
        // En avance seulement : rien à tirer, pas une divergence.
        git(p, &["switch", "-q", "travail"]);
        assert!(!fast_forward_branch(p, "main").unwrap());
        assert_eq!(git(p, &["rev-parse", "main"]), local);
        commit_file(b.path(), "h.txt", "h\n");
        git(b.path(), &["push", "-q"]);
        git(p, &["fetch", "-q"]);
        git(p, &["switch", "-q", "travail"]);
        assert_eq!(fast_forward_branch(p, "main").unwrap_err(), "not_fast_forward");
        assert_eq!(git(p, &["rev-parse", "main"]), local);
    }

    #[test]
    fn push_and_upstream_of_another_branch() {
        let (remote, a) = with_remote();
        let p = a.path();
        git(p, &["switch", "-q", "-c", "autre"]);
        commit_file(p, "x.txt", "x\n");
        git(p, &["switch", "-q", "main"]);
        push_branch(p, "autre", false, None).unwrap();
        assert_eq!(git(remote.path(), &["--git-dir=.", "rev-parse", "autre"]), git(p, &["rev-parse", "autre"]));
        assert_eq!(git(p, &["rev-parse", "--abbrev-ref", "autre@{u}"]), "origin/autre");
        assert_eq!(current_branch(p).as_deref(), Some("main"));

        set_upstream(p, "autre", None).unwrap();
        assert!(run(Some(p), &["rev-parse", "--abbrev-ref", "autre@{u}"]).is_err());
        set_upstream(p, "autre", None).unwrap();
        set_upstream(p, "autre", Some("origin/main")).unwrap();
        assert_eq!(git(p, &["rev-parse", "--abbrev-ref", "autre@{u}"]), "origin/main");
        assert_eq!(set_upstream(p, "autre", Some("origin/nulle-part")).unwrap_err(), "branch_not_found");
    }

    #[test]
    fn summary_gives_the_last_fetch() {
        let (_remote, a) = with_remote();
        let p = a.path();
        assert_eq!(crate::git::summary(p).unwrap().last_fetch, None);
        fetch(p).unwrap();
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs();
        let at = crate::git::summary(p).unwrap().last_fetch.unwrap();
        assert!(at + 60 > now && at <= now + 1);
    }

    #[test]
    fn set_branch_tip_for_undo() {
        let repo = temp_repo();
        let p = repo.path();
        commit_file(p, "a.txt", "a
");
        let first = git(p, &["rev-parse", "HEAD"]);
        commit_file(p, "b.txt", "b
");
        let second = git(p, &["rev-parse", "HEAD"]);

        // Courante, soft : le commit annulé, ses modifications indexées.
        set_branch_tip(p, Some("main"), Some(&second), Some(&first), "soft").unwrap();
        assert_eq!(git(p, &["rev-parse", "HEAD"]), first);
        assert_eq!(git(p, &["diff", "--cached", "--name-only"]), "b.txt");
        // Plus sur `second` : refusé.
        assert_eq!(set_branch_tip(p, Some("main"), Some(&second), Some(&first), "soft").unwrap_err(), "undo_stale");
        set_branch_tip(p, Some("main"), Some(&first), Some(&second), "soft").unwrap();
        assert_eq!(git(p, &["status", "--porcelain"]), "");

        // Courante, keep : modification sans rapport gardée ; en conflit, refusé sans rien toucher.
        std::fs::write(p.join("a.txt"), "local
").unwrap();
        set_branch_tip(p, Some("main"), Some(&second), Some(&first), "keep").unwrap();
        assert_eq!(read(p, "a.txt"), "local
");
        assert!(!p.join("b.txt").exists());
        set_branch_tip(p, Some("main"), Some(&first), Some(&second), "keep").unwrap();
        std::fs::write(p.join("b.txt"), "local
").unwrap();
        assert_eq!(set_branch_tip(p, Some("main"), Some(&second), Some(&first), "keep").unwrap_err(), "undo_local_changes");
        assert_eq!(git(p, &["rev-parse", "HEAD"]), second);
        git(p, &["checkout", "--", "."]);

        // Autre branche : recréée, déplacée, supprimée ; jamais si elle a bougé.
        set_branch_tip(p, Some("autre"), None, Some(&first), "keep").unwrap();
        assert_eq!(git(p, &["rev-parse", "autre"]), first);
        assert_eq!(set_branch_tip(p, Some("autre"), None, Some(&first), "keep").unwrap_err(), "undo_stale");
        set_branch_tip(p, Some("autre"), Some(&first), Some(&second), "keep").unwrap();
        assert_eq!(git(p, &["rev-parse", "autre"]), second);
        set_branch_tip(p, Some("autre"), Some(&second), None, "keep").unwrap();
        assert!(!local_exists(p, "autre"));

        // HEAD détachée.
        git(p, &["switch", "-q", "--detach", &second]);
        set_branch_tip(p, None, Some(&second), Some(&first), "keep").unwrap();
        assert_eq!(git(p, &["rev-parse", "HEAD"]), first);
        assert_eq!(current_branch(p), None);
    }

    #[test]
    fn move_another_branch_to_a_commit() {
        let repo = temp_repo();
        let p = repo.path();
        commit_file(p, "a.txt", "a
");
        let first = git(p, &["rev-parse", "HEAD"]);
        git(p, &["branch", "autre"]);
        commit_file(p, "b.txt", "b
");
        let second = git(p, &["rev-parse", "HEAD"]);
        move_branch(p, "autre", &second).unwrap();
        assert_eq!(git(p, &["rev-parse", "autre"]), second);
        move_branch(p, "autre", &first).unwrap();
        assert_eq!(git(p, &["rev-parse", "autre"]), first);
        assert_eq!(move_branch(p, "main", &first).unwrap_err(), "same_branch");
        assert_eq!(move_branch(p, "nulle-part", &first).unwrap_err(), "branch_not_found");
    }

    #[test]
    fn merge_a_branch_into_the_current_one() {
        let repo = temp_repo();
        let p = repo.path();
        commit_file(p, "a.txt", "a\n");
        git(p, &["switch", "-q", "-c", "feature"]);
        commit_file(p, "b.txt", "b\n");
        git(p, &["switch", "-q", "main"]);
        commit_file(p, "c.txt", "c\n");
        // Modification locale sans rapport : gardée telle quelle.
        std::fs::write(p.join("a.txt"), "local\n").unwrap();
        assert_eq!(merge_branch(p, "refs/heads/feature", true).unwrap(), OpResult::default());
        assert_eq!(git(p, &["rev-list", "--parents", "-n", "1", "HEAD"]).split_whitespace().count(), 3);
        assert_eq!(read(p, "b.txt"), "b\n");
        assert_eq!(read(p, "a.txt"), "local\n");
        assert_eq!(merge_branch(p, "refs/heads/main", true).unwrap_err(), "same_branch");
        assert_eq!(merge_branch(p, "refs/tags/x", true).unwrap_err(), "branch_not_found");
    }

    #[test]
    fn merge_conflict_stays_in_progress() {
        let repo = temp_repo();
        let p = repo.path();
        commit_file(p, "a.txt", "a\n");
        git(p, &["switch", "-q", "-c", "feature"]);
        commit_file(p, "a.txt", "feature\n");
        git(p, &["switch", "-q", "main"]);
        commit_file(p, "a.txt", "main\n");
        let r = merge_branch(p, "refs/heads/feature", true).unwrap();
        assert!(r.conflicts);
        assert_eq!(operation(p), Some("merge"));
        assert_eq!(merge_branch(p, "refs/heads/feature", true).unwrap_err(), "operation_in_progress");
    }

    #[test]
    fn rebase_the_current_branch_onto_another() {
        let repo = temp_repo();
        let p = repo.path();
        commit_file(p, "a.txt", "a\n");
        git(p, &["switch", "-q", "-c", "feature"]);
        commit_file(p, "b.txt", "b\n");
        git(p, &["switch", "-q", "main"]);
        commit_file(p, "c.txt", "c\n");
        git(p, &["switch", "-q", "feature"]);
        // Copie sale : git refuse le rebase, l'auto-stash la met de côté puis la réapplique.
        std::fs::write(p.join("a.txt"), "local\n").unwrap();
        let r = rebase_onto(p, "refs/heads/main", true).unwrap();
        assert_eq!(r, OpResult { stashed: true, stash_kept: false, conflicts: false });
        assert_eq!(git(p, &["rev-parse", "HEAD~1"]), git(p, &["rev-parse", "main"]));
        assert_eq!(read(p, "a.txt"), "local\n");
        // Déjà à jour : rien à faire, même avec la copie sale.
        assert_eq!(rebase_onto(p, "refs/heads/main", false).unwrap(), OpResult::default());
    }
}
