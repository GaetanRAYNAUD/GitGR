//! Clés SSH des profils : lecture (type, empreinte, clé publique, phrase de passe ou non) et
//! génération d'une clé ed25519, avec `ssh-keygen`.
//!
//! L'injection de l'identité et de la clé dans les commandes git est dans `git.rs`
//! (`Identity`, `GIT_SSH_COMMAND`).

use crate::git::{expand_home, quiet_command};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Output;

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SshKeyInfo {
    /// `ED25519`, `RSA`…
    pub kind: String,
    pub bits: u32,
    /// `SHA256:…`
    pub fingerprint: String,
    pub comment: String,
    /// Contenu de la clé publique (`ssh-ed25519 AAAA… commentaire`), si on a pu le lire.
    pub public_key: Option<String>,
    /// Protégée par une phrase de passe.
    pub encrypted: bool,
    /// Sa phrase de passe est dans le trousseau de l'OS (ssh l'obtient par `askpass`).
    pub passphrase_stored: bool,
}

/// `ssh-keygen` du PATH, sinon celui de Git pour Windows (`<git>/usr/bin`, hors du PATH en
/// général). Renvoie la sortie de la première qui a pu être lancée.
fn ssh_keygen(args: &[&str]) -> Result<Output, String> {
    let mut candidates = vec![PathBuf::from("ssh-keygen")];
    if cfg!(windows)
        && let Ok(exec) = crate::git::run(None, &["--exec-path"])
        && let Some(root) = Path::new(&exec).ancestors().nth(3)
    {
        // C:/Program Files/Git/mingw64/libexec/git-core → C:/Program Files/Git
        candidates.push(root.join("usr").join("bin").join("ssh-keygen.exe"));
    }
    for program in candidates {
        match quiet_command(&program).args(args).stdin(std::process::Stdio::null()).output() {
            Ok(out) => return Ok(out),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(e) => return Err(e.to_string()),
        }
    }
    Err("ssh_keygen_not_found".into())
}

fn text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).trim().to_string()
}

/// Ligne de `ssh-keygen -l` : `256 SHA256:abc… commentaire (ED25519)`.
fn parse_fingerprint(line: &str) -> Option<(u32, String, String, String)> {
    let line = line.lines().next()?.trim();
    let (bits, rest) = line.split_once(' ')?;
    let (fingerprint, rest) = rest.split_once(' ').unwrap_or((rest, ""));
    let (comment, kind) = match rest.rfind(" (") {
        Some(i) if rest.ends_with(')') => (&rest[..i], &rest[i + 2..rest.len() - 1]),
        _ if rest.starts_with('(') && rest.ends_with(')') => ("", &rest[1..rest.len() - 1]),
        _ => (rest, ""),
    };
    Some((bits.parse().ok()?, fingerprint.to_string(), comment.trim().to_string(), kind.to_string()))
}

/// Informations sur une clé privée (`~` accepté).
pub fn key_info(path: &str) -> Result<SshKeyInfo, String> {
    let file = expand_home(path.trim());
    if !file.is_file() {
        return Err("key_not_found".into());
    }
    // Une clé publique se lit aussi avec `-l`, mais ssh ne peut pas s'en servir comme identité.
    if file.extension().is_some_and(|e| e == "pub") {
        return Err("key_is_public".into());
    }
    let f = file.to_string_lossy();
    let out = ssh_keygen(&["-l", "-f", &f])?;
    let (bits, fingerprint, comment, kind) =
        parse_fingerprint(&text(&out.stdout)).filter(|_| out.status.success()).ok_or("not_a_key")?;
    // Sans phrase de passe, `-y -P ""` redonne la clé publique. Un échec ne veut dire « phrase de
    // passe » que si ssh-keygen le dit ; sinon la clé est inutilisable (droits trop larges…) :
    // son message est renvoyé tel quel.
    let derived = ssh_keygen(&["-y", "-P", "", "-f", &f])?;
    let encrypted = !derived.status.success();
    if encrypted {
        let err = text(&derived.stderr);
        if !err.to_lowercase().contains("passphrase") {
            return Err(if err.is_empty() { "not_a_key".into() } else { err });
        }
    }
    let mut pub_file = file.clone().into_os_string();
    pub_file.push(".pub");
    let public_key = std::fs::read_to_string(&pub_file)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| (!encrypted).then(|| text(&derived.stdout)).filter(|s| !s.is_empty()));
    let passphrase_stored = encrypted && crate::secrets::has_passphrase(path);
    Ok(SshKeyInfo { kind, bits, fingerprint, comment, public_key, encrypted, passphrase_stored })
}

/// Enregistre la phrase de passe d'une clé dans le trousseau, après avoir vérifié qu'elle
/// l'ouvre (`wrong_passphrase` sinon) ; `None` l'oublie.
pub fn set_passphrase(path: &str, passphrase: Option<&str>) -> Result<SshKeyInfo, String> {
    match passphrase {
        None => crate::secrets::delete_passphrase(path)?,
        Some(pass) => {
            let file = expand_home(path.trim());
            if !file.is_file() {
                return Err("key_not_found".into());
            }
            // Passée en argument le temps de la vérification (ssh-keygen ne la lit autrement que
            // sur un terminal) : visible des seuls processus de l'utilisateur, un instant.
            let out = ssh_keygen(&["-y", "-P", pass, "-f", &file.to_string_lossy()])?;
            if !out.status.success() {
                let err = text(&out.stderr);
                let wrong = err.is_empty() || err.to_lowercase().contains("passphrase");
                return Err(if wrong { "wrong_passphrase".into() } else { err });
            }
            crate::secrets::set_passphrase(path, pass)?;
        }
    }
    key_info(path)
}

/// Génère une clé ed25519 (et sa `.pub`), protégée par `passphrase` si elle est donnée (rangée
/// aussitôt dans le trousseau) ; refuse d'écraser un fichier.
pub fn generate_key(path: &str, comment: &str, passphrase: Option<&str>) -> Result<SshKeyInfo, String> {
    let file = expand_home(path.trim());
    if path.trim().is_empty() {
        return Err("key_not_found".into());
    }
    if file.exists() {
        return Err("key_exists".into());
    }
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let f = file.to_string_lossy();
    let out = ssh_keygen(&["-q", "-t", "ed25519", "-N", passphrase.unwrap_or(""), "-C", comment.trim(), "-f", &f])?;
    if !out.status.success() {
        let err = text(&out.stderr);
        return Err(if err.is_empty() { text(&out.stdout) } else { err });
    }
    if let Some(pass) = passphrase.filter(|p| !p.is_empty()) {
        crate::secrets::set_passphrase(path, pass)?;
    }
    key_info(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_fingerprint_lines() {
        assert_eq!(
            parse_fingerprint("256 SHA256:q3Vt8fXw moi@perso.fr (ED25519)\n"),
            Some((256, "SHA256:q3Vt8fXw".into(), "moi@perso.fr".into(), "ED25519".into()))
        );
        assert_eq!(
            parse_fingerprint("3072 SHA256:abc no comment here (RSA)"),
            Some((3072, "SHA256:abc".into(), "no comment here".into(), "RSA".into()))
        );
        assert_eq!(parse_fingerprint("256 SHA256:abc (ED25519)"), Some((256, "SHA256:abc".into(), "".into(), "ED25519".into())));
        assert_eq!(parse_fingerprint("pas une clé"), None);
    }

    #[test]
    fn missing_or_invalid_keys() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(key_info(&dir.path().join("absent").to_string_lossy()).unwrap_err(), "key_not_found");
        let junk = dir.path().join("junk");
        std::fs::write(&junk, "pas une clé").unwrap();
        assert_eq!(key_info(&junk.to_string_lossy()).unwrap_err(), "not_a_key");
    }

    #[test]
    fn generates_then_reads_a_key() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sub").join("gitgr_test_ed25519");
        let p = path.to_string_lossy().to_string();
        let info = generate_key(&p, "moi@perso.fr", None).unwrap();
        assert_eq!(info.kind, "ED25519");
        assert!(info.fingerprint.starts_with("SHA256:"), "{info:?}");
        assert_eq!(info.comment, "moi@perso.fr");
        assert!(!info.encrypted);
        let public = info.public_key.unwrap();
        assert!(public.starts_with("ssh-ed25519 ") && public.ends_with(" moi@perso.fr"), "{public}");
        assert!(dir.path().join("sub").join("gitgr_test_ed25519.pub").is_file());
        // La clé publique n'est pas une identité utilisable.
        assert_eq!(key_info(&format!("{p}.pub")).unwrap_err(), "key_is_public");
        // Jamais d'écrasement.
        assert_eq!(generate_key(&p, "x", None).unwrap_err(), "key_exists");
    }

    #[test]
    fn detects_a_passphrase() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("locked");
        let p = path.to_string_lossy().to_string();
        let out = ssh_keygen(&["-q", "-t", "ed25519", "-N", "secret", "-C", "c", "-f", &p]).unwrap();
        assert!(out.status.success(), "{}", text(&out.stderr));
        let info = key_info(&p).unwrap();
        assert!(info.encrypted);
        // La `.pub` est lue à la place.
        assert!(info.public_key.unwrap().starts_with("ssh-ed25519 "));
        // Sans `.pub`, pas de clé publique (il faudrait la phrase de passe), mais l'empreinte reste.
        std::fs::remove_file(dir.path().join("locked.pub")).unwrap();
        let info = key_info(&p).unwrap();
        assert!(info.encrypted && info.public_key.is_none() && info.fingerprint.starts_with("SHA256:"));
    }

    #[test]
    fn passphrase_is_checked_then_stored_and_forgotten() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("locked");
        let p = path.to_string_lossy().to_string();
        let out = ssh_keygen(&["-q", "-t", "ed25519", "-N", "bon secret", "-C", "c", "-f", &p]).unwrap();
        assert!(out.status.success(), "{}", text(&out.stderr));
        // Une mauvaise phrase est refusée sans rien écrire.
        assert_eq!(set_passphrase(&p, Some("mauvaise")).unwrap_err(), "wrong_passphrase");
        assert!(!crate::secrets::has_passphrase(&p));
        if !crate::secrets::tests::keyring_available() {
            eprintln!("trousseau indisponible : suite du test sautée");
            return;
        }
        let info = set_passphrase(&p, Some("bon secret")).unwrap();
        assert!(info.encrypted && info.passphrase_stored);
        assert_eq!(crate::secrets::passphrase(&p).as_deref(), Some("bon secret"));
        let info = set_passphrase(&p, None).unwrap();
        assert!(info.encrypted && !info.passphrase_stored);
    }
}
