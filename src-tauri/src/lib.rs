//! Point d'entrée de l'application GitGR (côté Rust).
//!
//! - `git`      : appels au binaire `git` et lecture de son résultat.
//! - `history`  : historique (log, refs, détails, diff) pour le graphe.
//! - `worktree` : copie de travail (status, indexation, commit).
//! - `branches` : checkout (auto-stash), branches, fetch / pull / push, stash pop.
//! - `watch`    : surveillance du dépôt actif (modifications faites ailleurs).
//! - `profiles` : clés SSH des profils (lecture, génération) ; l'identité est injectée par `git`.
//! - `secrets`  : trousseau de l'OS (phrases de passe des clés).
//! - `signing`  : clés GPG (signature des commits, injectée par `git`).
//! - `askpass`  : l'exécutable répond à ssh (phrase de passe) quand ssh le lance.
//! - `store`    : état persistant de l'app (dépôts connus, onglets, réglages).
//! - `commands` : fonctions exposées au frontend via `invoke()`.

pub mod askpass;
mod branches;
mod commands;
mod git;
mod history;
mod profiles;
mod secrets;
mod signing;
mod store;
mod watch;
mod worktree;

use std::sync::Mutex;
use tauri::Manager;

/// Crée la fenêtre principale décrite dans tauri.conf.json (`"create": false` : pas
/// automatiquement, pour pouvoir régler WebView2 ici).
///
/// Build de debug sous Windows avec `GITGR_DEVTOOLS_PORT` : WebView2 ouvre son port de
/// débogage (CDP), pour piloter l'app dans les tests (e2e-app/). La variable
/// `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` n'est pas fiable pour ça (ignorée sur les runners
/// de GitHub). Jamais dans une version release : le port donnerait la main sur l'app.
fn create_main_window(app: &tauri::App) -> tauri::Result<()> {
    let config = app.config().app.windows.iter().find(|w| w.label == "main").cloned().expect("fenêtre « main » dans tauri.conf.json");
    #[allow(unused_mut)]
    let mut builder = tauri::WebviewWindowBuilder::from_config(app.handle(), &config)?;
    #[cfg(all(windows, debug_assertions))]
    if let Some(port) = std::env::var("GITGR_DEVTOOLS_PORT").ok().filter(|p| p.parse::<u16>().is_ok()) {
        // Remplace les arguments par défaut de wry : on les remet.
        builder = builder.additional_browser_args(&format!(
            "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --remote-debugging-port={port}"
        ));
    }
    builder.build()?;
    Ok(())
}

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
            let store = store::Store::load(dir);
            commands::sync_identities(&store.state);
            app.manage(Mutex::new(store));
            app.manage(Mutex::new(watch::RepoWatcher::default()));
            create_main_window(app)?;
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
            commands::set_profiles,
            commands::set_repo_profiles,
            commands::home_dir,
            commands::ssh_key_info,
            commands::generate_ssh_key,
            commands::apply_identity,
            commands::set_key_passphrase,
            commands::gpg_keys,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
