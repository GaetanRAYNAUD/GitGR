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
/// `-c user.name=… -c user.email=…` (rien n'est écrit dans la config git). Sa clé SSH sert aux
/// remotes qui n'ont pas leur propre profil (cf. `remotes`).
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
    if map.values().any(|id| matches!(id.signing, Signing::Gpg(_))) {
        crate::signing::launch_agent_once();
    }
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

/// Écrit ces réglages dans `.git/config` (« Écrire l'identité dans .git/config ») et retire ceux
/// de `previous` — les clés écrites la fois d'avant — que le profil ne définit plus : la
/// signature d'un ancien profil ne survit pas au changement. Les réglages que l'utilisateur a
/// posés lui-même ne sont jamais dans `previous`, donc jamais retirés. Renvoie les clés écrites.
pub fn write_local_config(repo: &Path, settings: &[(&'static str, String)], previous: &[String]) -> Result<Vec<String>, String> {
    for key in previous.iter().filter(|k| !settings.iter().any(|(s, _)| s == k)) {
        // Déjà absente (retirée à la main) : rien à faire.
        let _ = run(Some(repo), &["config", "--local", "--unset-all", key]);
    }
    for (key, value) in settings {
        run(Some(repo), &["config", "--local", key, value])?;
    }
    Ok(settings.iter().map(|(key, _)| key.to_string()).collect())
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

/// Sous-commandes qui parlent à un remote : elles reçoivent la clé SSH de chaque remote.
fn is_network(args: &[&str]) -> bool {
    matches!(args.first(), Some(&("fetch" | "pull" | "push" | "ls-remote" | "clone")))
}

/// Ce qui est ajouté à une commande git lancée dans `cwd` : arguments placés avant la
/// sous-commande, et variables d'environnement. Identité et signature du profil du dépôt pour
/// toutes les commandes ; pour une commande réseau (`network`), `GIT_SSH_COMMAND` avec la clé
/// du profil de chaque remote (cf. `remotes::ssh_setup`).
fn injected(cwd: Option<&Path>, network: bool) -> (Vec<String>, Vec<(&'static str, String)>) {
    let Some(dir) = cwd else { return (Vec::new(), Vec::new()) };
    let id = identity_for(dir);
    let mut args: Vec<String> = id.iter().flat_map(Identity::config).flat_map(|(k, v)| ["-c".to_string(), format!("{k}={v}")]).collect();
    let mut keys = id.as_ref().map(Identity::askpass_keys).unwrap_or_default();
    let mut env = Vec::new();
    if network {
        // Remotes HTTPS : token du compte du profil de chaque remote (cf. `credential`).
        args.extend(crate::credential::config_args(&crate::remotes::https_accounts(dir)));
        if let Some(ssh) = crate::remotes::ssh_setup(dir, id.as_ref().and_then(|i| i.ssh_key.as_deref())) {
            env.push(("GIT_SSH_COMMAND", ssh.command));
            for key in ssh.keys {
                if !keys.contains(&key) {
                    keys.push(key);
                }
            }
        }
    }
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
/// Une clé par ligne dans `GITGR_ASKPASS_KEY` (clé SSH du profil du dépôt, clé de signature
/// SSH, clés des profils des remotes).
pub(crate) fn askpass_env(keys: &[String]) -> Vec<(&'static str, String)> {
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

/// Configuration imposée à chaque commande git (cf. `git_command`).
const CONFIG_OVERRIDES: [&str; 5] =
    ["log.showSignature=false", "diff.noprefix=false", "diff.mnemonicPrefix=false", "diff.srcPrefix=a/", "diff.dstPrefix=b/"];

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
    // Réglages de l'utilisateur qui changeraient les sorties que nous analysons :
    // `log.showSignature` écrit la vérification de signature avant chaque commit ; sans les
    // préfixes `a/` `b/` (`diff.noprefix`, `diff.mnemonicPrefix`…), un patch partiel passé à
    // `git apply` viserait un autre chemin.
    cmd.args(CONFIG_OVERRIDES.iter().flat_map(|setting| ["-c", setting]));
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

/// Sortie brute (octets) d'une commande git locale : contenu d'un fichier binaire.
pub fn run_bytes(cwd: Option<&Path>, args: &[&str]) -> Result<Vec<u8>, String> {
    let mut cmd = git_command();
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    cmd.args(args).stdin(std::process::Stdio::null());
    let out = cmd.output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(out.stdout)
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
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
    let (identity_args, identity_env) = injected(cwd, is_network(args));
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
        let stdin = child.stdin.take();
        // L'entrée est écrite par un autre fil pendant que les sorties sont lues : écrite d'abord,
        // elle bloquerait dès que git remplit son tube de sortie sans avoir tout lu (les deux
        // processus s'attendraient l'un l'autre). Fermée à la fin (drop) : git voit la fin du flux.
        // Une erreur d'écriture (git sorti sans tout lire) est ignorée : son code de retour et
        // son message disent pourquoi.
        std::thread::scope(|scope| {
            if let (Some(mut stdin), Some(text)) = (stdin, input) {
                scope.spawn(move || {
                    let _ = stdin.write_all(text.as_bytes());
                });
            }
            child.wait_with_output()
        })
    });
    let out = spawned.map_err(|e| {
        // Dossier de travail disparu (dépôt supprimé, disque démonté) : le lancement échoue
        // lui aussi, parfois avec la même erreur que pour un programme introuvable.
        if cwd.is_some_and(|dir| !dir.is_dir()) {
            "path_not_found".to_string()
        } else if e.kind() == std::io::ErrorKind::NotFound {
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

/// Lance `git <args>` hors de tout dépôt (clone), avec `env` en plus, en lisant sa sortie
/// d'erreur au fil de l'eau : `on_line` reçoit chaque ligne, coupée sur `\r` comme sur `\n`
/// (git réécrit sa progression sur la même ligne). `cancel` passé à vrai arrête git :
/// `Err("cancelled")`. En échec, l'erreur est faite des lignes que `is_progress` n'écarte pas.
pub fn run_streaming(
    args: &[&str],
    env: &[(&str, String)],
    cancel: &std::sync::atomic::AtomicBool,
    is_progress: impl Fn(&str) -> bool + Send,
    on_line: impl FnMut(&str) + Send,
) -> Result<(), String> {
    use std::io::Read;
    use std::process::Stdio;
    use std::sync::atomic::Ordering;
    let mut cmd = git_command();
    cmd.args(args);
    for (k, v) in env {
        cmd.env(k, v);
    }
    cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped());
    // Groupe de processus à part : l'annulation arrête aussi ce que git a lancé (ssh,
    // git-remote-https, index-pack), sinon ils garderaient la sortie ouverte et le dossier occupé.
    #[cfg(unix)]
    std::os::unix::process::CommandExt::process_group(&mut cmd, 0);
    let mut child = cmd.spawn().map_err(|e| if e.kind() == std::io::ErrorKind::NotFound { "git_not_found".to_string() } else { e.to_string() })?;
    let mut stderr = child.stderr.take().expect("stderr capturée");
    let mut on_line = on_line;
    std::thread::scope(|scope| {
        let reader = scope.spawn(move || {
            // Lignes qui ne sont pas de la progression : le message d'erreur, à la fin.
            let mut kept: Vec<String> = Vec::new();
            let mut pending: Vec<u8> = Vec::new();
            let mut buf = [0u8; 4096];
            let mut flush = |pending: &mut Vec<u8>, kept: &mut Vec<String>| {
                let line = String::from_utf8_lossy(pending).trim().to_string();
                pending.clear();
                if line.is_empty() {
                    return;
                }
                on_line(&line);
                if !is_progress(&line) {
                    kept.push(line);
                    // Une sortie sans fin ne remplit pas la mémoire.
                    if kept.len() > 50 {
                        kept.remove(0);
                    }
                }
            };
            loop {
                match stderr.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        for &b in &buf[..n] {
                            if b == b'\r' || b == b'\n' {
                                flush(&mut pending, &mut kept);
                            } else {
                                pending.push(b);
                            }
                        }
                    }
                }
            }
            flush(&mut pending, &mut kept);
            kept
        });
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break Ok(status),
                Ok(None) if cancel.load(Ordering::Relaxed) => {
                    kill_tree(child.id());
                    let _ = child.kill();
                    let _ = child.wait();
                    break Err("cancelled".to_string());
                }
                Ok(None) => std::thread::sleep(std::time::Duration::from_millis(50)),
                Err(e) => break Err(e.to_string()),
            }
        };
        let kept = reader.join().unwrap_or_default();
        match status? {
            s if s.success() => Ok(()),
            _ if cancel.load(Ordering::Relaxed) => Err("cancelled".to_string()),
            // Arrêté sans rien dire (tué de l'extérieur) : au moins son code de sortie.
            s if kept.is_empty() => Err(format!("git: {s}")),
            _ => Err(kept.join("\n")),
        }
    })
}

/// Arrête un processus et tous ceux qu'il a lancés (git → ssh, git-remote-https…).
fn kill_tree(pid: u32) {
    #[cfg(windows)]
    let _ = quiet_command("taskkill").args(["/T", "/F", "/PID", &pid.to_string()]).output();
    // Sous Unix, le processus est chef de son groupe (`process_group(0)`).
    #[cfg(unix)]
    let _ = Command::new("kill").args(["-KILL", "--", &format!("-{pid}")]).output();
}

/// Outil livré avec Git pour Windows (`ssh-keygen`, `gpg`…) : `<Git>/usr/bin/<nom>.exe`, hors
/// du PATH de l'app en général. `None` ailleurs que sous Windows, ou sans git. La racine de Git
/// n'est cherchée qu'une fois.
pub fn git_for_windows_tool(name: &str) -> Option<PathBuf> {
    static ROOT: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();
    if !cfg!(windows) {
        return None;
    }
    let root = match ROOT.get() {
        Some(root) => root,
        None => {
            // C:/Program Files/Git/mingw64/libexec/git-core → C:/Program Files/Git
            let exec = run(None, &["--exec-path"]).ok()?;
            let root = Path::new(&exec).ancestors().nth(3)?.to_path_buf();
            ROOT.get_or_init(|| root)
        }
    };
    Some(root.join("usr").join("bin").join(format!("{name}.exe")))
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
    /// Dernier fetch (date de `FETCH_HEAD`, en secondes depuis 1970) ; `None` : jamais.
    pub last_fetch: Option<u64>,
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
    s.last_fetch = last_fetch(path);
    Ok(s)
}

/// Date du dernier fetch : celle de `FETCH_HEAD`, dans le dossier `.git` (ou, pour un worktree
/// lié, dans le dossier commun du dépôt).
fn last_fetch(path: &Path) -> Option<u64> {
    let mtime = |p: std::path::PathBuf| -> Option<u64> {
        let t = std::fs::metadata(p).ok()?.modified().ok()?;
        Some(t.duration_since(std::time::UNIX_EPOCH).ok()?.as_secs())
    };
    let dir = crate::branches::git_dir(path).ok()?;
    mtime(dir.join("FETCH_HEAD")).or_else(|| {
        let common = run(Some(path), &["rev-parse", "--path-format=absolute", "--git-common-dir"]).ok()?;
        (std::path::Path::new(&common) != dir).then(|| mtime(std::path::Path::new(&common).join("FETCH_HEAD")))?
    })
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
        let (args, env) = injected(Some(repo.path()), false);
        assert_eq!(args, ["-c", "user.name=Perso X", "-c", "user.email=moi@perso.fr"]);
        let var = |env: &[(&'static str, String)], k: &str| env.iter().find(|(name, _)| *name == k).map(|(_, v)| v.clone());
        // Hors commande réseau : pas de réglage ssh.
        assert_eq!(var(&env, "GIT_SSH_COMMAND"), None);
        // Phrase de passe : ssh la demande à l'exécutable de GitGR (mode askpass).
        let exe = std::env::current_exe().unwrap().to_string_lossy().replace('\\', "/");
        assert_eq!(var(&env, "SSH_ASKPASS"), Some(exe));
        assert_eq!(var(&env, "SSH_ASKPASS_REQUIRE").as_deref(), Some("force"));
        assert_eq!(var(&env, crate::askpass::KEY_VAR).as_deref(), Some("/k/id"));
        assert_eq!(injected(Some(other.path()), true), (vec![], vec![]));
        assert_eq!(injected(None, true), (vec![], vec![]));

        // Commande réseau : sans remote ssh, rien ; avec, la clé du profil du dépôt pour son hôte.
        assert_eq!(var(&injected(Some(repo.path()), true).1, "GIT_SSH_COMMAND"), None);
        let host = format!("depot-{}.exemple.fr", std::process::id());
        run(Some(repo.path()), &["remote", "add", "origin", &format!("git@{host}:g/r.git")]).unwrap();
        let env = injected(Some(repo.path()), true).1;
        let command = var(&env, "GIT_SSH_COMMAND").unwrap();
        let file = command.strip_prefix("ssh -F '").and_then(|c| c.strip_suffix('\'')).unwrap();
        assert!(std::fs::read_to_string(file).unwrap().contains(&format!("Host {host}\n  IdentityFile \"/k/id\"\n  IdentitiesOnly yes")));
        assert_eq!(var(&env, crate::askpass::KEY_VAR).as_deref(), Some("/k/id"));
        assert!(is_network(&["fetch", "-q", "--all"]) && is_network(&["push"]) && !is_network(&["status"]) && !is_network(&[]));

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
    fn large_input_does_not_block_on_large_output() {
        // git répond au fil de la lecture : sans lecture de sa sortie pendant l'écriture de
        // l'entrée, les deux tubes se rempliraient et la commande ne finirait jamais.
        let repo = temp_repo();
        std::fs::write(repo.path().join(".gitignore"), "*.o\n").unwrap();
        let count = 20_000;
        let input: String = (0..count).map(|i| format!("un/dossier/assez/long/pour/remplir/le/tube/{i}.o\0")).collect();
        let out = run_input(Some(repo.path()), &["check-ignore", "-z", "--stdin"], &input).unwrap();
        assert_eq!(out.split('\0').filter(|s| !s.is_empty()).count(), count);
        // git sort sans lire son entrée : c'est son résultat qui compte, pas l'écriture interrompue.
        assert!(run_input(None, &["--version"], &input).unwrap().starts_with("git version"));
    }

    #[test]
    fn written_identity_replaces_the_previous_one() {
        let repo = temp_repo();
        let p = repo.path();
        let local = |key: &str| run(Some(p), &["config", "--local", "--get", key]).ok();
        // Réglage posé à la main : jamais retiré.
        run(Some(p), &["config", "core.hooksPath", "hooks"]).unwrap();
        let id = |signing| Identity { name: "A".into(), email: "a@exemple.fr".into(), ssh_key: None, signing };

        let written = write_local_config(p, &id(Signing::Ssh("/k/sign".into())).config(), &[]).unwrap();
        assert_eq!(written, ["user.name", "user.email", "commit.gpgsign", "gpg.format", "user.signingkey"]);
        assert_eq!(local("gpg.format").as_deref(), Some("ssh"));

        // Profil suivant, signature laissée à Git : celle de l'ancien profil disparaît.
        let mut next = id(Signing::Config);
        next.name = "B".into();
        let written = write_local_config(p, &next.config(), &written).unwrap();
        assert_eq!(written, ["user.name", "user.email"]);
        assert_eq!(local("user.name").as_deref(), Some("B"));
        assert_eq!((local("commit.gpgsign"), local("gpg.format"), local("user.signingkey")), (None, None, None));
        assert_eq!(local("core.hooksPath").as_deref(), Some("hooks"));

        // Sans trace d'une écriture précédente, rien n'est retiré (signature posée à la main).
        run(Some(p), &["config", "commit.gpgsign", "true"]).unwrap();
        write_local_config(p, &next.config(), &[]).unwrap();
        assert_eq!(local("commit.gpgsign").as_deref(), Some("true"));
    }

    #[test]
    fn missing_folder_is_not_a_missing_git() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(run(Some(&dir.path().join("absent")), &["status"]).unwrap_err(), "path_not_found");
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
