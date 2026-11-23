//! Point d'entrée de l'application GitGR (côté Rust).
//!
//! - `git`      : appels au binaire `git` et lecture de son résultat.
//! - `history`  : historique (log, refs, détails, diff) pour le graphe.
//! - `worktree` : copie de travail (status, indexation, commit).
//! - `clone`    : cloner un dépôt (URL ou dépôt d'un compte), progression, annulation.
//! - `branches` : checkout (auto-stash), branches, fetch / pull / push, stash pop.
//! - `watch`    : surveillance du dépôt actif (modifications faites ailleurs).
//! - `remotes`  : remotes du dépôt et profil de chacun (clé SSH par hôte, config ssh générée).
//! - `profiles` : clés SSH des profils (lecture, génération) ; l'identité est injectée par `git`.
//! - `providers`: comptes GitHub / GitLab (token personnel vérifié auprès de l'API).
//! - `avatars`  : avatars des propriétaires de dépôts (API du provider, cache sur disque).
//! - `secrets`  : trousseau de l'OS (phrases de passe des clés, tokens des comptes).
//! - `signing`  : clés GPG (signature des commits, injectée par `git`).
//! - `askpass`  : l'exécutable répond à ssh (phrase de passe) quand ssh le lance.
//! - `store`    : état persistant de l'app (dépôts connus, onglets, réglages).
//! - `commands` : fonctions exposées au frontend via `invoke()`.

pub mod askpass;
mod avatars;
mod branches;
mod clone;
mod commands;
mod git;
mod history;
mod profiles;
mod notifications;
mod pull_view;
mod pulls;
mod providers;
mod remotes;
mod secrets;
mod signing;
mod store;
mod watch;
mod worktree;

use std::sync::Mutex;
use tauri::Manager;
use tauri::utils::config::{AppDirectoriesOverride, AppDirectoryOverrides};
use tauri_plugin_window_state::StateFlags;

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
    let mut context = tauri::generate_context!();
    // `GITGR_CONFIG_DIR` (tests sur l'app compilée, cf. e2e-app/) remplace le dossier de
    // configuration, pour GitGR comme pour les plugins (état de la fenêtre).
    if let Some(dir) = std::env::var_os("GITGR_CONFIG_DIR") {
        context.config_mut().app.app_directories_override = Some(AppDirectoriesOverride::Directories(AppDirectoryOverrides {
            config: Some(dir.into()),
            ..Default::default()
        }));
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        // Mises à jour : manifeste `latest.json` de la dernière release GitHub, paquets signés
        // (clé publique dans tauri.conf.json). Vérification et installation lancées par
        // l'interface ; `process` pour redémarrer après l'installation.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // Taille, position et état agrandi (ou plein écran) de la fenêtre, gardés d'une session
        // à l'autre (`.window-state.json` à côté de state.json, sauvé à la fermeture). La
        // visibilité et les décorations restent celles de tauri.conf.json.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED | StateFlags::FULLSCREEN)
                .build(),
        )
        .setup(|app| {
            // Fichier d'état : %APPDATA%\fr.gitgr.app\state.json sous Windows,
            // ~/.config/fr.gitgr.app/state.json sous Linux (ou `GITGR_CONFIG_DIR`, cf. plus haut).
            let dir = app.path().app_config_dir()?;
            remotes::set_config_dir(dir.join("ssh"));
            avatars::set_cache_dir(dir.join("avatars"));
            pulls::set_cache_dir(dir.join("pull-options"));
            notifications::set_seen_file(dir.join("notifications-seen.json"));
            let store = store::Store::load(dir);
            commands::sync_identities(&store.state);
            app.manage(Mutex::new(store));
            app.manage(Mutex::new(watch::RepoWatcher::default()));
            create_main_window(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::git_info,
            commands::install_kind,
            commands::get_state,
            commands::open_repo,
            commands::forget_repo,
            commands::rename_repo,
            commands::set_repo_color,
            commands::set_session,
            commands::set_settings,
            commands::set_repo_ui,
            commands::repo_summary,
            commands::repo_log,
            commands::repo_refs,
            commands::commit_details,
            commands::commit_diff,
            commands::range_changes,
            commands::range_diff,
            commands::work_status,
            commands::work_diff,
            commands::stage_files,
            commands::unstage_files,
            commands::stage_all,
            commands::unstage_all,
            commands::discard_files,
            commands::discard_all,
            commands::open_repo_file,
            commands::add_to_gitignore,
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
            commands::pull_from,
            commands::push,
            commands::add_remote,
            commands::rename_remote,
            commands::set_remote_url,
            commands::remove_remote,
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
            commands::connect_account,
            commands::disconnect_account,
            commands::check_account,
            commands::list_account_repos,
            commands::list_account_namespaces,
            commands::create_account_repo,
            commands::clone_repo,
            commands::cancel_clone,
            commands::account_keys,
            commands::add_account_key,
            commands::owner_avatar,
            commands::author_avatars,
            commands::pull_draft,
            commands::remote_default_branch,
            commands::create_pull,
            commands::cached_pull_options,
            commands::refresh_pull_options,
            commands::list_pulls,
            commands::pull_detail,
            commands::pull_act,
            commands::ensure_pull_head,
            commands::pull_files,
            commands::pull_file_diff,
            commands::checkout_pull,
            commands::person_avatars,
            commands::poll_notifications,
            commands::mark_notification_read,
            commands::notifications_seen,
            commands::add_notifications_seen,
            commands::github_device_start,
            commands::github_device_poll,
            commands::github_device_cancel,
        ])
        .run(context)
        .expect("error while running tauri application");
}
