//! Secrets dans le trousseau de l'OS (Gestionnaire d'identification sous Windows, Secret
//! Service sous Linux, trousseau sous macOS) : jamais dans `state.json`.
//!
//! - la phrase de passe des clés SSH, rangée par fichier de clé (une clé partagée par deux
//!   profils n'a qu'une phrase de passe) ;
//! - le token des comptes providers (GitHub, GitLab), rangé par compte.

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

// --- Tokens des comptes providers (GitHub, GitLab) -------------------------------

/// Entrée du token d'un compte, par identifiant de compte (cf. `providers::account_id`).
fn token_entry(account: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, &format!("token:{account}")).map_err(|_| "keyring_unavailable".to_string())
}

/// Token enregistré pour ce compte (`None` : aucun, ou trousseau indisponible).
pub fn token(account: &str) -> Option<String> {
    token_entry(account).ok()?.get_password().ok()
}

pub fn set_token(account: &str, value: &str) -> Result<(), String> {
    token_entry(account)?.set_password(value).map_err(|_| "keyring_unavailable".to_string())
}

/// Oublie le token (rien à faire s'il n'était pas enregistré).
pub fn delete_token(account: &str) -> Result<(), String> {
    match token_entry(account)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("keyring_unavailable".into()),
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// Retire ces entrées du trousseau à la fin du test, même s'il échoue.
    pub(crate) struct Cleanup(pub Vec<String>);

    impl Drop for Cleanup {
        fn drop(&mut self) {
            for key in &self.0 {
                let _ = delete_passphrase(key);
            }
        }
    }

    #[test]
    fn tokens_are_stored_per_account() {
        // Avant tout le reste : relâché en dernier, après le nettoyage du trousseau.
        let _keyring = keyring_lock();
        if !keyring_available(&_keyring) {
            eprintln!("trousseau indisponible : test sauté");
            return;
        }
        let account = format!("github|https://tests.invalid/{}|moi", std::process::id());
        let _cleanup = ForgetToken(account.clone());
        assert!(token(&account).is_none());
        set_token(&account, "ghp_secret").unwrap();
        assert_eq!(token(&account).as_deref(), Some("ghp_secret"));
        // Une phrase de passe de clé ne se confond pas avec un token.
        assert!(passphrase(&account).is_none());
        delete_token(&account).unwrap();
        assert!(token(&account).is_none());
        delete_token(&account).unwrap();
    }

    /// Retire le token de ce compte du trousseau à la fin du test, même s'il échoue.
    pub(crate) struct ForgetToken(pub String);

    impl Drop for ForgetToken {
        fn drop(&mut self) {
            let _ = delete_token(&self.0);
        }
    }

    /// Les tests qui écrivent dans le trousseau passent un par un : en parallèle, le gestionnaire
    /// d'identifiants de Windows garde parfois une entrée pourtant supprimée (une fuite par
    /// lancement de `cargo test`).
    pub(crate) fn keyring_lock() -> std::sync::MutexGuard<'static, ()> {
        static KEYRING: std::sync::Mutex<()> = std::sync::Mutex::new(());
        KEYRING.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Trousseau utilisable ? (pas de Secret Service sur un runner Linux sans session) — les
    /// tests qui en ont besoin sont alors sautés. Demande le verrou des tests du trousseau
    /// (`keyring_lock`) : un test qui l'oublie ne compile pas. Une entrée sonde par appel.
    pub(crate) fn keyring_available(_lock: &std::sync::MutexGuard<'static, ()>) -> bool {
        static NEXT: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
        let n = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let probe = format!("probe-{}-{n}", std::process::id());
        let _cleanup = Cleanup(vec![probe.clone()]);
        set_passphrase(&probe, "x").is_ok() && passphrase(&probe).as_deref() == Some("x")
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
        // Avant tout le reste : relâché en dernier, après le nettoyage du trousseau.
        let _keyring = keyring_lock();
        if !keyring_available(&_keyring) {
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
