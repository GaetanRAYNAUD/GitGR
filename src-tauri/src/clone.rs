//! Cloner un dépôt : par URL (https, ssh, chemin local), ou choisi dans la liste des dépôts
//! d'un compte GitHub / GitLab (l'interface donne alors son URL).
//!
//! Il n'y a pas encore de dépôt, donc pas de profil de dépôt ni de remote : la clé SSH est
//! celle du profil choisi dans la fenêtre de clone (`remotes::ssh_setup_for_url`). Un clone à
//! la fois ; sa progression est lue sur la sortie d'erreur de git (`--progress`) et il peut
//! être annulé (le dossier créé est alors retiré).

use crate::git;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

/// Avancement d'un clone, tel que git l'écrit.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    /// "counting" | "compressing" | "receiving" | "resolving" | "checkout"
    pub phase: &'static str,
    /// Pourcentage de la phase, s'il est donné.
    pub percent: Option<u8>,
}

/// Ligne de progression de git (`Receiving objects:  45% (450/1000), 1.20 MiB | 2 MiB/s`),
/// côté serveur (`remote: Counting objects: …`) comme côté client.
pub fn parse_progress(line: &str) -> Option<Progress> {
    let line = line.strip_prefix("remote:").map(str::trim_start).unwrap_or(line);
    let (label, rest) = line.split_once(':')?;
    let phase = match label {
        "Enumerating objects" | "Counting objects" => "counting",
        "Compressing objects" => "compressing",
        "Receiving objects" => "receiving",
        "Resolving deltas" => "resolving",
        "Updating files" | "Checking out files" => "checkout",
        _ => return None,
    };
    let percent = rest.split_whitespace().next().and_then(|w| w.strip_suffix('%')).and_then(|p| p.parse::<u8>().ok()).map(|p| p.min(100));
    Some(Progress { phase, percent })
}

/// Lignes de git qui ne disent rien d'utile en cas d'erreur (progression, « Cloning into… »).
fn is_noise(line: &str) -> bool {
    parse_progress(line).is_some() || line.starts_with("Cloning into") || line.starts_with("remote: Total") || line.starts_with("Total ")
}

/// Nom de dossier acceptable sous Windows comme sous Linux : non vide, pas `.` ni `..`, sans
/// séparateur ni caractère interdit, sans point ni espace final, pas un nom réservé (`CON`…).
pub fn valid_folder_name(name: &str) -> bool {
    const RESERVED: [&str; 22] = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    let stem = name.split('.').next().unwrap_or(name).trim().to_ascii_uppercase();
    !name.is_empty()
        && name != "."
        && name != ".."
        && name.trim() == name
        && !name.ends_with('.')
        && !name.chars().any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
        && !RESERVED.contains(&stem.as_str())
}

/// Annulation du clone en cours (un seul à la fois).
static RUNNING: Mutex<Option<Arc<AtomicBool>>> = Mutex::new(None);

/// Libère la place du clone en cours à la fin, quelle qu'en soit l'issue.
struct Running;

impl Drop for Running {
    fn drop(&mut self) {
        *RUNNING.lock().unwrap() = None;
    }
}

fn start() -> Result<(Running, Arc<AtomicBool>), String> {
    let mut running = RUNNING.lock().unwrap();
    if running.is_some() {
        return Err("clone_busy".into());
    }
    let flag = Arc::new(AtomicBool::new(false));
    *running = Some(flag.clone());
    Ok((Running, flag))
}

/// Demande l'arrêt du clone en cours (sans effet s'il n'y en a pas).
pub fn cancel() {
    if let Some(flag) = RUNNING.lock().unwrap().as_ref() {
        flag.store(true, Ordering::Relaxed);
    }
}

/// Retire ce que le clone a laissé : le dossier s'il l'a créé, son contenu s'il existait vide.
/// Sous Windows, un fichier peut rester verrouillé un instant après l'arrêt de git.
fn clean_up(dest: &Path, existed: bool) {
    for _ in 0..10 {
        if !dest.exists() || std::fs::remove_dir_all(dest).is_ok() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(200));
    }
    if existed {
        let _ = std::fs::create_dir(dest);
    }
}

/// Erreurs d'un clone : celles d'une commande réseau (authentification, hôte inconnu…), plus
/// la destination déjà occupée.
fn classify(e: String) -> String {
    if e == "cancelled" {
        return "clone_cancelled".into();
    }
    if e.contains("already exists and is not an empty directory") {
        return "clone_dest_exists".into();
    }
    crate::branches::classify(&e)
}

/// Clone `url` dans `parent/name`, avec la clé SSH du profil `profile` (`None` : la
/// configuration ssh habituelle). Renvoie la racine du nouveau dépôt, telle qu'`open_repo` la
/// lit. `on_progress` reçoit l'avancement.
pub fn clone(url: &str, parent: &str, name: &str, profile: Option<&str>, mut on_progress: impl FnMut(Progress) + Send) -> Result<String, String> {
    let url = url.trim();
    crate::remotes::check_url(url)?;
    let parent = PathBuf::from(parent.trim());
    if !parent.is_dir() {
        return Err("path_not_found".into());
    }
    if !valid_folder_name(name) {
        return Err("invalid_folder_name".into());
    }
    let dest = parent.join(name);
    // Un dossier vide est accepté (git aussi l'accepte) ; tout le reste est refusé avant de
    // lancer quoi que ce soit.
    let existed = dest.exists();
    if existed && !(dest.is_dir() && std::fs::read_dir(&dest).is_ok_and(|mut d| d.next().is_none())) {
        return Err("clone_dest_exists".into());
    }
    let (_running, cancel) = start()?;

    let key = profile.and_then(crate::remotes::profile_key);
    let mut env: Vec<(&str, String)> = Vec::new();
    if let Some(ssh) = crate::remotes::ssh_setup_for_url(url, key.as_deref()) {
        env.push(("GIT_SSH_COMMAND", ssh.command));
        env.extend(git::askpass_env(&ssh.keys));
    }
    // En HTTPS : token du compte du profil pour l'instance de l'URL (cf. `credential`).
    let credential = crate::credential::config_args(&crate::remotes::https_account_for_url(url, profile).into_iter().collect::<Vec<_>>());
    let dest_str = dest.to_string_lossy().to_string();
    let mut args: Vec<&str> = credential.iter().map(String::as_str).collect();
    args.extend(["clone", "--progress", "--", url, dest_str.as_str()]);
    let result = git::run_streaming(&args, &env, &cancel, is_noise, |line| {
        if let Some(p) = parse_progress(line) {
            on_progress(p);
        }
    });
    if let Err(e) = result {
        clean_up(&dest, existed);
        return Err(classify(e));
    }
    git::toplevel(&dest).map(|top| top.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::run;
    use crate::git::tests::{commit_file, temp_repo};

    /// Un clone à la fois (`clone_busy`) : les tests qui clonent passent l'un après l'autre.
    static SERIAL: Mutex<()> = Mutex::new(());

    fn serial() -> std::sync::MutexGuard<'static, ()> {
        SERIAL.lock().unwrap_or_else(|e| e.into_inner())
    }

    #[test]
    fn progress_lines_are_read() {
        let p = |phase, percent| Some(Progress { phase, percent });
        assert_eq!(parse_progress("Receiving objects:  45% (450/1000), 1.20 MiB | 2.00 MiB/s"), p("receiving", Some(45)));
        assert_eq!(parse_progress("remote: Counting objects: 100% (12/12), done."), p("counting", Some(100)));
        assert_eq!(parse_progress("remote: Enumerating objects: 1234, done."), p("counting", None));
        assert_eq!(parse_progress("Resolving deltas:   3% (1/30)"), p("resolving", Some(3)));
        assert_eq!(parse_progress("Updating files:  50% (5/10)"), p("checkout", Some(50)));
        assert_eq!(parse_progress("Cloning into 'x'..."), None);
        assert_eq!(parse_progress("fatal: repository 'x' does not exist"), None);
    }

    #[test]
    fn folder_names() {
        for ok in ["depot", "mon-depot.git", ".config", "Été 2026"] {
            assert!(valid_folder_name(ok), "{ok}");
        }
        for bad in ["", ".", "..", "a/b", "a\\b", "a:b", "x.", " x", "x ", "CON", "nul.txt", "a\nb", "a*b"] {
            assert!(!valid_folder_name(bad), "{bad:?}");
        }
    }

    /// Dépôt source avec un commit, et un dossier où cloner.
    fn source() -> (tempfile::TempDir, tempfile::TempDir) {
        let src = temp_repo();
        commit_file(src.path(), "a.txt", "a");
        (src, tempfile::tempdir().unwrap())
    }

    #[test]
    fn clones_a_local_repository() {
        let _serial = serial();
        let (src, parent) = source();
        let mut phases = Vec::new();
        let url = src.path().to_string_lossy().to_string();
        let top = clone(&url, &parent.path().to_string_lossy(), "copie", None, |p| phases.push(p.phase)).unwrap();
        let dest = parent.path().join("copie");
        // La racine renvoyée est celle du nouveau dépôt (écrite comme git l'écrit).
        assert_eq!(std::fs::read_to_string(Path::new(&top).join("a.txt")).unwrap(), "a");
        assert_eq!(std::fs::read_to_string(dest.join("a.txt")).unwrap(), "a");
        assert!(phases.is_empty() || phases.iter().all(|p| ["counting", "compressing", "receiving", "resolving", "checkout"].contains(p)));
        assert_eq!(run(Some(&dest), &["remote", "get-url", "origin"]).unwrap(), url);
        // Le même dossier une seconde fois : refusé avant de lancer git.
        assert_eq!(clone(&url, &parent.path().to_string_lossy(), "copie", None, |_| {}).unwrap_err(), "clone_dest_exists");
        // Un dossier vide existant est accepté.
        std::fs::create_dir(parent.path().join("vide")).unwrap();
        clone(&url, &parent.path().to_string_lossy(), "vide", None, |_| {}).unwrap();
        assert!(parent.path().join("vide/a.txt").is_file());
    }

    #[test]
    fn bad_inputs_are_refused() {
        let (src, parent) = source();
        let url = src.path().to_string_lossy().to_string();
        let dir = parent.path().to_string_lossy().to_string();
        assert_eq!(clone("--upload-pack=x", &dir, "x", None, |_| {}).unwrap_err(), "invalid_remote_url");
        assert_eq!(clone(&url, &format!("{dir}/absent"), "x", None, |_| {}).unwrap_err(), "path_not_found");
        assert_eq!(clone(&url, &dir, "a/b", None, |_| {}).unwrap_err(), "invalid_folder_name");
        std::fs::write(parent.path().join("fichier"), "x").unwrap();
        assert_eq!(clone(&url, &dir, "fichier", None, |_| {}).unwrap_err(), "clone_dest_exists");
    }

    #[test]
    fn failed_clone_leaves_nothing() {
        let _serial = serial();
        let parent = tempfile::tempdir().unwrap();
        let dir = parent.path().to_string_lossy().to_string();
        let missing = parent.path().join("pas-de-depot").to_string_lossy().to_string();
        let e = clone(&missing, &dir, "x", None, |_| {}).unwrap_err();
        assert_eq!(e, "remote_not_found", "{e}");
        assert!(!parent.path().join("x").exists());
        // Dossier vide fourni : il reste, vide.
        std::fs::create_dir(parent.path().join("vide")).unwrap();
        clone(&missing, &dir, "vide", None, |_| {}).unwrap_err();
        assert!(parent.path().join("vide").is_dir());
    }

    #[test]
    fn cancelled_clone_is_cleaned_up() {
        let _serial = serial();
        let (src, parent) = source();
        let url = src.path().to_string_lossy().to_string();
        let dir = parent.path().to_string_lossy().to_string();
        // L'annulation arrive dès la première ligne de git (`Cloning into…` n'est pas de la
        // progression : on annule à la première ligne quelle qu'elle soit). Un dépôt local se
        // clone parfois avant : on accepte les deux issues, mais jamais un dossier à moitié.
        let result = clone(&url, &dir, "x", None, |_| cancel());
        match result {
            Err(e) => {
                assert_eq!(e, "clone_cancelled");
                assert!(!parent.path().join("x").exists());
            }
            Ok(_) => assert!(parent.path().join("x/a.txt").is_file()),
        }
        // Le clone suivant peut partir.
        clone(&url, &dir, "y", None, |_| {}).unwrap();
    }
}
