// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Lancé par ssh pour une phrase de passe (cf. askpass.rs) : répond sans ouvrir de fenêtre.
    // Lancé par git pour les identifiants d'un remote HTTPS (cf. credential.rs) : idem. Avant
    // l'askpass : la variable de l'askpass peut aussi être posée pour cette commande git.
    gitgr_lib::credential::run_if_requested();
    gitgr_lib::askpass::run_if_requested();
    gitgr_lib::run()
}
