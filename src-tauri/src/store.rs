//! État persistant de l'application, stocké en JSON dans le dossier de config.
//!
//! Volontairement simple : quelques dizaines de dépôts et de profils tiennent sans peine
//! dans un JSON écrit d'un bloc. SQLite ne vaudra le coup qu'avec un vrai cache (avatars,
//! PR / MR des providers). Les secrets n'y sont jamais écrits.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
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
    /// Nom affiché choisi dans l'app (onglet, récents) ; `None` = nom du dossier.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alias: Option<String>,
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
    /// Fichiers d'un commit : "list" | "tree"
    pub file_view: String,
    /// Diffs : "inline" | "split" (côte à côte)
    pub diff_view: String,
    /// Tailles choisies à la souris (largeurs de panneaux et de colonnes, hauteurs de
    /// sections, partage du diff côte à côte), par clé ; absente = taille par défaut.
    pub layout: HashMap<String, f64>,
    /// Colonnes masquées dans le graphe (`refs`, `graph`, `author`, `date`, `sha`).
    pub hidden_columns: Vec<String>,
    /// Met les modifications de côté pendant un changement de branche ou un pull.
    pub auto_stash: bool,
    /// Pull : "ff-only" | "merge" | "rebase"
    pub pull_strategy: String,
    /// Fetch automatique du dépôt actif, en minutes (0 : désactivé).
    pub auto_fetch_minutes: u32,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: "system".into(),
            language: "system".into(),
            file_view: "list".into(),
            diff_view: "inline".into(),
            layout: HashMap::new(),
            hidden_columns: Vec::new(),
            auto_stash: true,
            pull_strategy: "ff-only".into(),
            auto_fetch_minutes: 10,
        }
    }
}

/// Préférences d'affichage propres à un dépôt (barre latérale).
#[derive(Serialize, Deserialize, Clone, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct RepoUi {
    /// Sections repliées (`local`, `remote:origin`, `tags`…).
    pub collapsed: Vec<String>,
    /// Sections masquées.
    pub hidden: Vec<String>,
    /// Case « pousser après le commit ».
    pub push_after_commit: bool,
}

/// Un profil : une identité Git complète, choisie par dépôt.
#[derive(Serialize, Deserialize, Clone, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Profile {
    pub id: String,
    /// Nom affiché (« Perso », « Boulot »).
    pub name: String,
    pub user_name: String,
    pub user_email: String,
    /// Clé SSH privée utilisée pour fetch / pull / push (`None` : celle de SSH par défaut).
    pub ssh_key: Option<String>,
    /// Sélection automatique : hôtes de remote (`github.com`, `*.exemple.fr`) ou dossiers
    /// (`~/work/*`). Interprétées par l'interface (lib/profiles.ts).
    pub rules: Vec<String>,
    /// Couleur de la pastille (index de palette).
    pub color: u32,
    /// Image (data URL d'un carré de 128 px, quelques Ko) à la place des initiales.
    pub image: Option<String>,
    /// Signature des commits : "" (la configuration Git décide), "off", "gpg" ou "ssh".
    pub signing: String,
    /// GPG : identifiant ou empreinte (vide : choisie par gpg d'après l'e-mail).
    /// SSH : fichier de clé (vide : la clé SSH du profil).
    pub signing_key: Option<String>,
    /// Comptes providers (GitHub, GitLab) liés au profil ; leur token est dans le trousseau.
    pub accounts: Vec<crate::providers::Account>,
}

impl Profile {
    fn signing(&self) -> crate::git::Signing {
        use crate::git::Signing;
        let key = self.signing_key.as_deref().map(str::trim).filter(|k| !k.is_empty()).map(str::to_string);
        match self.signing.as_str() {
            "off" => Signing::Off,
            "gpg" => Signing::Gpg(key),
            // Sans clé de signature ni clé SSH : impossible de signer, la config Git décide.
            "ssh" => match key.or_else(|| self.ssh_key.clone().filter(|k| !k.trim().is_empty())) {
                Some(k) => Signing::Ssh(k),
                None => Signing::Config,
            },
            _ => Signing::Config,
        }
    }
}

/// Profils d'un dépôt : ceux qui lui sont associés et celui qui sert (relation N–N).
#[derive(Serialize, Deserialize, Clone, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct RepoProfiles {
    /// `None` : aucun profil, la configuration Git s'applique.
    pub active: Option<String>,
    pub allowed: Vec<String>,
    /// Profil choisi à la main pour un remote (clé SSH, compte de l'API), par nom de remote ;
    /// `null` : aucun profil. Absent : celui que désignent les règles sur l'URL du remote,
    /// sinon le profil du dépôt.
    pub remotes: HashMap<String, Option<String>>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct AppState {
    pub repos: Vec<RepoEntry>,
    pub session: Session,
    pub settings: Settings,
    /// Préférences par dépôt, indexées par chemin.
    pub repo_ui: HashMap<String, RepoUi>,
    pub profiles: Vec<Profile>,
    /// Profils par dépôt, indexés par chemin ; absent = jamais choisi (sélection automatique).
    pub repo_profiles: HashMap<String, RepoProfiles>,
    /// Clés que « Écrire l'identité dans .git/config » a écrites, par dépôt : celles que le
    /// profil suivant ne définit plus seront retirées (cf. `git::write_local_config`).
    pub written_config: HashMap<String, Vec<String>>,
}

impl AppState {
    /// Retire des dépôts les profils qui n'existent plus ; un dépôt dont le profil actif a
    /// disparu repasse sur la configuration Git.
    pub fn prune_profiles(&mut self) {
        let ids: std::collections::HashSet<&str> = self.profiles.iter().map(|p| p.id.as_str()).collect();
        for binding in self.repo_profiles.values_mut() {
            binding.allowed.retain(|id| ids.contains(id.as_str()));
            if binding.active.as_deref().is_some_and(|id| !ids.contains(id)) {
                binding.active = None;
            }
            // Le remote d'un profil supprimé retrouve le choix automatique.
            binding.remotes.retain(|_, choice| choice.as_deref().is_none_or(|id| ids.contains(id)));
        }
    }

    /// Identifiants des comptes providers portés par au moins un profil.
    pub fn account_ids(&self) -> std::collections::HashSet<String> {
        self.profiles.iter().flat_map(|p| p.accounts.iter().map(|a| a.id.clone())).collect()
    }

    /// Profils et choix par remote, pour la clé SSH de chaque remote (cf. `remotes::Table`).
    pub fn remote_table(&self) -> crate::remotes::Table {
        let profiles = self.profiles.iter().map(|p| crate::remotes::KeyProfile { id: p.id.clone(), rules: p.rules.clone(), ssh_key: p.ssh_key.clone() }).collect();
        let choices = self
            .repo_profiles
            .iter()
            .filter(|(_, binding)| !binding.remotes.is_empty())
            .map(|(path, binding)| (crate::git::repo_key(std::path::Path::new(path)), binding.remotes.clone()))
            .collect();
        crate::remotes::Table { profiles, choices }
    }

    /// Identité à injecter par dépôt (cf. `git::Identity`), d'après son profil actif.
    pub fn identities(&self) -> HashMap<String, crate::git::Identity> {
        self.repo_profiles
            .iter()
            .filter_map(|(path, binding)| {
                let profile = self.profiles.iter().find(|p| Some(&p.id) == binding.active.as_ref())?;
                let id = crate::git::Identity {
                    name: profile.user_name.clone(),
                    email: profile.user_email.clone(),
                    ssh_key: profile.ssh_key.clone(),
                    signing: profile.signing(),
                };
                Some((crate::git::repo_key(std::path::Path::new(path)), id))
            })
            .collect()
    }
}

pub struct Store {
    file: PathBuf,
    pub state: AppState,
}

impl Store {
    /// Charge l'état depuis `dir/state.json` ; état vide si absent ou illisible. Un fichier
    /// illisible est d'abord copié dans `state.json.bak` : la prochaine sauvegarde l'écrasera,
    /// et avec lui les dépôts et les profils qu'on pouvait encore y retrouver.
    pub fn load(dir: PathBuf) -> Self {
        let file = dir.join("state.json");
        let state = match fs::read_to_string(&file).map(|s| serde_json::from_str(&s)) {
            Ok(Ok(state)) => state,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => AppState::default(),
            _ => {
                let _ = fs::copy(&file, file.with_extension("json.bak"));
                AppState::default()
            }
        };
        Self { file, state }
    }

    /// Écrit l'état de façon atomique (fichier temporaire puis renommage).
    pub fn save(&self) -> Result<(), String> {
        if let Some(dir) = self.file.parent() {
            fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_vec_pretty(&self.state).map_err(|e| e.to_string())?;
        let tmp = self.file.with_extension("json.tmp");
        // Synchronisé avant le renommage : après une coupure de courant, le fichier est l'ancien
        // ou le nouveau, jamais un fichier vide.
        let write = |tmp: &PathBuf| -> std::io::Result<()> {
            use std::io::Write;
            let mut f = fs::File::create(tmp)?;
            f.write_all(&json)?;
            f.sync_all()
        };
        write(&tmp).map_err(|e| e.to_string())?;
        fs::rename(&tmp, &self.file).map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_file_gives_default_state() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::load(dir.path().join("absent"));
        assert!(store.state.repos.is_empty());
        assert_eq!(store.state.settings.theme, "system");
        assert_eq!(store.state.settings.language, "system");
    }

    #[test]
    fn save_then_load_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = Store::load(dir.path().join("cfg"));
        store.state.repos.push(RepoEntry { path: "/r".into(), name: "r".into(), last_opened: 42, alias: None });
        store.state.session = Session { open_tabs: vec!["/r".into()], active: Some("/r".into()) };
        store.state.settings.theme = "dark".into();
        store.state.repo_ui.insert("/r".into(), RepoUi { collapsed: vec!["tags".into()], hidden: vec![], push_after_commit: true });
        store.save().unwrap();

        let again = Store::load(dir.path().join("cfg"));
        assert_eq!(again.state.repos.len(), 1);
        assert_eq!(again.state.repos[0].last_opened, 42);
        assert_eq!(again.state.session.active.as_deref(), Some("/r"));
        assert_eq!(again.state.settings.theme, "dark");
        assert_eq!(again.state.repo_ui["/r"].collapsed, vec!["tags".to_string()]);
        assert!(again.state.repo_ui["/r"].push_after_commit);
        // Le fichier temporaire ne doit pas traîner.
        assert!(!dir.path().join("cfg").join("state.json.tmp").exists());
    }

    fn profile(id: &str, key: Option<&str>) -> Profile {
        Profile {
            id: id.into(),
            name: id.to_uppercase(),
            user_name: format!("Nom {id}"),
            user_email: format!("{id}@exemple.fr"),
            ssh_key: key.map(str::to_string),
            rules: vec!["github.com".into()],
            color: 2,
            image: Some("data:image/png;base64,AAAA".into()),
            ..Default::default()
        }
    }

    #[test]
    fn profiles_round_trip_and_give_identities() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = Store::load(dir.path().to_path_buf());
        store.state.profiles = vec![profile("perso", Some("~/.ssh/perso")), profile("boulot", None)];
        store.state.repo_profiles.insert("/r".into(), RepoProfiles { active: Some("perso".into()), allowed: vec!["perso".into(), "boulot".into()], ..Default::default() });
        store.state.repo_profiles.insert("/s".into(), RepoProfiles { active: None, allowed: vec!["boulot".into()], ..Default::default() });
        store.save().unwrap();

        let again = Store::load(dir.path().to_path_buf());
        assert_eq!(again.state.profiles, store.state.profiles);
        assert_eq!(again.state.repo_profiles, store.state.repo_profiles);
        let ids = again.state.identities();
        assert_eq!(ids.len(), 1, "un dépôt sans profil actif n'a pas d'identité");
        let id = &ids[&crate::git::repo_key(std::path::Path::new("/r"))];
        assert_eq!((id.name.as_str(), id.email.as_str(), id.ssh_key.as_deref()), ("Nom perso", "perso@exemple.fr", Some("~/.ssh/perso")));
    }

    #[test]
    fn accounts_round_trip_and_are_listed_once() {
        use crate::providers::Account;
        let account = |login: &str| Account { id: format!("github|https://github.com|{login}"), kind: "github".into(), url: "https://github.com".into(), login: login.into(), name: None };
        let mut state = AppState { profiles: vec![profile("perso", None), profile("boulot", None), profile("vide", None)], ..Default::default() };
        state.profiles[0].accounts = vec![account("moi")];
        state.profiles[1].accounts = vec![account("moi"), account("pro")];
        let again: AppState = serde_json::from_str(&serde_json::to_string(&state).unwrap()).unwrap();
        assert_eq!(again.profiles, state.profiles);
        assert_eq!(again.account_ids(), ["github|https://github.com|moi".to_string(), "github|https://github.com|pro".to_string()].into());
        // État écrit par une version antérieure : pas de comptes, et rien de secret dans le JSON.
        let old: AppState = serde_json::from_str(r#"{"profiles":[{"id":"p","name":"P"}]}"#).unwrap();
        assert!(old.profiles[0].accounts.is_empty());
        assert!(!serde_json::to_string(&state).unwrap().contains("token"));
    }

    #[test]
    fn signing_modes_from_profile() {
        use crate::git::Signing;
        let mut p = profile("p", Some("~/.ssh/p"));
        assert_eq!(p.signing(), Signing::Config);
        p.signing = "off".into();
        assert_eq!(p.signing(), Signing::Off);
        p.signing = "gpg".into();
        assert_eq!(p.signing(), Signing::Gpg(None));
        p.signing_key = Some(" ABCD1234 ".into());
        assert_eq!(p.signing(), Signing::Gpg(Some("ABCD1234".into())));
        p.signing = "ssh".into();
        assert_eq!(p.signing(), Signing::Ssh("ABCD1234".into()));
        p.signing_key = None;
        assert_eq!(p.signing(), Signing::Ssh("~/.ssh/p".into()), "clé SSH du profil par défaut");
        p.ssh_key = None;
        assert_eq!(p.signing(), Signing::Config, "rien pour signer");
    }

    #[test]
    fn deleted_profiles_are_pruned_from_repos() {
        let mut state = AppState { profiles: vec![profile("boulot", None)], ..Default::default() };
        state.repo_profiles.insert("/r".into(), RepoProfiles { active: Some("perso".into()), allowed: vec!["perso".into(), "boulot".into()], ..Default::default() });
        state.repo_profiles.get_mut("/r").unwrap().remotes =
            HashMap::from([("origin".to_string(), Some("perso".to_string())), ("client".to_string(), Some("boulot".to_string())), ("autre".to_string(), None)]);
        state.prune_profiles();
        let remotes = HashMap::from([("client".to_string(), Some("boulot".to_string())), ("autre".to_string(), None)]);
        assert_eq!(state.repo_profiles["/r"], RepoProfiles { active: None, allowed: vec!["boulot".into()], remotes: remotes.clone() });
        assert!(state.identities().is_empty());

        // Choix par remote transmis à la couche git, par dépôt.
        let table = state.remote_table();
        assert_eq!(table.profiles, [crate::remotes::KeyProfile { id: "boulot".into(), rules: vec!["github.com".into()], ssh_key: None }]);
        assert_eq!(table.choices, HashMap::from([(crate::git::repo_key(std::path::Path::new("/r")), remotes)]));
    }

    #[test]
    fn remote_choices_round_trip() {
        // `null` (aucun profil) n'est pas confondu avec l'absence de choix.
        let json = r#"{"repoProfiles":{"/r":{"active":"p","allowed":["p"],"remotes":{"origin":"p","client":null}},"/s":{"active":null,"allowed":[]}}}"#;
        let state: AppState = serde_json::from_str(json).unwrap();
        assert_eq!(state.repo_profiles["/r"].remotes, HashMap::from([("origin".to_string(), Some("p".to_string())), ("client".to_string(), None)]));
        assert!(state.repo_profiles["/s"].remotes.is_empty(), "état écrit par une version antérieure");
        let again: AppState = serde_json::from_str(&serde_json::to_string(&state).unwrap()).unwrap();
        assert_eq!(again.repo_profiles, state.repo_profiles);
    }

    #[test]
    fn corrupted_file_falls_back_to_default() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("state.json"), "{ pas du json").unwrap();
        let store = Store::load(dir.path().to_path_buf());
        assert!(store.state.repos.is_empty());
        // L'ancien contenu reste récupérable après la sauvegarde suivante.
        store.save().unwrap();
        assert_eq!(fs::read_to_string(dir.path().join("state.json.bak")).unwrap(), "{ pas du json");
        assert!(Store::load(dir.path().to_path_buf()).state.repos.is_empty());
    }

    #[test]
    fn partial_file_keeps_known_fields_and_defaults_the_rest() {
        // Un fichier écrit par une version plus ancienne (sans `settings`) reste lisible.
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join("state.json"),
            r#"{"repos":[{"path":"/r","name":"r","lastOpened":1}]}"#,
        )
        .unwrap();
        let store = Store::load(dir.path().to_path_buf());
        assert_eq!(store.state.repos.len(), 1);
        assert_eq!(store.state.settings.theme, "system");
        assert_eq!(store.state.settings.file_view, "list", "réglage ajouté après coup : valeur par défaut");
        assert_eq!(store.state.settings.diff_view, "inline");
        assert!(store.state.settings.layout.is_empty());
        assert!(store.state.settings.hidden_columns.is_empty());
        assert!(store.state.settings.auto_stash);
        assert_eq!(store.state.settings.pull_strategy, "ff-only");
        assert_eq!(store.state.settings.auto_fetch_minutes, 10);
        assert!(store.state.session.open_tabs.is_empty());
    }
}
