// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Lancé par ssh pour une phrase de passe (cf. askpass.rs) : répond sans ouvrir de fenêtre.
    gitgr_lib::askpass::run_if_requested();
    gitgr_lib::run()
}
