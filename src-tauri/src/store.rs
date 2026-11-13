//! État persistant de l'application, stocké en JSON dans le dossier de config.
//!
//! Volontairement simple pour l'étape 1 ; on passera à SQLite quand les
//! profils et les liaisons dépôt ↔ profils arriveront.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RepoEntry {
    /// Chemin racine du dépôt, tel que renvoyé par `git rev-parse --show-toplevel`.
    /// Sert aussi d'identifiant.
    pub path: String,
    pub name: String,
    /// Dernière ouverture, en millisecondes depuis l'epoch Unix.
    pub last_opened: u64,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Session {
    /// Chemins des dépôts ouverts en onglets, dans l'ordre.
    pub open_tabs: Vec<String>,
    /// Onglet actif (`None` = écran d'accueil).
    pub active: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// "system" | "light" | "dark"
    pub theme: String,
    /// "system" | "fr" | "en"
    pub language: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self { theme: "system".into(), language: "system".into() }
    }
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct AppState {
    pub repos: Vec<RepoEntry>,
    pub session: Session,
    pub settings: Settings,
}

pub struct Store {
    file: PathBuf,
    pub state: AppState,
}

impl Store {
    /// Charge l'état depuis `dir/state.json` ; état vide si absent ou illisible.
    pub fn load(dir: PathBuf) -> Self {
        let file = dir.join("state.json");
        let state = fs::read_to_string(&file)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        Self { file, state }
    }

    /// Écrit l'état de façon atomique (fichier temporaire puis renommage).
    pub fn save(&self) -> Result<(), String> {
        if let Some(dir) = self.file.parent() {
            fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_vec_pretty(&self.state).map_err(|e| e.to_string())?;
        let tmp = self.file.with_extension("json.tmp");
        fs::write(&tmp, json).map_err(|e| e.to_string())?;
        fs::rename(&tmp, &self.file).map_err(|e| e.to_string())
    }
}
