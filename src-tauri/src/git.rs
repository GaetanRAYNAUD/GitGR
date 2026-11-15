//! Couche d'accès à Git via le binaire `git`.
//!
//! Les erreurs renvoyées au frontend sont des *codes* (`not_a_repo`,
//! `path_not_found`, `git_not_found`…) traduits côté interface (i18n),
//! ou, à défaut, le message brut de git.

use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{LazyLock, RwLock};

/// Commande qui n'ouvre pas de fenêtre console sous Windows (git, ssh-keygen…).
pub fn quiet_command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Identité du profil actif d'un dépôt, injectée dans chaque commande git lancée dedans :
/// `-c user.name=… -c user.email=…` (rien n'est écrit dans la config git) et, avec une clé,
/// `GIT_SSH_COMMAND` pour que fetch / pull / push s'authentifient avec elle.
#[derive(Clone, Debug, PartialEq, Default)]
pub struct Identity {
    pub name: String,
    pub email: String,
    /// Chemin de la clé privée (`~` accepté).
    pub ssh_key: Option<String>,
    pub signing: Signing,
}

/// Signature des commits du profil.
#[derive(Clone, Debug, PartialEq, Default)]
pub enum Signing {
    /// La configuration Git décide (`commit.gpgsign`, `user.signingkey`…).
    #[default]
    Config,
    /// Jamais, même si la configuration Git le demande.
    Off,
    /// GPG ; clé (identifiant ou empreinte) facultative : sinon gpg choisit d'après l'e-mail.
    Gpg(Option<String>),
    /// SSH, avec cette clé (privée ou `.pub`, `~` accepté).
    Ssh(String),
}

impl Identity {
    /// Réglages git du profil : identité et signature (injectés en `-c`, ou écrits dans
    /// `.git/config` par « Écrire l'identité dans .git/config »).
    pub fn config(&self) -> Vec<(&'static str, String)> {
        let clean = |v: &str| v.replace(['\n', '\r'], " ").trim().to_string();
        let mut out = Vec::new();
        for (key, value) in [("user.name", clean(&self.name)), ("user.email", clean(&self.email))] {
            if !value.is_empty() {
                out.push((key, value));
            }
        }
        match &self.signing {
            Signing::Config => {}
            Signing::Off => out.push(("commit.gpgsign", "false".into())),
            Signing::Gpg(key) => {
                out.push(("commit.gpgsign", "true".into()));
                out.push(("gpg.format", "openpgp".into()));
                // Sans clé choisie : l'e-mail du profil (gpg prend la clé de cette identité), et
                // surtout pas le `user.signingkey` de la config globale, qui peut viser une autre
                // clé, voire une clé SSH.
                let k = key.as_deref().map(clean).filter(|k| !k.is_empty()).unwrap_or_else(|| clean(&self.email));
                if !k.is_empty() {
                    out.push(("user.signingkey", k));
                }
            }
            Signing::Ssh(key) => {
                out.push(("commit.gpgsign", "true".into()));
                out.push(("gpg.format", "ssh".into()));
                // Clé privée pour ssh-keygen (`-Y sign -f`) : `/`, `~` développé, sans `.pub`.
                let k = expand_home(key.trim().trim_end_matches(".pub")).to_string_lossy().replace('\\', "/");
                out.push(("user.signingkey", k));
            }
        }
        out
    }

    /// Clés dont ssh / ssh-keygen peuvent demander la phrase de passe (askpass).
    fn askpass_keys(&self) -> Vec<String> {
        let mut keys: Vec<String> = Vec::new();
        let mut add = |k: &str| {
            let k = expand_home(k.trim().trim_end_matches(".pub")).to_string_lossy().to_string();
            if !k.is_empty() && !keys.contains(&k) {
                keys.push(k);
            }
        };
        if let Some(k) = self.ssh_key.as_deref().filter(|k| !k.trim().is_empty()) {
            add(k);
        }
        if let Signing::Ssh(k) = &self.signing {
            add(k);
        }
        keys
    }
}

/// Identités par dépôt, indexées par [`repo_key`] ; tenues à jour par `commands`.
static IDENTITIES: LazyLock<RwLock<HashMap<String, Identity>>> = LazyLock::new(Default::default);

/// Clé d'un dépôt dans [`IDENTITIES`] : `/` partout, sans `/` final, en minuscules sous Windows
/// (le même dossier peut arriver écrit `C:\x` ou `c:/x`).
pub fn repo_key(path: &Path) -> String {
    let s = path.to_string_lossy().replace('\\', "/");
    let s = s.trim_end_matches('/');
    if cfg!(windows) { s.to_lowercase() } else { s.to_string() }
}

/// Remplace toutes les identités (clés : [`repo_key`]).
pub fn set_identities(map: HashMap<String, Identity>) {
    *IDENTITIES.write().unwrap() = map;
}

/// Identité injectée dans ce dépôt (profil actif), s'il y en a une.
pub fn identity_for(cwd: &Path) -> Option<Identity> {
    let map = IDENTITIES.read().unwrap();
    if map.is_empty() {
        return None;
    }
    map.get(&repo_key(cwd)).cloned()
}

/// Dossier personnel de l'utilisateur (`USERPROFILE` sous Windows, `HOME` ailleurs).
pub fn home_dir() -> Option<PathBuf> {
    let var = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    std::env::var_os(var).or_else(|| std::env::var_os("HOME")).filter(|v| !v.is_empty()).map(PathBuf::from)
}

/// `~/x` → `<dossier personnel>/x`.
pub fn expand_home(path: &str) -> PathBuf {
    let rest = path.strip_prefix("~/").or_else(|| path.strip_prefix("~\\"));
    match (rest, home_dir()) {
        (Some(rest), Some(home)) => home.join(rest),
        (None, Some(home)) if path == "~" => home,
        _ => PathBuf::from(path),
    }
}

/// Commande SSH qui n'utilise que cette clé. Interprétée par un shell (celui de Git pour
/// Windows aussi) : chemin entre apostrophes, avec des `/` (un `\` y serait un échappement).
pub fn ssh_command(key: &str) -> String {
    let path = expand_home(key).to_string_lossy().replace('\\', "/").replace('\'', r"'\''");
    format!("ssh -i '{path}' -o IdentitiesOnly=yes")
}

/// Ce qui est ajouté à une commande git lancée dans `cwd` : arguments placés avant la
/// sous-commande, et variables d'environnement.
fn injected(cwd: Option<&Path>) -> (Vec<String>, Vec<(&'static str, String)>) {
    let Some(id) = cwd.and_then(identity_for) else { return (Vec::new(), Vec::new()) };
    let args = id.config().into_iter().flat_map(|(k, v)| ["-c".to_string(), format!("{k}={v}")]).collect();
    let mut env = Vec::new();
    if let Some(key) = id.ssh_key.as_deref().map(str::trim).filter(|k| !k.is_empty()) {
        env.push(("GIT_SSH_COMMAND", ssh_command(key)));
    }
    let keys = id.askpass_keys();
    if !keys.is_empty() {
        env.extend(askpass_env(&keys));
    }
    (args, env)
}

/// Phrase de passe d'une clé protégée : ssh n'a pas de terminal, il la demande au programme de
/// `SSH_ASKPASS` — l'exécutable de GitGR lui-même, qui la lit dans le trousseau (cf. `askpass`).
/// `SSH_ASKPASS_REQUIRE=force` (OpenSSH ≥ 8.4) l'impose ; `DISPLAY` pour les versions plus
/// anciennes, qui n'appellent l'askpass qu'avec un affichage. Rien n'est lu dans le trousseau
/// ici : seulement si ssh pose effectivement la question.
/// Une clé par ligne dans `GITGR_ASKPASS_KEY` (clé SSH du profil, clé de signature SSH).
fn askpass_env(keys: &[String]) -> Vec<(&'static str, String)> {
    let Ok(exe) = std::env::current_exe() else { return Vec::new() };
    let mut env = vec![
        ("SSH_ASKPASS", exe.to_string_lossy().replace('\\', "/")),
        ("SSH_ASKPASS_REQUIRE", "force".to_string()),
        (crate::askpass::KEY_VAR, keys.join("\n")),
    ];
    if std::env::var_os("DISPLAY").is_none() {
        env.push(("DISPLAY", ":0".to_string()));
    }
    env
}

/// Prépare une commande `git` qui n'ouvre pas de fenêtre console sous Windows.
fn git_command() -> Command {
    let mut cmd = quiet_command("git");
    // Sortie stable, non traduite, sans pager ni invite interactive.
    // GIT_OPTIONAL_LOCKS=0 : nos lectures en arrière-plan (status…) ne prennent pas
    // `.git/index.lock`, sinon elles feraient échouer les commandes git lancées en parallèle
    // par l'utilisateur dans un terminal.
    cmd.env("LC_ALL", "C")
        .env("GIT_PAGER", "cat")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0");
    for (key, value) in appimage_env_fixes() {
        match value {
            Some(v) => cmd.env(key, v),
            None => cmd.env_remove(key),
        };
    }
    cmd
}

/// Lancée depuis une AppImage, l'app reçoit un environnement qui pointe vers les
/// bibliothèques embarquées (`LD_LIBRARY_PATH=$APPDIR/usr/lib…`, modules GTK…). Transmis
/// tel quel, git (et `git-remote-https`, ssh, les gestionnaires d'identifiants) chargerait
/// ces bibliothèques au lieu de celles du système : par exemple la libcurl du système avec
/// la libnghttp2 de l'AppImage, plus ancienne → « symbol lookup error ». On retire donc
/// des variables tout ce qui pointe dans l'AppImage. Vide hors AppImage.
fn appimage_env_fixes() -> &'static [(String, Option<String>)] {
    static FIXES: std::sync::OnceLock<Vec<(String, Option<String>)>> = std::sync::OnceLock::new();
    FIXES.get_or_init(|| match std::env::var("APPDIR") {
        Ok(appdir) if !appdir.is_empty() => env_without(std::env::vars(), &appdir),
        _ => Vec::new(),
    })
}

/// Variables à corriger : celles dont une entrée (liste séparée par `:`) est dans `appdir`.
/// Les entrées concernées sont retirées ; une variable qui n'en garde aucune est supprimée.
fn env_without(vars: impl Iterator<Item = (String, String)>, appdir: &str) -> Vec<(String, Option<String>)> {
    let appdir = appdir.trim_end_matches('/');
    let inside = |entry: &str| entry == appdir || entry.starts_with(&format!("{appdir}/"));
    vars.filter(|(_, v)| v.split(':').any(inside))
        .map(|(k, v)| {
            let kept: Vec<&str> = v.split(':').filter(|e| !e.is_empty() && !inside(e)).collect();
            (k, (!kept.is_empty()).then(|| kept.join(":")))
        })
        .collect()
}

/// Lance `git <args>` (dans `cwd` si fourni) et renvoie stdout, sans les blancs de fin.
pub fn run(cwd: Option<&Path>, args: &[&str]) -> Result<String, String> {
    run_raw(cwd, args).map(|s| s.trim_end().to_string())
}

/// Comme [`run`], mais renvoie stdout tel quel (diffs : les blancs de fin comptent).
pub fn run_raw(cwd: Option<&Path>, args: &[&str]) -> Result<String, String> {
    run_with_input(cwd, args, None, &[])
}

/// Comme [`run`], avec des variables d'environnement en plus (`GIT_EDITOR`…).
pub fn run_env(cwd: Option<&Path>, args: &[&str], env: &[(&str, &str)]) -> Result<String, String> {
    run_with_input(cwd, args, None, env).map(|s| s.trim_end().to_string())
}

/// Lance git en lui passant `input` sur l'entrée standard (message de commit, patch…).
pub fn run_input(cwd: Option<&Path>, args: &[&str], input: &str) -> Result<String, String> {
    run_with_input(cwd, args, Some(input), &[]).map(|s| s.trim_end().to_string())
}

fn run_with_input(cwd: Option<&Path>, args: &[&str], input: Option<&str>, env: &[(&str, &str)]) -> Result<String, String> {
    use std::io::Write;
    use std::process::Stdio;
    let mut cmd = git_command();
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    let (identity_args, identity_env) = injected(cwd);
    cmd.args(identity_args).args(args);
    for (k, v) in identity_env {
        cmd.env(k, v);
    }
    for (k, v) in env {
        cmd.env(k, v);
    }
    // Comme `Command::output()` : sorties capturées, pas d'entrée héritée (sauf `input`).
    cmd.stdin(if input.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let spawned = cmd.spawn().and_then(|mut child| {
        if let Some(text) = input {
            // Écrit puis ferme l'entrée (drop) pour que git voie la fin du flux.
            child.stdin.take().expect("stdin").write_all(text.as_bytes())?;
        }
        child.wait_with_output()
    });
    let out = spawned.map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "git_not_found".to_string()
        } else {
            e.to_string()
        }
    })?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        // Certaines erreurs ne sont écrites que sur stdout (« nothing to commit »…).
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        Err(if err.is_empty() { String::from_utf8_lossy(&out.stdout).trim().to_string() } else { err })
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitInfo {
    pub found: bool,
    pub version: Option<String>,
}

/// Détecte la présence de git et sa version.
pub fn info() -> GitInfo {
    match run(None, &["--version"]) {
        Ok(v) => GitInfo {
            found: true,
            version: Some(v.trim_start_matches("git version ").trim().to_string()),
        },
        Err(_) => GitInfo { found: false, version: None },
    }
}

/// Renvoie la racine du dépôt contenant `path`.
pub fn toplevel(path: &Path) -> Result<PathBuf, String> {
    if !path.is_dir() {
        return Err("path_not_found".into());
    }
    match run(Some(path), &["rev-parse", "--show-toplevel"]) {
        Ok(top) => Ok(PathBuf::from(top)),
        Err(e) => Err(match classify_error(&e) {
            Some(code) => code.to_string(),
            None => "not_a_repo".to_string(),
        }),
    }
}

/// Le commit n'a pas pu être signé (gpg ou ssh-keygen en échec : clé introuvable, phrase de
/// passe refusée…) ; git le dit par « gpg failed to sign » ou « failed to write commit object »
/// après un message du programme de signature.
pub fn is_sign_error(stderr: &str) -> bool {
    let s = stderr.to_lowercase();
    s.contains("failed to sign the data")
        || (s.contains("failed to write commit object")
            && ["gpg failed", "ssh-keygen", "signing file", "couldn't load", "couldn't sign", "signing failed"]
                .iter()
                .any(|p| s.contains(p)))
}

/// Reconnaît les erreurs git qui ont un code dédié (traduit côté interface).
pub fn classify_error(stderr: &str) -> Option<&'static str> {
    if stderr == "git_not_found" {
        Some("git_not_found")
    } else if stderr.contains("dubious ownership") {
        // Dépôt appartenant à un autre utilisateur : git exige `safe.directory`.
        Some("dubious_ownership")
    } else {
        None
    }
}

#[derive(Serialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RepoSummary {
    /// Nom de la branche courante (`None` si HEAD détachée).
    pub branch: Option<String>,
    /// SHA du commit courant (`None` si dépôt sans commit).
    pub head: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    /// Nombre de fichiers modifiés / non suivis / en conflit.
    pub changes: u32,
    pub remote_url: Option<String>,
}

/// Résumé rapide de l'état du dépôt, lu depuis `git status --porcelain=v2 --branch`.
pub fn summary(path: &Path) -> Result<RepoSummary, String> {
    if !path.is_dir() {
        return Err("path_not_found".into());
    }
    let out = run(Some(path), &["status", "--porcelain=v2", "--branch"])
        .map_err(|e| classify_error(&e).map(str::to_string).unwrap_or(e))?;
    let mut s = parse_status(&out);
    s.remote_url = run(Some(path), &["remote", "get-url", "origin"]).ok();
    Ok(s)
}

fn parse_status(out: &str) -> RepoSummary {
    let mut s = RepoSummary::default();
    for line in out.lines() {
        if let Some(v) = line.strip_prefix("# branch.oid ") {
            if v != "(initial)" {
                s.head = Some(v.to_string());
            }
        } else if let Some(v) = line.strip_prefix("# branch.head ") {
            if v != "(detached)" {
                s.branch = Some(v.to_string());
            }
        } else if let Some(v) = line.strip_prefix("# branch.upstream ") {
            s.upstream = Some(v.to_string());
        } else if let Some(v) = line.strip_prefix("# branch.ab ") {
            // Format : "+<ahead> -<behind>"
            for part in v.split_whitespace() {
                if let Some(n) = part.strip_prefix('+') {
                    s.ahead = n.parse().unwrap_or(0);
                } else if let Some(n) = part.strip_prefix('-') {
                    s.behind = n.parse().unwrap_or(0);
                }
            }
        } else if !line.starts_with('#') && !line.is_empty() {
            s.changes += 1;
        }
    }
    s
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    #[test]
    fn parses_porcelain_v2_status() {
        let out = "# branch.oid 1234abcd\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +2 -1\n1 .M N... 100644 100644 100644 a b src/x.rs\n? new.txt";
        let s = parse_status(out);
        assert_eq!(s.branch.as_deref(), Some("main"));
        assert_eq!(s.head.as_deref(), Some("1234abcd"));
        assert_eq!(s.upstream.as_deref(), Some("origin/main"));
        assert_eq!((s.ahead, s.behind, s.changes), (2, 1, 2));
    }

    #[test]
    fn appimage_environment_is_cleaned_for_git() {
        let app = "/tmp/.mount_GitGRab12";
        let vars = [
            ("LD_LIBRARY_PATH", "/tmp/.mount_GitGRab12/usr/lib:/tmp/.mount_GitGRab12/usr/lib/x86_64-linux-gnu"),
            ("PATH", "/tmp/.mount_GitGRab12/usr/bin:/usr/local/bin:/usr/bin"),
            ("XDG_DATA_DIRS", "/tmp/.mount_GitGRab12/usr/share/:/usr/share"),
            ("GDK_PIXBUF_MODULE_FILE", "/tmp/.mount_GitGRab12/usr/lib/loaders.cache"),
            ("HOME", "/home/ami"),
            // Même préfixe, autre dossier : pas concerné.
            ("OTHER", "/tmp/.mount_GitGRab123/x"),
        ]
        .map(|(k, v)| (k.to_string(), v.to_string()));
        let mut fixes = env_without(vars.into_iter(), app);
        fixes.sort();
        let s = |v: &str| Some(v.to_string());
        assert_eq!(
            fixes,
            vec![
                ("GDK_PIXBUF_MODULE_FILE".to_string(), None),
                ("LD_LIBRARY_PATH".to_string(), None),
                ("PATH".to_string(), s("/usr/local/bin:/usr/bin")),
                ("XDG_DATA_DIRS".to_string(), s("/usr/share")),
            ]
        );
    }

    #[test]
    fn parses_detached_and_initial() {
        let s = parse_status("# branch.oid (initial)\n# branch.head (detached)");
        assert!(s.branch.is_none() && s.head.is_none());
    }

    #[test]
    fn parses_upstream_without_ahead_behind() {
        // Branche distante supprimée : git donne l'upstream mais pas de ligne `branch.ab`.
        let s = parse_status("# branch.oid abc\n# branch.head main\n# branch.upstream origin/gone");
        assert_eq!(s.upstream.as_deref(), Some("origin/gone"));
        assert_eq!((s.ahead, s.behind), (0, 0));
    }

    #[test]
    fn classifies_known_errors() {
        let dubious = "fatal: detected dubious ownership in repository at 'D:/x'\nTo add an exception...";
        assert_eq!(classify_error(dubious), Some("dubious_ownership"));
        assert_eq!(classify_error("git_not_found"), Some("git_not_found"));
        assert_eq!(classify_error("fatal: not a git repository"), None);
    }

    // --- Tests sur un vrai dépôt (nécessitent `git` dans le PATH) ---------

    /// Crée un dépôt vide dans un dossier temporaire, avec une identité locale.
    pub(crate) fn temp_repo() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path();
        run(Some(p), &["init", "-q", "-b", "main"]).unwrap();
        run(Some(p), &["config", "user.name", "Test"]).unwrap();
        run(Some(p), &["config", "user.email", "test@exemple.fr"]).unwrap();
        run(Some(p), &["config", "commit.gpgsign", "false"]).unwrap();
        // Indépendant de la config système (Git pour Windows active autocrlf par défaut).
        run(Some(p), &["config", "core.autocrlf", "false"]).unwrap();
        dir
    }

    pub(crate) fn commit_file(repo: &Path, name: &str, content: &str) {
        std::fs::write(repo.join(name), content).unwrap();
        run(Some(repo), &["add", name]).unwrap();
        run(Some(repo), &["commit", "-q", "-m", "test"]).unwrap();
    }

    /// Ajoute (ou retire) une seule identité : les tests tournent en parallèle, remplacer toute
    /// la table effacerait celles des autres.
    pub(crate) fn set_identity(repo: &Path, id: Option<Identity>) {
        let mut map = IDENTITIES.write().unwrap();
        match id {
            Some(id) => map.insert(repo_key(repo), id),
            None => map.remove(&repo_key(repo)),
        };
    }

    #[test]
    fn repo_keys_ignore_separators_and_trailing_slash() {
        assert_eq!(repo_key(Path::new("/a/b/")), "/a/b");
        if cfg!(windows) {
            assert_eq!(repo_key(Path::new(r"C:\Users\X\Repo")), repo_key(Path::new("c:/users/x/repo/")));
        }
    }

    #[test]
    fn ssh_command_quotes_the_key_path() {
        assert_eq!(ssh_command("/k/my key"), "ssh -i '/k/my key' -o IdentitiesOnly=yes");
        assert_eq!(ssh_command(r"C:\Users\A B\.ssh\id"), "ssh -i 'C:/Users/A B/.ssh/id' -o IdentitiesOnly=yes");
        assert_eq!(ssh_command("/k/l'x"), r"ssh -i '/k/l'\''x' -o IdentitiesOnly=yes");
        let home = home_dir().unwrap().to_string_lossy().replace('\\', "/");
        assert_eq!(ssh_command("~/.ssh/id"), format!("ssh -i '{home}/.ssh/id' -o IdentitiesOnly=yes"));
    }

    #[test]
    fn signing_settings() {
        let id = |signing| Identity { name: "N".into(), email: "n@exemple.fr".into(), ssh_key: None, signing };
        let keys = |i: Identity| i.config().into_iter().skip(2).collect::<Vec<_>>();
        let s = |v: &str| v.to_string();
        assert_eq!(keys(id(Signing::Config)), []);
        assert_eq!(keys(id(Signing::Off)), [("commit.gpgsign", s("false"))]);
        // Clé GPG non choisie : celle de l'e-mail du profil, jamais celle de la config globale.
        assert_eq!(
            keys(id(Signing::Gpg(None))),
            [("commit.gpgsign", s("true")), ("gpg.format", s("openpgp")), ("user.signingkey", s("n@exemple.fr"))]
        );
        assert_eq!(keys(id(Signing::Gpg(Some("ABCD".into()))))[2], ("user.signingkey", s("ABCD")));
        assert_eq!(
            keys(id(Signing::Ssh(r"C:\k\sign.pub".into()))),
            [("commit.gpgsign", s("true")), ("gpg.format", s("ssh")), ("user.signingkey", s("C:/k/sign"))]
        );
    }

    #[test]
    fn signing_errors() {
        assert!(is_sign_error("error: gpg failed to sign the data\nfatal: failed to write commit object"));
        assert!(is_sign_error("error: Couldn't load public key /k/x: No such file or directory?\n\nfatal: failed to write commit object"));
        assert!(!is_sign_error("hook: reassigned owner\nfatal: failed to write commit object"));
        assert!(!is_sign_error("fatal: unable to write new index file"));
    }

    #[test]
    fn identity_is_injected_only_in_its_repo() {
        let repo = temp_repo();
        let other = temp_repo();
        let id = Identity { name: "Perso\nX".into(), email: " moi@perso.fr ".into(), ssh_key: Some("/k/id".into()), signing: Signing::Config };
        set_identity(repo.path(), Some(id));
        let (args, env) = injected(Some(repo.path()));
        assert_eq!(args, ["-c", "user.name=Perso X", "-c", "user.email=moi@perso.fr"]);
        let var = |k: &str| env.iter().find(|(name, _)| *name == k).map(|(_, v)| v.as_str());
        assert_eq!(var("GIT_SSH_COMMAND"), Some("ssh -i '/k/id' -o IdentitiesOnly=yes"));
        // Phrase de passe : ssh la demande à l'exécutable de GitGR (mode askpass).
        let exe = std::env::current_exe().unwrap().to_string_lossy().replace('\\', "/");
        assert_eq!(var("SSH_ASKPASS"), Some(exe.as_str()));
        assert_eq!(var("SSH_ASKPASS_REQUIRE"), Some("force"));
        assert_eq!(var(crate::askpass::KEY_VAR), Some("/k/id"));
        assert_eq!(injected(Some(other.path())), (vec![], vec![]));
        assert_eq!(injected(None), (vec![], vec![]));

        // Le commit prend l'identité du profil, pas celle de la config du dépôt.
        commit_file(repo.path(), "a.txt", "1");
        assert_eq!(run(Some(repo.path()), &["log", "-1", "--format=%an <%ae> / %cn <%ce>"]).unwrap(), "Perso X <moi@perso.fr> / Perso X <moi@perso.fr>");
        assert_eq!(run(Some(repo.path()), &["config", "--local", "user.name"]).unwrap(), "Test", "config git intacte");
        commit_file(other.path(), "a.txt", "1");
        assert_eq!(run(Some(other.path()), &["log", "-1", "--format=%an"]).unwrap(), "Test");

        set_identity(repo.path(), None);
        commit_file(repo.path(), "b.txt", "1");
        assert_eq!(run(Some(repo.path()), &["log", "-1", "--format=%an"]).unwrap(), "Test");
    }

    #[test]
    fn detects_git() {
        let i = info();
        assert!(i.found, "git doit être installé pour lancer les tests");
        assert!(i.version.unwrap().chars().next().unwrap().is_ascii_digit());
    }

    #[test]
    fn toplevel_from_a_subfolder() {
        let repo = temp_repo();
        let sub = repo.path().join("a").join("b");
        std::fs::create_dir_all(&sub).unwrap();
        let top = toplevel(&sub).unwrap();
        // Comparaison sur des chemins canoniques (git renvoie des `/` sous Windows).
        assert_eq!(
            std::fs::canonicalize(top).unwrap(),
            std::fs::canonicalize(repo.path()).unwrap()
        );
    }

    #[test]
    fn toplevel_errors() {
        let plain = tempfile::tempdir().unwrap();
        assert_eq!(toplevel(plain.path()).unwrap_err(), "not_a_repo");
        assert_eq!(
            toplevel(&plain.path().join("absent")).unwrap_err(),
            "path_not_found"
        );
    }

    #[test]
    fn summary_of_empty_repo() {
        let repo = temp_repo();
        let s = summary(repo.path()).unwrap();
        assert_eq!(s.branch.as_deref(), Some("main"));
        assert!(s.head.is_none());
        assert_eq!(s.changes, 0);
        assert!(s.remote_url.is_none());
    }

    #[test]
    fn summary_counts_changes_and_reads_remote() {
        let repo = temp_repo();
        let p = repo.path();
        commit_file(p, "a.txt", "1");
        std::fs::write(p.join("a.txt"), "2").unwrap(); // modifié
        std::fs::write(p.join("b.txt"), "x").unwrap(); // non suivi
        run(Some(p), &["remote", "add", "origin", "git@gitlab.exemple.fr:g/r.git"]).unwrap();

        let s = summary(p).unwrap();
        assert_eq!(s.head.as_ref().map(|h| h.len()), Some(40));
        assert_eq!(s.changes, 2);
        assert_eq!(s.remote_url.as_deref(), Some("git@gitlab.exemple.fr:g/r.git"));
        assert!(s.upstream.is_none());
    }

    #[test]
    fn summary_reports_ahead_and_behind() {
        // Un dépôt « distant » nu, un clone, puis des commits de chaque côté.
        let remote = tempfile::tempdir().unwrap();
        run(Some(remote.path()), &["init", "-q", "--bare", "-b", "main"]).unwrap();

        let a = temp_repo();
        let url = remote.path().to_string_lossy().to_string();
        run(Some(a.path()), &["remote", "add", "origin", &url]).unwrap();
        commit_file(a.path(), "f.txt", "1");
        run(Some(a.path()), &["push", "-q", "-u", "origin", "main"]).unwrap();

        // Un autre clone pousse un commit : `a` aura 1 commit de retard...
        let b = tempfile::tempdir().unwrap();
        run(Some(b.path()), &["clone", "-q", &url, "."]).unwrap();
        run(Some(b.path()), &["config", "user.name", "B"]).unwrap();
        run(Some(b.path()), &["config", "user.email", "b@exemple.fr"]).unwrap();
        run(Some(b.path()), &["config", "commit.gpgsign", "false"]).unwrap();
        commit_file(b.path(), "g.txt", "1");
        run(Some(b.path()), &["push", "-q"]).unwrap();

        // ... et 2 commits d'avance.
        commit_file(a.path(), "h.txt", "1");
        commit_file(a.path(), "i.txt", "1");
        run(Some(a.path()), &["fetch", "-q"]).unwrap();

        let s = summary(a.path()).unwrap();
        assert_eq!(s.upstream.as_deref(), Some("origin/main"));
        assert_eq!((s.ahead, s.behind), (2, 1));
    }
}
