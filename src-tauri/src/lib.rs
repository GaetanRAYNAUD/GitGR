//! Point d'entrée de l'application GitGR (côté Rust).
//!
//! - `git`      : appels au binaire `git` et lecture de son résultat.
//! - `history`  : historique (log, refs, détails, diff) pour le graphe.
//! - `store`    : état persistant de l'app (dépôts connus, onglets, réglages).
//! - `commands` : fonctions exposées au frontend via `invoke()`.

mod commands;
mod git;
mod history;
mod store;

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
            let dir = app.path().app_config_dir()?;
            app.manage(Mutex::new(store::Store::load(dir)));
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
