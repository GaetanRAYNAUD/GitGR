//! Commandes Tauri appelées par le frontend (`invoke("nom", { ... })`).
//!
//! Les commandes qui lancent git sont `async` : Tauri les exécute hors du
//! thread principal, l'interface ne gèle donc pas pendant l'appel.

use crate::branches::{self, OpResult};
use crate::git::{self, GitInfo, RepoSummary};
use crate::history::{self, Commit, CommitDetails, FileDiff, RefsInfo};
use crate::profiles::{self, SshKeyInfo};
use crate::worktree::{self, LineRef, WorkStatus};
use crate::watch::RepoWatcher;
use crate::store::{AppState, Profile, RepoEntry, RepoProfiles, RepoUi, Session, Settings, Store};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, State};

type StoreState<'a> = State<'a, Mutex<Store>>;

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[tauri::command]
pub async fn git_info() -> Result<GitInfo, String> {
    Ok(git::info())
}

#[tauri::command]
pub fn get_state(store: StoreState<'_>) -> AppState {
    store.lock().unwrap().state.clone()
}

/// Valide `path` comme dépôt Git, l'ajoute (ou le remonte) dans la liste
/// des dépôts récents et renvoie son entrée.
#[tauri::command]
pub async fn open_repo(path: String, store: StoreState<'_>) -> Result<RepoEntry, String> {
    let top = git::toplevel(Path::new(&path))?;
    let top_str = top.to_string_lossy().to_string();
    let name = top
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| top_str.clone());
    let entry = RepoEntry { path: top_str.clone(), name, last_opened: now_ms() };

    let mut s = store.lock().unwrap();
    s.state.repos.retain(|r| r.path != top_str);
    s.state.repos.insert(0, entry.clone());
    s.save()?;
    Ok(entry)
}

/// Retire un dépôt de la liste (ne touche pas aux fichiers sur disque).
#[tauri::command]
pub fn forget_repo(path: String, store: StoreState<'_>) -> Result<(), String> {
    let mut s = store.lock().unwrap();
    s.state.repos.retain(|r| r.path != path);
    s.state.session.open_tabs.retain(|p| *p != path);
    s.state.repo_ui.remove(&path);
    s.state.repo_profiles.remove(&path);
    s.state.written_config.remove(&path);
    if s.state.session.active.as_deref() == Some(path.as_str()) {
        s.state.session.active = None;
    }
    sync_identities(&s.state);
    s.save()
}

#[tauri::command]
pub fn set_session(session: Session, store: StoreState<'_>) -> Result<(), String> {
    let mut s = store.lock().unwrap();
    s.state.session = session;
    s.save()
}

#[tauri::command]
pub fn set_settings(settings: Settings, store: StoreState<'_>) -> Result<(), String> {
    let mut s = store.lock().unwrap();
    s.state.settings = settings;
    s.save()
}

#[tauri::command]
pub fn set_repo_ui(path: String, ui: RepoUi, store: StoreState<'_>) -> Result<(), String> {
    let mut s = store.lock().unwrap();
    s.state.repo_ui.insert(path, ui);
    s.save()
}

#[tauri::command]
pub async fn repo_summary(path: String) -> Result<RepoSummary, String> {
    git::summary(Path::new(&path))
}

/// Erreurs de lecture : codes connus (dépôt déplacé, propriétaire…) ou message brut de git.
fn classify(e: String) -> String {
    git::classify_error(&e).map(str::to_string).unwrap_or(e)
}

#[tauri::command]
pub async fn repo_log(path: String, skip: u32, limit: u32) -> Result<Vec<Commit>, String> {
    history::log(Path::new(&path), skip, limit).map_err(classify)
}

#[tauri::command]
pub async fn repo_refs(path: String) -> Result<RefsInfo, String> {
    history::refs(Path::new(&path)).map_err(classify)
}

#[tauri::command]
pub async fn commit_details(path: String, sha: String) -> Result<CommitDetails, String> {
    history::details(Path::new(&path), &sha).map_err(classify)
}

#[tauri::command]
pub async fn commit_diff(
    path: String,
    sha: String,
    file: String,
    old_file: Option<String>,
) -> Result<FileDiff, String> {
    history::diff(Path::new(&path), &sha, &file, old_file.as_deref()).map_err(classify)
}

// --- Copie de travail ------------------------------------------------------

#[tauri::command]
pub async fn work_status(path: String) -> Result<WorkStatus, String> {
    worktree::status(Path::new(&path)).map_err(classify)
}

/// `area` : "unstaged" | "staged" | "untracked" | "conflicted".
#[tauri::command]
pub async fn work_diff(path: String, file: String, old_file: Option<String>, area: String) -> Result<FileDiff, String> {
    worktree::file_diff(Path::new(&path), &file, old_file.as_deref(), &area).map_err(classify)
}

#[tauri::command]
pub async fn stage_files(path: String, files: Vec<String>) -> Result<(), String> {
    worktree::stage_files(Path::new(&path), &files).map_err(classify)
}

#[tauri::command]
pub async fn unstage_files(path: String, files: Vec<String>) -> Result<(), String> {
    worktree::unstage_files(Path::new(&path), &files).map_err(classify)
}

#[tauri::command]
pub async fn stage_all(path: String) -> Result<(), String> {
    worktree::stage_all(Path::new(&path)).map_err(classify)
}

#[tauri::command]
pub async fn unstage_all(path: String) -> Result<(), String> {
    worktree::unstage_all(Path::new(&path)).map_err(classify)
}

#[tauri::command]
pub async fn discard_files(path: String, tracked: Vec<String>, untracked: Vec<String>) -> Result<(), String> {
    worktree::discard_files(Path::new(&path), &tracked, &untracked).map_err(classify)
}

#[tauri::command]
pub async fn discard_all(path: String) -> Result<(), String> {
    worktree::discard_all(Path::new(&path)).map_err(classify)
}

#[tauri::command]
pub async fn stash_all(path: String, message: String) -> Result<(), String> {
    worktree::stash_all(Path::new(&path), &message).map_err(classify)
}

/// Indexe (`unstage = false`) ou retire de l'index les lignes choisies d'un fichier.
#[tauri::command]
pub async fn stage_lines(
    path: String,
    file: String,
    old_file: Option<String>,
    lines: Vec<LineRef>,
    fingerprint: String,
    unstage: bool,
) -> Result<(), String> {
    worktree::stage_lines(Path::new(&path), &file, old_file.as_deref(), &lines, &fingerprint, unstage)
        .map_err(classify)
}

#[tauri::command]
pub async fn discard_lines(path: String, file: String, lines: Vec<LineRef>, fingerprint: String) -> Result<(), String> {
    worktree::discard_lines(Path::new(&path), &file, &lines, &fingerprint).map_err(classify)
}

#[tauri::command]
pub async fn commit(path: String, message: String, amend: bool) -> Result<String, String> {
    worktree::commit(Path::new(&path), &message, amend).map_err(classify)
}

#[tauri::command]
pub async fn head_message(path: String) -> Result<String, String> {
    worktree::head_message(Path::new(&path)).map_err(classify)
}

// --- Branches et réseau -----------------------------------------------------
// Les erreurs sont déjà classées par `branches::classify`.

#[tauri::command]
pub async fn checkout(path: String, branch: String, auto_stash: bool) -> Result<OpResult, String> {
    branches::checkout(Path::new(&path), &branch, auto_stash)
}

/// Renvoie le résultat et le nom de la branche locale.
#[tauri::command]
pub async fn checkout_remote(path: String, branch: String, auto_stash: bool) -> Result<(OpResult, String), String> {
    branches::checkout_remote(Path::new(&path), &branch, auto_stash)
}

#[tauri::command]
pub async fn checkout_detached(path: String, sha: String, auto_stash: bool) -> Result<OpResult, String> {
    branches::checkout_detached(Path::new(&path), &sha, auto_stash)
}

#[tauri::command]
pub async fn create_branch(
    path: String,
    name: String,
    start: Option<String>,
    checkout: bool,
    auto_stash: bool,
) -> Result<OpResult, String> {
    branches::create_branch(Path::new(&path), &name, start.as_deref(), checkout, auto_stash)
}

#[tauri::command]
pub async fn rename_branch(path: String, old: String, new: String) -> Result<(), String> {
    branches::rename_branch(Path::new(&path), &old, &new)
}

#[tauri::command]
pub async fn delete_branch(path: String, branch: String, force: bool) -> Result<(), String> {
    branches::delete_branch(Path::new(&path), &branch, force)
}

#[tauri::command]
pub async fn delete_remote_branch(path: String, branch: String) -> Result<(), String> {
    branches::delete_remote_branch(Path::new(&path), &branch)
}

#[tauri::command]
pub async fn fetch(path: String) -> Result<(), String> {
    branches::fetch(Path::new(&path))
}

#[tauri::command]
pub async fn pull(path: String, strategy: String, auto_stash: bool) -> Result<OpResult, String> {
    branches::pull(Path::new(&path), &strategy, auto_stash)
}

/// Tire la branche `branch` du remote `remote` dans la branche courante (« Tirer depuis… »).
#[tauri::command]
pub async fn pull_from(path: String, remote: String, branch: String, strategy: String, auto_stash: bool) -> Result<OpResult, String> {
    branches::pull_from(Path::new(&path), &remote, &branch, &strategy, auto_stash)
}

/// `remote` : destination choisie (« Pousser vers… ») ; absent : celle de la branche suivie.
#[tauri::command]
pub async fn push(path: String, force: bool, remote: Option<String>) -> Result<(), String> {
    branches::push(Path::new(&path), force, remote.as_deref())
}

// --- Remotes -------------------------------------------------------------------

#[tauri::command]
pub async fn add_remote(path: String, name: String, url: String) -> Result<(), String> {
    crate::remotes::add(Path::new(&path), &name, &url)
}

#[tauri::command]
pub async fn rename_remote(path: String, old: String, new: String) -> Result<(), String> {
    crate::remotes::rename(Path::new(&path), &old, &new)
}

#[tauri::command]
pub async fn set_remote_url(path: String, name: String, url: String) -> Result<(), String> {
    crate::remotes::set_url(Path::new(&path), &name, &url)
}

#[tauri::command]
pub async fn remove_remote(path: String, name: String) -> Result<(), String> {
    crate::remotes::remove(Path::new(&path), &name)
}

#[tauri::command]
pub async fn stash_pop(path: String) -> Result<OpResult, String> {
    branches::stash_pop(Path::new(&path))
}

#[tauri::command]
pub async fn abort_operation(path: String) -> Result<(), String> {
    branches::abort_operation(Path::new(&path)).map_err(|e| branches::classify(&e))
}

#[tauri::command]
pub async fn continue_operation(path: String) -> Result<OpResult, String> {
    branches::continue_operation(Path::new(&path))
}

/// Surveille le dépôt de l'onglet actif (`None` : aucun) ; l'interface reçoit l'événement
/// `repo-changed` quand il change sur disque.
#[tauri::command]
pub async fn watch_repo(path: Option<String>, app: AppHandle, watcher: State<'_, Mutex<RepoWatcher>>) -> Result<(), String> {
    watcher.lock().unwrap().watch(path, move |repo| {
        let _ = app.emit("repo-changed", repo);
    })
}

// --- Profils ------------------------------------------------------------------

/// Met à jour les identités injectées dans git (après tout changement de profils).
pub fn sync_identities(state: &AppState) {
    git::set_identities(state.identities());
    crate::remotes::set_table(state.remote_table());
}

/// Remplace la liste des profils ; renvoie les profils des dépôts, nettoyés de ceux supprimés.
#[tauri::command]
pub fn set_profiles(profiles: Vec<Profile>, store: StoreState<'_>) -> Result<HashMap<String, RepoProfiles>, String> {
    let mut s = store.lock().unwrap();
    s.state.profiles = profiles;
    s.state.prune_profiles();
    // Avant la sauvegarde : même si elle échoue, git suit l'état en mémoire, celui que
    // l'interface affiche.
    sync_identities(&s.state);
    s.save()?;
    Ok(s.state.repo_profiles.clone())
}

#[tauri::command]
pub fn set_repo_profiles(path: String, profiles: RepoProfiles, store: StoreState<'_>) -> Result<(), String> {
    let mut s = store.lock().unwrap();
    s.state.repo_profiles.insert(path, profiles);
    s.state.prune_profiles();
    sync_identities(&s.state);
    s.save()
}

/// Dossier personnel, avec des `/` (règles `~/…`, chemin proposé pour une nouvelle clé).
#[tauri::command]
pub fn home_dir() -> Option<String> {
    git::home_dir().map(|h| h.to_string_lossy().replace('\\', "/"))
}

#[tauri::command]
pub async fn ssh_key_info(path: String) -> Result<SshKeyInfo, String> {
    profiles::key_info(&path)
}

/// Enregistre (après vérification) ou oublie (`None`) la phrase de passe d'une clé.
#[tauri::command]
pub async fn set_key_passphrase(path: String, passphrase: Option<String>) -> Result<SshKeyInfo, String> {
    profiles::set_passphrase(&path, passphrase.as_deref())
}

#[tauri::command]
pub async fn generate_ssh_key(path: String, comment: String, passphrase: Option<String>) -> Result<SshKeyInfo, String> {
    profiles::generate_key(&path, &comment, passphrase.as_deref())
}

/// « Écrire l'identité dans .git/config » : identité et signature du profil actif, pour
/// qu'elles vaillent aussi en ligne de commande. Ce qu'une écriture précédente avait posé et
/// que ce profil ne définit plus (signature d'un autre profil) est retiré.
#[tauri::command]
pub async fn apply_identity(path: String, store: StoreState<'_>) -> Result<(), String> {
    let p = Path::new(&path);
    let id = git::identity_for(p).ok_or("no_profile")?;
    let previous = store.lock().unwrap().state.written_config.get(&path).cloned().unwrap_or_default();
    let written = git::write_local_config(p, &id.config(), &previous).map_err(classify)?;
    let mut s = store.lock().unwrap();
    s.state.written_config.insert(path, written);
    s.save()
}

/// Clés GPG secrètes, pour choisir celle d'un profil.
#[tauri::command]
pub async fn gpg_keys() -> Result<Vec<crate::signing::GpgKey>, String> {
    crate::signing::gpg_keys()
}
