//! L'exécutable de GitGR sert aussi de programme « askpass » pour ssh.
//!
//! Une commande réseau (fetch, pull, push) passe par ssh sans terminal : pour une clé protégée
//! par une phrase de passe, ssh la demande au programme de `SSH_ASKPASS`. `git.rs` y met
//! l'exécutable de GitGR, avec `GITGR_ASKPASS_KEY` = la clé du profil ; lancé ainsi, GitGR
//! n'ouvre aucune fenêtre : il lit la phrase de passe dans le trousseau, l'écrit sur la sortie
//! standard pour ssh, et s'arrête. Toute autre question (empreinte d'un hôte inconnu…) reçoit
//! un refus : ssh échoue proprement au lieu d'attendre.

/// Variable posée par `git.rs` : clés possibles, une par ligne (clé SSH du profil, clé de
/// signature SSH).
pub const KEY_VAR: &str = "GITGR_ASKPASS_KEY";

/// `/c/Users/x` (chemin msys, celui que cite le ssh de Git pour Windows) → `c:/Users/x`.
fn from_msys(path: &str) -> String {
    let b = path.as_bytes();
    if b.len() >= 3 && b[0] == b'/' && b[1].is_ascii_alphabetic() && b[2] == b'/' {
        format!("{}:{}", b[1] as char, &path[2..])
    } else {
        path.to_string()
    }
}

/// Réponse à la question `prompt` de ssh / ssh-keygen (`None` : refus). Une seule clé
/// candidate : la sienne. Sinon, la clé citée par la question (`… for key '/c/x/id':`) ;
/// à défaut, la première dont la phrase de passe est connue.
pub fn answer(prompt: &str, keys: &str) -> Option<String> {
    if !prompt.to_lowercase().contains("passphrase") {
        return None;
    }
    let keys: Vec<&str> = keys.lines().map(str::trim).filter(|k| !k.is_empty()).collect();
    let quoted = prompt.split('\'').nth(1).map(|p| crate::git::repo_key(std::path::Path::new(&from_msys(p))));
    let named = keys.iter().find(|k| {
        let k = crate::git::repo_key(&crate::git::expand_home(k));
        quoted.as_deref().is_some_and(|q| q == k || q == format!("{k}.pub"))
    });
    match named {
        Some(k) => crate::secrets::passphrase(k),
        None => keys.iter().find_map(|k| crate::secrets::passphrase(k)),
    }
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
        // Avant tout le reste : relâché en dernier, après le nettoyage du trousseau.
        let _keyring = crate::secrets::tests::keyring_lock();
        if !crate::secrets::tests::keyring_available(&_keyring) {
            eprintln!("trousseau indisponible : test sauté");
            return;
        }
        let key = format!("/gitgr-tests/askpass-{}/id", std::process::id());
        let _cleanup = crate::secrets::tests::Cleanup(vec![key.clone()]);
        crate::secrets::set_passphrase(&key, "secret").unwrap();
        assert_eq!(answer("Enter passphrase for key '/c/x/id': ", &key).as_deref(), Some("secret"));
        assert_eq!(answer("Are you sure you want to continue connecting (yes/no/[fingerprint])? ", &key), None);
        crate::secrets::delete_passphrase(&key).unwrap();
        assert_eq!(answer("Enter passphrase for key: ", &key), None);
    }

    #[test]
    fn picks_the_key_named_in_the_prompt() {
        // Avant tout le reste : relâché en dernier, après le nettoyage du trousseau.
        let _keyring = crate::secrets::tests::keyring_lock();
        assert_eq!(from_msys("/c/Users/x/id"), "c:/Users/x/id");
        assert_eq!(from_msys("/home/x/id"), "/home/x/id");
        if !crate::secrets::tests::keyring_available(&_keyring) {
            eprintln!("trousseau indisponible : test sauté");
            return;
        }
        let base = format!("C:/gitgr-tests/askpass2-{}", std::process::id());
        let (a, b) = (format!("{base}/a"), format!("{base}/b"));
        let _cleanup = crate::secrets::tests::Cleanup(vec![a.clone(), b.clone()]);
        crate::secrets::set_passphrase(&a, "pa").unwrap();
        crate::secrets::set_passphrase(&b, "pb").unwrap();
        let both = format!("{a}\n{b}");
        let msys_b = format!("/c/gitgr-tests/askpass2-{}/b", std::process::id());
        if cfg!(windows) {
            assert_eq!(answer(&format!("Enter passphrase for key '{msys_b}': "), &both).as_deref(), Some("pb"));
        }
        assert_eq!(answer(&format!("Enter passphrase for key '{b}': "), &both).as_deref(), Some("pb"));
        // Sans clé citée : la première connue.
        assert_eq!(answer("Enter passphrase: ", &both).as_deref(), Some("pa"));
        crate::secrets::delete_passphrase(&a).unwrap();
        assert_eq!(answer("Enter passphrase: ", &both).as_deref(), Some("pb"));
        crate::secrets::delete_passphrase(&b).unwrap();
    }
}
