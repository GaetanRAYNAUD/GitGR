//! Point d'entrée de l'application GitGR (côté Rust).
//!
//! - `git`      : appels au binaire `git` et lecture de son résultat.
//! - `history`  : historique (log, refs, détails, diff) pour le graphe.
//! - `worktree` : copie de travail (status, indexation, commit).
//! - `branches` : checkout (auto-stash), branches, fetch / pull / push, stash pop.
//! - `watch`    : surveillance du dépôt actif (modifications faites ailleurs).
//! - `store`    : état persistant de l'app (dépôts connus, onglets, réglages).
//! - `commands` : fonctions exposées au frontend via `invoke()`.

mod branches;
mod commands;
mod git;
mod history;
mod store;
mod watch;
mod worktree;

use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Fichier d'état : %APPDATA%\fr.gitgr.app\state.json sous Windows,
            // ~/.config/fr.gitgr.app/state.json sous Linux.
            // `GITGR_CONFIG_DIR` le remplace (tests sur l'app compilée, cf. e2e-app/).
            let dir = match std::env::var_os("GITGR_CONFIG_DIR") {
                Some(d) => std::path::PathBuf::from(d),
                None => app.path().app_config_dir()?,
            };
            app.manage(Mutex::new(store::Store::load(dir)));
            app.manage(Mutex::new(watch::RepoWatcher::default()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::git_info,
            commands::get_state,
            commands::open_repo,
            commands::forget_repo,
            commands::set_session,
            commands::set_settings,
            commands::set_repo_ui,
            commands::repo_summary,
            commands::repo_log,
            commands::repo_refs,
            commands::commit_details,
            commands::commit_diff,
            commands::work_status,
            commands::work_diff,
            commands::stage_files,
            commands::unstage_files,
            commands::stage_all,
            commands::unstage_all,
            commands::discard_files,
            commands::discard_all,
            commands::stash_all,
            commands::stage_lines,
            commands::discard_lines,
            commands::commit,
            commands::head_message,
            commands::checkout,
            commands::checkout_remote,
            commands::checkout_detached,
            commands::create_branch,
            commands::rename_branch,
            commands::delete_branch,
            commands::delete_remote_branch,
            commands::fetch,
            commands::pull,
            commands::push,
            commands::stash_pop,
            commands::abort_operation,
            commands::continue_operation,
            commands::watch_repo,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
