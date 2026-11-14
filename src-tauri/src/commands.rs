//! Commandes Tauri appelées par le frontend (`invoke("nom", { ... })`).
//!
//! Les commandes qui lancent git sont `async` : Tauri les exécute hors du
//! thread principal, l'interface ne gèle donc pas pendant l'appel.

use crate::branches::{self, OpResult};
use crate::git::{self, GitInfo, RepoSummary};
use crate::history::{self, Commit, CommitDetails, FileDiff, RefsInfo};
use crate::worktree::{self, LineRef, WorkStatus};
use crate::watch::RepoWatcher;
use crate::store::{AppState, RepoEntry, RepoUi, Session, Settings, Store};
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
    if s.state.session.active.as_deref() == Some(path.as_str()) {
        s.state.session.active = None;
    }
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

#[tauri::command]
pub async fn push(path: String, force: bool) -> Result<(), String> {
    branches::push(Path::new(&path), force)
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
