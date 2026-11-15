//! L'exécutable de GitGR sert aussi de programme « askpass » pour ssh.
//!
//! Une commande réseau (fetch, pull, push) passe par ssh sans terminal : pour une clé protégée
//! par une phrase de passe, ssh la demande au programme de `SSH_ASKPASS`. `git.rs` y met
//! l'exécutable de GitGR, avec `GITGR_ASKPASS_KEY` = la clé du profil ; lancé ainsi, GitGR
//! n'ouvre aucune fenêtre : il lit la phrase de passe dans le trousseau, l'écrit sur la sortie
//! standard pour ssh, et s'arrête. Toute autre question (empreinte d'un hôte inconnu…) reçoit
//! un refus : ssh échoue proprement au lieu d'attendre.

/// Variable posée par `git.rs` : chemin de la clé du profil.
pub const KEY_VAR: &str = "GITGR_ASKPASS_KEY";

/// Réponse à la question `prompt` de ssh pour cette clé (`None` : refus).
pub fn answer(prompt: &str, key: &str) -> Option<String> {
    if !prompt.to_lowercase().contains("passphrase") {
        return None;
    }
    crate::secrets::passphrase(key)
}

/// À appeler au tout début de `main` : en mode askpass, répond et termine le processus.
pub fn run_if_requested() {
    let Some(key) = std::env::var_os(KEY_VAR) else { return };
    let prompt = std::env::args().nth(1).unwrap_or_default();
    let code = match answer(&prompt, &key.to_string_lossy()) {
        Some(pass) => {
            use std::io::Write;
            let mut out = std::io::stdout();
            if writeln!(out, "{pass}").and_then(|_| out.flush()).is_ok() { 0 } else { 1 }
        }
        None => 1,
    };
    std::process::exit(code);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_passphrase_prompts_are_answered() {
        if !crate::secrets::tests::keyring_available() {
            eprintln!("trousseau indisponible : test sauté");
            return;
        }
        let key = format!("/gitgr-tests/askpass-{}/id", std::process::id());
        crate::secrets::set_passphrase(&key, "secret").unwrap();
        assert_eq!(answer("Enter passphrase for key '/c/x/id': ", &key).as_deref(), Some("secret"));
        assert_eq!(answer("Are you sure you want to continue connecting (yes/no/[fingerprint])? ", &key), None);
        crate::secrets::delete_passphrase(&key).unwrap();
        assert_eq!(answer("Enter passphrase for key: ", &key), None);
    }
}
