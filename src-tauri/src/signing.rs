//! Signature des commits : clés GPG disponibles (pour les proposer dans un profil).
//!
//! La signature elle-même est faite par git, avec la configuration injectée par `git.rs`
//! (`commit.gpgsign`, `gpg.format`, `user.signingkey`). La phrase de passe d'une clé GPG est
//! demandée par gpg-agent (sa fenêtre pinentry) ; celle d'une clé SSH, par l'askpass de GitGR.

use crate::git::quiet_command;
use serde::Serialize;
use std::path::PathBuf;

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GpgKey {
    /// Identifiant long (16 caractères hexadécimaux).
    pub id: String,
    pub fingerprint: String,
    /// `Nom <e-mail>` de chaque identité valide de la clé.
    pub uids: Vec<String>,
    /// Expirée ou révoquée : inutilisable pour signer.
    pub unusable: bool,
}

/// Programmes gpg à essayer : `gpg.program` de la config git, `gpg` du PATH, puis celui de Git
/// pour Windows (que git utilise par défaut, mais hors du PATH de l'app).
fn gpg_candidates() -> Vec<PathBuf> {
    let mut list = Vec::new();
    if let Ok(p) = crate::git::run(None, &["config", "--get", "gpg.program"]) {
        if !p.trim().is_empty() {
            list.push(PathBuf::from(p.trim()));
        }
    }
    list.push(PathBuf::from("gpg"));
    list.extend(crate::git::git_for_windows_tool("gpg"));
    list
}

/// Lance gpg (le premier qui existe) ; `gpg_not_found` si aucun. `prepare` complète la
/// commande (environnement des tests).
fn run_gpg_with(args: &[&str], prepare: impl Fn(&mut std::process::Command)) -> Result<std::process::Output, String> {
    for program in gpg_candidates() {
        let mut cmd = quiet_command(&program);
        cmd.args(args).stdin(std::process::Stdio::null());
        prepare(&mut cmd);
        match cmd.output() {
            Ok(out) => return Ok(out),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(e) => return Err(e.to_string()),
        }
    }
    Err("gpg_not_found".into())
}

/// Sortie de `gpg --list-secret-keys --with-colons` → clés (les sous-clés sont ignorées : git
/// signe avec la clé principale ou la sous-clé de signature qu'elle désigne).
fn parse_secret_keys(out: &str) -> Vec<GpgKey> {
    let mut keys: Vec<GpgKey> = Vec::new();
    // Ligne `fpr` : celle de la dernière clé principale vue (avant toute sous-clé).
    let mut want_fpr = false;
    for line in out.lines() {
        let f: Vec<&str> = line.split(':').collect();
        match f.first().copied() {
            Some("sec") => {
                let validity = f.get(1).copied().unwrap_or("");
                // Capacités : en majuscules, celles de la clé entière (sous-clés comprises) ;
                // `S` = signer, `D` = clé désactivée. Absentes (vieux gpg) : on ne conclut rien.
                let caps = f.get(11).copied().unwrap_or("");
                let cannot_sign = !caps.is_empty() && (!caps.contains('S') || caps.contains('D'));
                keys.push(GpgKey {
                    id: f.get(4).copied().unwrap_or("").to_string(),
                    fingerprint: String::new(),
                    uids: Vec::new(),
                    unusable: matches!(validity, "e" | "r" | "d" | "i") || cannot_sign,
                });
                want_fpr = true;
            }
            Some("fpr") if want_fpr => {
                if let Some(k) = keys.last_mut() {
                    k.fingerprint = f.get(9).copied().unwrap_or("").to_string();
                }
                want_fpr = false;
            }
            Some("ssb") => want_fpr = false,
            Some("uid") => {
                let validity = f.get(1).copied().unwrap_or("");
                if let (Some(k), false) = (keys.last_mut(), matches!(validity, "r" | "e")) {
                    // Les `:` et `\` sont échappés en `\x3a` / `\x5c` par gpg.
                    let uid = f.get(9).copied().unwrap_or("").replace("\\x3a", ":").replace("\\x5c", "\\");
                    if !uid.is_empty() {
                        k.uids.push(uid);
                    }
                }
            }
            _ => {}
        }
    }
    keys
}

/// Clés GPG secrètes de l'utilisateur.
pub fn gpg_keys() -> Result<Vec<GpgKey>, String> {
    let out = run_gpg_with(&["--batch", "--list-secret-keys", "--with-colons"], |_| {})?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(parse_secret_keys(&String::from_utf8_lossy(&out.stdout)))
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::git::tests::{set_identity, temp_repo};
    use crate::git::{run, Identity, Signing};
    use std::path::Path;

    /// Le gpg de Git pour Windows (msys) ne démarre son agent qu'avec un `GNUPGHOME` en chemin
    /// msys (`/c/…`) ; ailleurs, le chemin tel quel.
    fn msys_path(p: &Path) -> String {
        let s = p.to_string_lossy().replace('\\', "/");
        let b = s.as_bytes();
        if cfg!(windows) && b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':' {
            format!("/{}{}", (b[0] as char).to_ascii_lowercase(), &s[2..])
        } else {
            s
        }
    }

    /// gpg sur un trousseau jetable.
    fn run_gpg(args: &[&str], home: &Path) -> Result<std::process::Output, String> {
        run_gpg_with(args, |cmd| {
            cmd.env("GNUPGHOME", msys_path(home));
        })
    }

    #[test]
    fn parses_secret_keys() {
        let out = "sec:u:4096:1:5E8B7C4CFAC5417C:1757280836:1820352836::u:::scESCA:::+:::23::0:\n\
                   fpr:::::::::CD44BED4A958CD21393CB06C5E8B7C4CFAC5417C:\n\
                   grp:::::::::18818F93A8CA0E6118CF14B1AD6225FDEB729C7E:\n\
                   uid:u::::1757280836::A1::Camille Dupont <camille@exemple.fr>::::::::::0:\n\
                   uid:r::::1757280836::A2::Ancienne <old\\x3aname@exemple.fr>::::::::::0:\n\
                   ssb:u:4096:1:AAAABBBBCCCCDDDD:1757280836::::::e:::+:::23:\n\
                   fpr:::::::::0000000000000000000000000000000000000000:\n\
                   sec:e:255:22:1111222233334444:1600000000:1600000001::u:::scESCA:::+:::ed25519:::0:\n\
                   fpr:::::::::99999999999999999999999911112222333344445:\n\
                   uid:e::::1600000000::A3::Expirée <exp@exemple.fr>::::::::::0:\n";
        let keys = parse_secret_keys(out);
        assert_eq!(keys.len(), 2);
        assert_eq!(keys[0].id, "5E8B7C4CFAC5417C");
        assert_eq!(keys[0].fingerprint, "CD44BED4A958CD21393CB06C5E8B7C4CFAC5417C");
        assert_eq!(keys[0].uids, ["Camille Dupont <camille@exemple.fr>"]);
        assert!(!keys[0].unusable);
        assert!(keys[1].unusable && keys[1].uids.is_empty());
        // Clé de chiffrement seule, ou désactivée : rien pour signer.
        let caps = |c: &str| parse_secret_keys(&format!("sec:u:255:22:AAAA000011112222:1700000000:::u:::{c}:::+:::cv25519:::0:\n"))[0].unusable;
        assert!(caps("eE") && caps("scESCD"));
        assert!(!caps("scSC") && !caps(""));
    }

    /// Trousseau GPG jetable avec une clé de signature sans phrase de passe ; renvoie le
    /// dossier et l'empreinte. `None` si gpg est absent (test sauté).
    pub(crate) fn temp_gpg() -> Option<(tempfile::TempDir, String)> {
        let home = tempfile::tempdir().unwrap();
        let created = run_gpg(
            &["--batch", "--pinentry-mode", "loopback", "--passphrase", "", "--quick-gen-key", "Signe <signe@exemple.fr>", "ed25519", "sign", "never"],
            home.path(),
        )
        .ok()?;
        assert!(created.status.success(), "{}", String::from_utf8_lossy(&created.stderr));
        let list = run_gpg(&["--batch", "--list-secret-keys", "--with-colons"], home.path()).unwrap();
        let fpr = parse_secret_keys(&String::from_utf8_lossy(&list.stdout)).pop()?.fingerprint;
        Some((home, fpr))
    }

    /// git doit trouver ce trousseau : `gpg.program` du dépôt = petit script qui pose GNUPGHOME.
    fn use_gpg_home(repo: &Path, home: &Path) {
        let script = repo.join(".git").join("gpg-test.sh");
        let h = msys_path(home);
        std::fs::write(&script, format!("#!/bin/sh\nGNUPGHOME='{h}' exec gpg \"$@\"\n")).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        run(Some(repo), &["config", "gpg.program", &script.to_string_lossy().replace('\\', "/")]).unwrap();
    }

    /// Arrête l'agent du trousseau jetable (`gpgconf`, à côté de gpg).
    fn stop_agent(home: &Path) {
        for program in gpg_candidates() {
            let agent = program.with_file_name(if cfg!(windows) && program.extension().is_some() { "gpgconf.exe" } else { "gpgconf" });
            let ok = quiet_command(&agent).args(["--kill", "gpg-agent"]).env("GNUPGHOME", msys_path(home)).output().is_ok();
            if ok {
                return;
            }
        }
    }

    fn identity(signing: Signing) -> Option<Identity> {
        Some(Identity { name: "Signe".into(), email: "signe@exemple.fr".into(), ssh_key: None, signing })
    }

    fn raw_head(repo: &Path) -> String {
        run(Some(repo), &["cat-file", "commit", "HEAD"]).unwrap()
    }

    #[test]
    fn gpg_signing_from_the_profile() {
        let Some((home, fpr)) = temp_gpg() else {
            eprintln!("gpg introuvable : test sauté");
            return;
        };
        let repo = temp_repo();
        let p = repo.path();
        use_gpg_home(p, home.path());
        set_identity(p, identity(Signing::Gpg(Some(fpr.clone()))));
        crate::git::tests::commit_file(p, "a.txt", "1");
        assert!(raw_head(p).contains("-----BEGIN PGP SIGNATURE-----"), "{}", raw_head(p));
        let verify = run(Some(p), &["verify-commit", "--raw", "HEAD"]);
        assert!(verify.is_ok(), "{verify:?}");

        // Clé introuvable : erreur traduite, pas de commit.
        set_identity(p, identity(Signing::Gpg(Some("0000DEADBEEF0000".into()))));
        std::fs::write(p.join("b.txt"), "1").unwrap();
        run(Some(p), &["add", "b.txt"]).unwrap();
        assert_eq!(crate::worktree::commit(p, "b", false).unwrap_err(), "sign_failed");

        // « Ne pas signer » l'emporte sur commit.gpgsign de la config.
        run(Some(p), &["config", "commit.gpgsign", "true"]).unwrap();
        set_identity(p, identity(Signing::Off));
        crate::worktree::commit(p, "b", false).unwrap();
        assert!(!raw_head(p).contains("SIGNATURE"));
        set_identity(p, None);
        stop_agent(home.path());
    }

    #[test]
    fn ssh_signing_from_the_profile() {
        let repo = temp_repo();
        let p = repo.path();
        let keys = tempfile::tempdir().unwrap();
        let key = keys.path().join("sign_ed25519").to_string_lossy().to_string();
        crate::profiles::generate_key(&key, "signe@exemple.fr", None).unwrap();
        set_identity(p, identity(Signing::Ssh(key.clone())));
        crate::git::tests::commit_file(p, "a.txt", "1");
        assert!(raw_head(p).contains("-----BEGIN SSH SIGNATURE-----"), "{}", raw_head(p));
        // `log.showSignature` ne se glisse pas dans ce que lit l'historique.
        run(Some(p), &["config", "log.showSignature", "true"]).unwrap();
        let commits = crate::history::log(p, 0, 10).unwrap();
        assert_eq!(commits.len(), 1);
        assert!(commits[0].sha.len() == 40 && commits[0].sha.chars().all(|c| c.is_ascii_hexdigit()), "{:?}", commits[0].sha);
        assert_eq!(crate::history::details(p, &commits[0].sha).unwrap().subject, "test");
        assert_eq!(crate::worktree::head_message(p).unwrap(), "test");
        // La `.pub` indiquée à la place de la clé privée marche aussi.
        set_identity(p, identity(Signing::Ssh(format!("{key}.pub"))));
        crate::git::tests::commit_file(p, "b.txt", "1");
        assert!(raw_head(p).contains("-----BEGIN SSH SIGNATURE-----"));
        // Clé absente : erreur traduite.
        set_identity(p, identity(Signing::Ssh(format!("{key}-absente"))));
        std::fs::write(p.join("c.txt"), "1").unwrap();
        run(Some(p), &["add", "c.txt"]).unwrap();
        assert_eq!(crate::worktree::commit(p, "c", false).unwrap_err(), "sign_failed");
        set_identity(p, None);
    }
}
