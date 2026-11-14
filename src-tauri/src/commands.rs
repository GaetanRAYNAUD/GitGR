//! Commandes Tauri appelées par le frontend (`invoke("nom", { ... })`).
//!
//! Les commandes qui lancent git sont `async` : Tauri les exécute hors du
//! thread principal, l'interface ne gèle donc pas pendant l'appel.

use crate::git::{self, GitInfo, RepoSummary};
use crate::history::{self, Commit, CommitDetails, FileDiff, RefsInfo};
use crate::store::{AppState, RepoEntry, RepoUi, Session, Settings, Store};
use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

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
