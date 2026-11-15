//! Secrets dans le trousseau de l'OS (Gestionnaire d'identification sous Windows, Secret
//! Service sous Linux, trousseau sous macOS) : jamais dans `state.json`.
//!
//! Pour l'instant : la phrase de passe des clés SSH, rangée par fichier de clé (une clé
//! partagée par deux profils n'a qu'une phrase de passe).

use crate::git::{expand_home, repo_key};

const SERVICE: &str = "fr.gitgr.app";

/// Nom de l'entrée d'une clé : son chemin absolu normalisé (`~` développé, `/`, casse ignorée
/// sous Windows), pour que `~/.ssh/id` et `C:\Users\x\.ssh\id` désignent la même entrée.
fn account(key: &str) -> String {
    format!("ssh-key:{}", repo_key(&expand_home(key.trim())))
}

fn entry(key: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, &account(key)).map_err(|_| "keyring_unavailable".to_string())
}

/// Phrase de passe enregistrée pour cette clé (`None` : aucune, ou trousseau indisponible).
pub fn passphrase(key: &str) -> Option<String> {
    entry(key).ok()?.get_password().ok()
}

pub fn has_passphrase(key: &str) -> bool {
    passphrase(key).is_some()
}

pub fn set_passphrase(key: &str, value: &str) -> Result<(), String> {
    entry(key)?.set_password(value).map_err(|_| "keyring_unavailable".to_string())
}

/// Oublie la phrase de passe (rien à faire si elle n'était pas enregistrée).
pub fn delete_passphrase(key: &str) -> Result<(), String> {
    match entry(key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("keyring_unavailable".into()),
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// Trousseau utilisable ? (pas de Secret Service sur un runner Linux sans session) — les
    /// tests qui en ont besoin sont alors sautés.
    /// Retire ces entrées du trousseau à la fin du test, même s'il échoue.
    pub(crate) struct Cleanup(pub Vec<String>);

    impl Drop for Cleanup {
        fn drop(&mut self) {
            for key in &self.0 {
                let _ = delete_passphrase(key);
            }
        }
    }

    pub(crate) fn keyring_available() -> bool {
        let probe = format!("probe-{}", std::process::id());
        let ok = set_passphrase(&probe, "x").is_ok() && passphrase(&probe).as_deref() == Some("x");
        let _ = delete_passphrase(&probe);
        ok
    }

    #[test]
    fn same_key_written_differently_is_one_entry() {
        let home = crate::git::home_dir().unwrap();
        let full = home.join(".ssh").join("id_test").to_string_lossy().to_string();
        assert_eq!(account("~/.ssh/id_test"), account(&full));
        assert_eq!(account(" /k/id "), account("/k/id"));
    }

    #[test]
    fn stores_reads_and_forgets() {
        if !keyring_available() {
            eprintln!("trousseau indisponible : test sauté");
            return;
        }
        let key = format!("/gitgr-tests/{}/id", std::process::id());
        let _cleanup = Cleanup(vec![key.clone()]);
        assert!(!has_passphrase(&key));
        set_passphrase(&key, "pa ss'phrase").unwrap();
        assert_eq!(passphrase(&key).as_deref(), Some("pa ss'phrase"));
        delete_passphrase(&key).unwrap();
        assert!(passphrase(&key).is_none());
        // Oublier une phrase absente n'est pas une erreur.
        delete_passphrase(&key).unwrap();
    }
}
