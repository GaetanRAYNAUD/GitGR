//! L'exécutable de GitGR sert aussi de gestionnaire d'identifiants git (« credential helper »)
//! pour les remotes HTTPS.
//!
//! Une commande réseau vers un remote `https://` dont le profil a un compte de cette instance
//! (cf. `remotes::https_accounts`) reçoit, pour l'origine du remote seulement :
//! `-c credential.<origine>.helper=` (les gestionnaires habituels — Git Credential Manager… —
//! sont ignorés : leurs identifiants, absents ou périmés, feraient échouer la connexion) puis
//! `-c credential.<origine>.helper=!'<GitGR>' --git-credential '<compte>'`. Git lance alors
//! GitGR avec `get` et la demande sur l'entrée standard ; GitGR n'ouvre aucune fenêtre : il
//! répond le login du compte et son token (lu dans le trousseau), et s'arrête. `store` et
//! `erase` sont ignorés : le token reste celui du compte.

use std::io::{Read, Write};

/// Premier argument qui lance GitGR en gestionnaire d'identifiants.
pub const ARG: &str = "--git-credential";

/// Valeur de `credential.<origine>.helper` pour ce compte : commande shell (git la lance par
/// `sh`, celui de Git pour Windows aussi), chemins entre apostrophes avec des `/`.
pub fn helper(exe: &str, account: &str) -> String {
    let quote = |s: &str| format!("'{}'", s.replace('\'', r"'\''"));
    format!("!{} {ARG} {}", quote(&exe.replace('\\', "/")), quote(account))
}

/// Arguments `-c` à placer avant la sous-commande git : pour chaque origine, le compte remplace
/// les gestionnaires d'identifiants habituels.
pub(crate) fn config_args(accounts: &[crate::remotes::HttpsAccount]) -> Vec<String> {
    if accounts.is_empty() {
        return Vec::new();
    }
    let Ok(exe) = std::env::current_exe() else { return Vec::new() };
    let exe = exe.to_string_lossy().to_string();
    accounts
        .iter()
        .flat_map(|a| {
            let key = format!("credential.{}.helper", a.origin);
            ["-c".to_string(), format!("{key}="), "-c".to_string(), format!("{key}={}", helper(&exe, &a.account))]
        })
        .collect()
}

/// Champ `nom=valeur` de la demande de git.
fn field<'a>(input: &'a str, name: &str) -> Option<&'a str> {
    input.lines().find_map(|l| l.strip_prefix(name)?.strip_prefix('='))
}

/// Réponse à la demande `get` de git pour ce compte : `username=<login>` et `password=<token>`.
/// `None` si la demande vise une autre instance que celle du compte (le token ne part jamais
/// ailleurs, même après une redirection), ou sans token.
pub fn answer(account: &str, input: &str, token: impl FnOnce(&str) -> Option<String>) -> Option<String> {
    // `<kind>|<url>|<login>` (cf. `providers::account_id`).
    let mut parts = account.splitn(3, '|');
    let (_kind, url, login) = (parts.next()?, parts.next()?, parts.next()?);
    let asked = format!("{}://{}", field(input, "protocol")?, field(input, "host")?);
    let instance = crate::remotes::http_origin(url)?;
    if crate::remotes::http_origin(&asked)? != instance {
        return None;
    }
    let token = token(account)?;
    let token = token.trim();
    if token.is_empty() || token.contains(['\n', '\r']) || login.contains(['\n', '\r']) {
        return None;
    }
    Some(format!("username={login}\npassword={token}\n"))
}

/// À appeler au tout début de `main` : lancé par git en gestionnaire d'identifiants, répond et
/// termine le processus.
pub fn run_if_requested() {
    let mut args = std::env::args().skip(1);
    if args.next().as_deref() != Some(ARG) {
        return;
    }
    let account = args.next().unwrap_or_default();
    let operation = args.next().unwrap_or_default();
    let mut input = String::new();
    let _ = std::io::stdin().read_to_string(&mut input);
    if operation == "get" {
        if let Some(out) = answer(&account, &input, crate::secrets::token) {
            let mut stdout = std::io::stdout();
            let _ = stdout.write_all(out.as_bytes()).and_then(|_| stdout.flush());
        }
    }
    std::process::exit(0);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::remotes::HttpsAccount;

    const ACCOUNT: &str = "github|https://github.com|moi";

    fn token(_: &str) -> Option<String> {
        Some("ghp_secret\n".into())
    }

    #[test]
    fn answers_only_for_the_instance_of_the_account() {
        let ok = answer(ACCOUNT, "protocol=https\nhost=github.com\npath=o/r.git\n", token);
        assert_eq!(ok.as_deref(), Some("username=moi\npassword=ghp_secret\n"));
        assert!(answer(ACCOUNT, "protocol=https\nhost=GitHub.com\n", token).is_some());
        assert_eq!(answer(ACCOUNT, "protocol=https\nhost=evil.example\n", token), None);
        assert_eq!(answer(ACCOUNT, "protocol=http\nhost=github.com\n", token), None);
        assert_eq!(answer(ACCOUNT, "host=github.com\n", token), None);
        assert_eq!(answer(ACCOUNT, "protocol=https\nhost=github.com\n", |_| None), None);
        assert_eq!(answer("invalide", "protocol=https\nhost=github.com\n", token), None);
        // Instance sur un port, GitLab sous un sous-chemin.
        let gitlab = "gitlab|https://git.exemple.fr:8443/gitlab|camille";
        assert!(answer(gitlab, "protocol=https\nhost=git.exemple.fr:8443\npath=gitlab/g/r.git\n", token).is_some());
    }

    #[test]
    fn helper_is_quoted_for_sh() {
        assert_eq!(helper(r"C:\Program Files\GitGR\gitgr.exe", "github|https://github.com|o'k"), r"!'C:/Program Files/GitGR/gitgr.exe' --git-credential 'github|https://github.com|o'\''k'");
    }

    #[test]
    fn config_resets_then_sets_the_helper_of_each_origin() {
        let args = config_args(&[HttpsAccount { origin: "https://github.com".into(), account: ACCOUNT.into() }]);
        assert_eq!(args.len(), 4);
        assert_eq!((args[0].as_str(), args[1].as_str(), args[2].as_str()), ("-c", "credential.https://github.com.helper=", "-c"));
        assert!(args[3].starts_with("credential.https://github.com.helper=!'") && args[3].ends_with(&format!("{ARG} '{ACCOUNT}'")), "{}", args[3]);
        assert!(config_args(&[]).is_empty());
    }

    /// Git n'utilise que notre gestionnaire pour cette origine, et garde les habituels ailleurs.
    #[test]
    fn git_uses_our_helper_for_its_origin_only() {
        let dir = tempfile::tempdir().unwrap();
        let global = dir.path().join("global");
        std::fs::write(&global, "[credential]\n\thelper = \"!f() { echo username=habituel; echo password=x; }; f\"\n").unwrap();
        let fill = |host: &str| {
            let mut args: Vec<String> = vec!["-c".into(), "credential.https://github.com.helper=".into()];
            args.push("-c".into());
            args.push("credential.https://github.com.helper=!f() { echo username=gitgr; echo password=t; }; f".into());
            args.extend(["credential".into(), "fill".into()]);
            let mut child = crate::git::quiet_command("git")
                .args(&args)
                .env("GIT_CONFIG_GLOBAL", &global)
                .env("GIT_CONFIG_NOSYSTEM", "1")
                .env("GIT_TERMINAL_PROMPT", "0")
                .stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::piped())
                .spawn()
                .unwrap();
            child.stdin.take().unwrap().write_all(format!("protocol=https\nhost={host}\n\n").as_bytes()).unwrap();
            String::from_utf8(child.wait_with_output().unwrap().stdout).unwrap()
        };
        assert!(fill("github.com").contains("username=gitgr"));
        assert!(fill("gitlab.com").contains("username=habituel"));
    }
}
