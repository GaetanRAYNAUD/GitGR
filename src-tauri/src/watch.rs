//! Surveillance du dépôt actif : prévient l'interface (événement `repo-changed`) quand un
//! fichier suivi change ou que git bouge quelque chose (commit, checkout, fetch…), y compris
//! depuis un terminal ou un autre outil, sans attendre le retour du focus.
//!
//! Deux façons de surveiller, selon le système :
//! - **récursive** (Windows, macOS) : une seule veille sur la racine, bon marché ; les
//!   événements des dossiers ignorés arrivent mais sont écartés au tri.
//! - **dossier par dossier** (Linux) : inotify coûte une veille *par dossier*, limitée par
//!   `fs.inotify.max_user_watches` ; un gros `node_modules` ou `target` suffirait à l'épuiser.
//!   On ne surveille donc que les dossiers non ignorés (`git ls-files --ignored --directory`),
//!   sans `.git/objects`, et on ajoute à la volée les dossiers créés ensuite.
//!
//! **Worktree lié** : git y a deux dossiers — le sien (`<principal>/.git/worktrees/<nom>` :
//! HEAD, index…) et le dossier commun (`<principal>/.git` : refs, `packed-refs`, config). Les
//! deux sont surveillés, mais du dossier commun seules les refs et la config comptent : l'index
//! et le HEAD du dépôt principal ou des autres worktrees bougent sans rien changer ici.
//!
//! Les événements sont regroupés (`DEBOUNCE`) puis triés : objets, verrous et fichiers du
//! démon fsmonitor de `.git`, fichiers ignorés (`git check-ignore`) ne déclenchent rien.

use crate::git;
use notify::event::{AccessKind, AccessMode};
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex, Weak};
use std::time::{Duration, Instant};

/// Calme à attendre avant de traiter un lot d'événements.
const DEBOUNCE: Duration = Duration::from_millis(400);
/// Au plus ce délai entre le premier événement d'un lot et son traitement (écritures continues).
const MAX_WAIT: Duration = Duration::from_secs(2);
/// Au-delà, on ne vérifie pas chaque chemin : autant rafraîchir.
const MAX_CHECKED: usize = 500;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Mode {
    Recursive,
    PerDirectory,
}

/// Mode adapté au système (cf. en-tête du module).
pub const DEFAULT_MODE: Mode = if cfg!(target_os = "linux") { Mode::PerDirectory } else { Mode::Recursive };

/// Dépôt surveillé (un seul à la fois : l'onglet actif).
#[derive(Default)]
pub struct RepoWatcher {
    /// Chemin du dépôt et sa veille. Détruire la veille ferme le canal d'événements, ce qui
    /// arrête le fil de traitement (il ne la tient que par une référence faible).
    current: Option<(String, Arc<Mutex<RecommendedWatcher>>)>,
}

impl RepoWatcher {
    /// Surveille `path` (et arrête l'ancien) ; `None` arrête tout. Sans effet si déjà en place.
    /// `notify` est appelé (depuis un autre fil) avec le chemin du dépôt à chaque changement utile.
    pub fn watch(&mut self, path: Option<String>, notify: impl Fn(&str) + Send + 'static) -> Result<(), String> {
        self.watch_with(path, DEFAULT_MODE, notify)
    }

    pub fn watch_with(
        &mut self,
        path: Option<String>,
        mode: Mode,
        notify: impl Fn(&str) + Send + 'static,
    ) -> Result<(), String> {
        if self.current.as_ref().map(|(p, _)| p) == path.as_ref() {
            return Ok(());
        }
        self.current = None;
        let Some(path) = path else { return Ok(()) };

        let root = PathBuf::from(&path);
        let git_dir = PathBuf::from(git::run(Some(&root), &["rev-parse", "--absolute-git-dir"])?);
        // Dossier commun : le même hors worktree lié (ou si git est trop ancien pour le donner
        // en absolu : on surveille alors comme avant).
        let common_dir = git::run(Some(&root), &["rev-parse", "--path-format=absolute", "--git-common-dir"])
            .map(PathBuf::from)
            .unwrap_or_else(|_| git_dir.clone());
        let (tx, rx) = mpsc::channel();
        let watcher = Arc::new(Mutex::new(notify::recommended_watcher(tx).map_err(|e| e.to_string())?));
        let mut tree = Tree { root, git_dir, common_dir, mode, watched: HashSet::new() };
        {
            let mut w = watcher.lock().unwrap();
            match mode {
                Mode::Recursive => {
                    // Worktree lié ou `.git` déplacé : les dossiers git ne sont pas sous la racine
                    // (et celui d'un worktree lié est dans le dossier commun).
                    let mut covered = vec![&tree.root];
                    for dir in [&tree.common_dir, &tree.git_dir] {
                        if !covered.iter().any(|c| dir.starts_with(c)) {
                            covered.push(dir);
                        }
                    }
                    for dir in covered {
                        w.watch(dir, RecursiveMode::Recursive).map_err(|e| e.to_string())?;
                    }
                }
                Mode::PerDirectory => {
                    let ignored = ignored_dirs(&tree.root);
                    let mut dirs = tree.dirs_under(&tree.root, &ignored);
                    dirs.extend(tree.git_dirs(&tree.git_dir));
                    if tree.linked() {
                        // Du dossier commun : lui-même (`packed-refs`, `config`) et ses refs.
                        dirs.push(tree.common_dir.clone());
                        dirs.extend(tree.git_dirs(&tree.common_dir.join("refs")));
                    }
                    // Une veille refusée (limite inotify atteinte) : on garde celles qui ont
                    // été acceptées plutôt que de ne rien surveiller du tout.
                    if let Err(e) = tree.add_all(&mut w, dirs) {
                        eprintln!("surveillance partielle de {path} : {e}");
                    }
                }
            }
        }
        let weak = Arc::downgrade(&watcher);
        let repo = path.clone();
        std::thread::spawn(move || process(rx, weak, tree, move || notify(&repo)));
        self.current = Some((path, watcher));
        Ok(())
    }
}

/// Fil de traitement : regroupe les événements, ajoute les nouveaux dossiers (mode par
/// dossier), et prévient si le lot change ce qu'on affiche. S'arrête quand la veille est détruite.
fn process(rx: Receiver<notify::Result<Event>>, watcher: Weak<Mutex<RecommendedWatcher>>, mut tree: Tree, notify: impl Fn()) {
    while let Ok(first) = rx.recv() {
        let mut batch = vec![first];
        let start = Instant::now();
        loop {
            match rx.recv_timeout(DEBOUNCE) {
                Ok(e) => {
                    batch.push(e);
                    if start.elapsed() > MAX_WAIT {
                        break;
                    }
                }
                Err(RecvTimeoutError::Timeout) => break,
                Err(RecvTimeoutError::Disconnected) => return,
            }
        }
        // Erreur ou file débordée (gros checkout…) : des changements ont pu être perdus,
        // on rafraîchit plutôt que d'afficher un état périmé.
        let mut lost = false;
        let mut paths = Vec::new();
        for res in batch {
            match res {
                Ok(e) => {
                    lost |= e.need_rescan();
                    if changes_content(&e.kind) {
                        paths.extend(e.paths);
                    }
                }
                Err(_) => lost = true,
            }
        }
        if tree.mode == Mode::PerDirectory {
            let Some(w) = watcher.upgrade() else { return };
            let mut w = w.lock().unwrap();
            // Une veille refusée (limite inotify atteinte) : on garde les autres, et on rafraîchit.
            lost |= tree.track_new_dirs(&mut w, &paths).is_err();
        }
        if lost || tree.relevant(&paths) {
            notify();
        }
    }
}

/// Dossiers surveillés en mode par dossier.
struct Tree {
    root: PathBuf,
    /// Dossier git de cette copie de travail (HEAD, index…).
    git_dir: PathBuf,
    /// Dossier git commun (refs, config) : différent de `git_dir` dans un worktree lié.
    common_dir: PathBuf,
    mode: Mode,
    watched: HashSet<PathBuf>,
}

impl Tree {
    /// Worktree lié : son dossier git n'est pas le dossier commun.
    fn linked(&self) -> bool {
        self.git_dir != self.common_dir
    }

    /// `p` est dans un dossier git : ce changement compte-t-il ? `None` : pas un chemin de git.
    fn git_event(&self, p: &Path) -> Option<bool> {
        if !self.linked() {
            return p.strip_prefix(&self.git_dir).ok().map(git_change);
        }
        // Le dossier du worktree d'abord : il est dans le dossier commun.
        if let Ok(inside) = p.strip_prefix(&self.git_dir) {
            return Some(git_change(inside));
        }
        p.strip_prefix(&self.common_dir).ok().map(shared_change)
    }

    /// Ce lot de chemins modifiés change-t-il ce qu'on affiche ?
    fn relevant(&self, paths: &[PathBuf]) -> bool {
        let mut work: Vec<String> = Vec::new();
        for p in paths {
            if let Some(counts) = self.git_event(p) {
                if counts {
                    return true;
                }
            } else if p.starts_with(&self.root) {
                let rel = rel_path(&self.root, p);
                if !rel.is_empty() {
                    work.push(rel);
                }
            }
        }
        if work.is_empty() {
            return false;
        }
        if work.len() > MAX_CHECKED {
            return true;
        }
        any_not_ignored(&self.root, &work)
    }

    /// Surveille ces dossiers (non récursivement) ; continue après un refus, renvoie le premier.
    fn add_all(&mut self, w: &mut RecommendedWatcher, dirs: Vec<PathBuf>) -> Result<(), String> {
        let mut first_err = None;
        for d in dirs {
            if self.watched.contains(&d) {
                continue;
            }
            match w.watch(&d, RecursiveMode::NonRecursive) {
                Ok(()) => {
                    self.watched.insert(d);
                }
                // Dossier disparu entre-temps : rien à surveiller.
                Err(_) if !d.exists() => {}
                Err(e) => {
                    first_err.get_or_insert(e.to_string());
                }
            }
        }
        first_err.map_or(Ok(()), Err)
    }

    /// Après un lot : surveille les dossiers apparus, oublie ceux qui ont disparu.
    /// Seuls les chemins du lot sont examinés (un dossier supprimé y figure).
    fn track_new_dirs(&mut self, w: &mut RecommendedWatcher, paths: &[PathBuf]) -> Result<(), String> {
        let mut ignored: Option<HashSet<String>> = None; // lu une fois par lot, au besoin
        let mut new = Vec::new();
        for p in paths {
            let Ok(meta) = fs::symlink_metadata(p) else {
                // Disparu : lui et ses sous-dossiers ne sont plus surveillés.
                if self.watched.contains(p) {
                    self.watched.retain(|d| !d.starts_with(p));
                }
                continue;
            };
            if !meta.is_dir() || self.watched.contains(p) {
                continue;
            }
            if let Ok(inside) = p.strip_prefix(&self.git_dir) {
                if !skipped_in_git_dir(inside) {
                    new.extend(self.git_dirs(p));
                }
            } else if self.linked() && p.starts_with(self.common_dir.join("refs")) {
                // Branche rangée dans un nouveau dossier (`refs/heads/feature/`).
                new.extend(self.git_dirs(p));
            } else if let Ok(rel) = p.strip_prefix(&self.root) {
                if !has_dot_git(rel) {
                    let ignored = ignored.get_or_insert_with(|| ignored_dirs(&self.root));
                    new.extend(self.dirs_under(p, ignored));
                }
            }
        }
        self.add_all(w, new)
    }

    /// `dir` et ses sous-dossiers, sans les dossiers ignorés par git (`ignored`, cf.
    /// `ignored_dirs`) ni les `.git`. Rien si `dir` est lui-même dans un dossier ignoré.
    fn dirs_under(&self, dir: &Path, ignored: &HashSet<String>) -> Vec<PathBuf> {
        let rel = rel_path(&self.root, dir);
        let mut out = Vec::new();
        if is_ignored(ignored, &rel) {
            return out;
        }
        let skip = |p: &Path| {
            p == self.git_dir || p.file_name().is_some_and(|n| n == ".git") || ignored.contains(&rel_path(&self.root, p))
        };
        walk(dir, &mut out, &skip);
        out
    }

    /// `dir` (dans le dossier git) et ses sous-dossiers, sans les objets ni fsmonitor.
    fn git_dirs(&self, dir: &Path) -> Vec<PathBuf> {
        let mut out = Vec::new();
        walk(dir, &mut out, &|p| p.strip_prefix(&self.git_dir).is_ok_and(skipped_in_git_dir));
        out
    }
}

/// Ajoute `dir` puis ses sous-dossiers (liens symboliques non suivis), sauf ceux que `skip` écarte.
fn walk(dir: &Path, out: &mut Vec<PathBuf>, skip: &dyn Fn(&Path) -> bool) {
    out.push(dir.to_path_buf());
    let Ok(entries) = fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        if e.file_type().is_ok_and(|t| t.is_dir()) {
            let p = e.path();
            if !skip(&p) {
                walk(&p, out, skip);
            }
        }
    }
}

/// Chemin relatif à la racine, avec des `/` (comme git), vide pour la racine.
fn rel_path(root: &Path, p: &Path) -> String {
    p.strip_prefix(root).map(|r| r.to_string_lossy().replace('\\', "/")).unwrap_or_default()
}

fn has_dot_git(rel: &Path) -> bool {
    rel.components().any(|c| c.as_os_str() == ".git")
}

/// `rel` est-il un dossier ignoré, ou dans un dossier ignoré ?
fn is_ignored(ignored: &HashSet<String>, rel: &str) -> bool {
    !rel.is_empty() && (ignored.contains(rel) || rel.match_indices('/').any(|(i, _)| ignored.contains(&rel[..i])))
}

/// Dossiers ignorés du dépôt, relatifs à la racine, sans `/` final. Un dossier entièrement
/// ignoré est donné seul (`--directory`), pas son contenu : la commande reste rapide.
fn ignored_dirs(root: &Path) -> HashSet<String> {
    let args = ["ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--directory"];
    git::run_raw(Some(root), &args)
        .unwrap_or_default()
        .split('\0')
        .filter_map(|e| e.strip_suffix('/'))
        .map(str::to_string)
        .collect()
}

/// Sous-dossiers du dossier git qui ne nous intéressent pas (cf. `git_change`).
fn skipped_in_git_dir(inside: &Path) -> bool {
    inside.components().any(|c| matches!(c.as_os_str().to_str(), Some("objects" | "fsmonitor--daemon")))
}


/// L'événement peut changer ce qu'on affiche. Une simple lecture (ouverture, fermeture
/// sans écriture) ne compte pas : inotify (Linux) les signale, et nos propres commandes git
/// lisent l'index, la config… — sinon chaque rafraîchissement en déclencherait un autre.
fn changes_content(kind: &EventKind) -> bool {
    match kind {
        EventKind::Access(AccessKind::Close(AccessMode::Write)) => true,
        EventKind::Access(_) => false,
        _ => true,
    }
}

/// Changement dans le dossier git qui compte : refs, HEAD, index, journal… mais pas les
/// objets (écrits avant les refs, qui suivront), les verrous temporaires, ni les fichiers du
/// démon fsmonitor : il en écrit à chaque `git status`, ce qui relancerait un rafraîchissement
/// sans fin.
fn git_change(inside: &Path) -> bool {
    !skipped_in_git_dir(inside) && !inside.extension().is_some_and(|e| e == "lock")
}

/// Changement dans le dossier commun, vu d'un worktree lié : seules les refs (`refs/…`,
/// `packed-refs`) et la config comptent. Le reste (HEAD, index, journal du dépôt principal,
/// dossiers des autres worktrees) ne change rien à ce qu'on affiche ici.
fn shared_change(inside: &Path) -> bool {
    let shared = inside.starts_with("refs") || inside == Path::new("packed-refs") || inside == Path::new("config");
    shared && git_change(inside)
}

/// Au moins un de ces chemins (relatifs à la racine) n'est pas ignoré par git.
/// Un fichier suivi dans un dossier ignoré compte (`check-ignore` regarde aussi l'index).
fn any_not_ignored(root: &Path, paths: &[String]) -> bool {
    let input = paths.join("\0") + "\0";
    match git::run_input(Some(root), &["check-ignore", "-z", "--stdin"], &input) {
        // Sortie : les chemins ignorés, séparés par des NUL.
        Ok(out) => out.split('\0').filter(|s| !s.is_empty()).count() < paths.len(),
        // Code 1 sans sortie : aucun n'est ignoré. Toute autre erreur : on rafraîchit par prudence.
        Err(_) => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::tests::{commit_file, temp_repo};

    #[test]
    fn reads_are_not_changes() {
        use notify::event::{CreateKind, ModifyKind};
        assert!(!changes_content(&EventKind::Access(AccessKind::Open(AccessMode::Any))));
        assert!(!changes_content(&EventKind::Access(AccessKind::Close(AccessMode::Read))));
        assert!(changes_content(&EventKind::Access(AccessKind::Close(AccessMode::Write))));
        assert!(changes_content(&EventKind::Create(CreateKind::File)));
        assert!(changes_content(&EventKind::Modify(ModifyKind::Any)));
        assert!(changes_content(&EventKind::Any));
    }

    #[test]
    fn git_dir_changes() {
        assert!(git_change(Path::new("HEAD")));
        assert!(git_change(Path::new("index")));
        assert!(git_change(Path::new("refs/heads/main")));
        assert!(!git_change(Path::new("objects/ab/cdef")));
        assert!(!git_change(Path::new("modules/sub/objects/ab/cdef")));
        assert!(!git_change(Path::new("index.lock")));
        assert!(!git_change(Path::new("refs/heads/main.lock")));
        assert!(!git_change(Path::new("fsmonitor--daemon/cookies/1234-1")));
    }

    #[test]
    fn ignored_files_do_not_count() {
        let dir = temp_repo();
        let root = dir.path();
        fs::write(root.join(".gitignore"), "target/\n").unwrap();
        let git_dir = root.join(".git");
        let tree = Tree { root: root.to_path_buf(), git_dir: git_dir.clone(), common_dir: git_dir, mode: DEFAULT_MODE, watched: HashSet::new() };
        let p = |s: &str| root.join(s);
        assert!(!tree.relevant(&[p("target/debug/x.o"), p("target/y")]));
        assert!(tree.relevant(&[p("target/y"), p("src/main.rs")]));
        assert!(tree.relevant(&[p(".git/refs/heads/main")]));
        assert!(!tree.relevant(&[p(".git/objects/ab/cd"), p(".git/index.lock")]));
        assert!(!tree.relevant(&[root.to_path_buf()]));
    }

    #[test]
    fn linked_worktree_sorts_shared_git_dir_changes() {
        let common = PathBuf::from("/depot/.git");
        let tree = Tree {
            root: PathBuf::from("/ailleurs/wt"),
            git_dir: common.join("worktrees/wt"),
            common_dir: common.clone(),
            mode: DEFAULT_MODE,
            watched: HashSet::new(),
        };
        let p = |s: &str| common.join(s);
        // Son propre dossier git : comme un dépôt ordinaire.
        assert_eq!(tree.git_event(&p("worktrees/wt/HEAD")), Some(true));
        assert_eq!(tree.git_event(&p("worktrees/wt/index.lock")), Some(false));
        // Dossier commun : les refs et la config, rien d'autre.
        assert_eq!(tree.git_event(&p("refs/heads/nouvelle")), Some(true));
        assert_eq!(tree.git_event(&p("refs/remotes/origin/main")), Some(true));
        assert_eq!(tree.git_event(&p("packed-refs")), Some(true));
        assert_eq!(tree.git_event(&p("config")), Some(true));
        assert_eq!(tree.git_event(&p("refs/heads/nouvelle.lock")), Some(false));
        assert_eq!(tree.git_event(&p("index")), Some(false), "index du dépôt principal");
        assert_eq!(tree.git_event(&p("HEAD")), Some(false));
        assert_eq!(tree.git_event(&p("worktrees/autre/index")), Some(false), "autre worktree");
        assert_eq!(tree.git_event(&p("objects/ab/cd")), Some(false));
        assert_eq!(tree.git_event(Path::new("/ailleurs/wt/a.txt")), None);
    }

    #[test]
    fn per_directory_mode_skips_ignored_dirs_and_objects() {
        let dir = temp_repo();
        let root = dir.path().to_path_buf();
        fs::write(root.join(".gitignore"), "node_modules/\n").unwrap();
        for d in ["src/ui", "node_modules/a/b", "vendor/.git/refs"] {
            fs::create_dir_all(root.join(d)).unwrap();
        }
        let git_dir = PathBuf::from(git::run(Some(&root), &["rev-parse", "--absolute-git-dir"]).unwrap());
        let tree = Tree { root: root.clone(), git_dir: git_dir.clone(), common_dir: git_dir.clone(), mode: Mode::PerDirectory, watched: HashSet::new() };
        let rels = |v: Vec<PathBuf>, base: &Path| -> Vec<String> {
            let mut r: Vec<String> = v.iter().map(|p| rel_path(base, p)).collect();
            r.sort();
            r
        };
        let ignored = ignored_dirs(&root);
        assert_eq!(rels(tree.dirs_under(&root, &ignored), &root), ["", "src", "src/ui", "vendor"]);
        assert!(tree.dirs_under(&root.join("node_modules"), &ignored).is_empty(), "dossier ignoré");
        assert!(tree.dirs_under(&root.join("node_modules/a"), &ignored).is_empty(), "dans un dossier ignoré");
        let g = rels(tree.git_dirs(&git_dir), &git_dir);
        assert!(g.contains(&"refs/heads".to_string()));
        assert!(!g.iter().any(|d| d.starts_with("objects")));
    }

    /// Une notification arrive-t-elle dans le délai ?
    fn notified(rx: &Receiver<String>, wait_ms: u64) -> bool {
        rx.recv_timeout(Duration::from_millis(wait_ms)).is_ok()
    }

    /// Laisse passer les événements en cours et les oublie.
    fn drain(rx: &Receiver<String>) {
        std::thread::sleep(Duration::from_millis(900));
        while rx.try_recv().is_ok() {}
    }

    fn check_mode(mode: Mode) {
        let dir = temp_repo();
        let root = dir.path();
        fs::write(root.join(".gitignore"), "target/\n").unwrap();
        commit_file(root, "a.txt", "1");
        fs::create_dir(root.join("target")).unwrap();
        let (tx, rx) = mpsc::channel();
        let mut w = RepoWatcher::default();
        let path = root.to_string_lossy().to_string();
        w.watch_with(Some(path.clone()), mode, move |p| tx.send(p.to_string()).unwrap()).unwrap();
        drain(&rx);

        fs::write(root.join("target/out.o"), "x").unwrap();
        assert!(!notified(&rx, 1200), "{mode:?} : fichier ignoré, pas de notification");

        fs::write(root.join("a.txt"), "2").unwrap();
        assert_eq!(rx.recv_timeout(Duration::from_secs(5)).unwrap(), path);

        // Dossier créé après le début : surveillé à son tour.
        fs::create_dir(root.join("new")).unwrap();
        drain(&rx);
        fs::write(root.join("new/b.txt"), "x").unwrap();
        assert!(notified(&rx, 5000), "{mode:?} : fichier dans un dossier créé ensuite");

        // Branche rangée dans un dossier : refs/heads/feature/ est nouveau.
        drain(&rx);
        git::run(Some(root), &["branch", "feature/x"]).unwrap();
        assert!(notified(&rx, 5000), "{mode:?} : nouvelle branche");
        commit_file(root, "c.txt", "1");
        drain(&rx);
        git::run(Some(root), &["update-ref", "refs/heads/feature/x", "HEAD"]).unwrap();
        assert!(notified(&rx, 5000), "{mode:?} : ref dans un dossier créé ensuite");

        // Arrêt : plus rien.
        w.watch_with(None, mode, |_| {}).unwrap();
        while rx.try_recv().is_ok() {}
        fs::write(root.join("d.txt"), "x").unwrap();
        assert!(!notified(&rx, 1200), "{mode:?} : arrêté");
    }

    /// Worktree lié : ce qui bouge dans le dépôt principal n'y compte que si ce sont des refs.
    fn check_linked_worktree(mode: Mode) {
        let main = temp_repo();
        commit_file(main.path(), "a.txt", "1");
        let holder = tempfile::tempdir().unwrap();
        let wt = holder.path().join("wt");
        git::run(Some(main.path()), &["worktree", "add", "-q", "-b", "liee", &wt.to_string_lossy()]).unwrap();
        let (tx, rx) = mpsc::channel();
        let mut w = RepoWatcher::default();
        let path = wt.to_string_lossy().to_string();
        w.watch_with(Some(path.clone()), mode, move |p| tx.send(p.to_string()).unwrap()).unwrap();
        drain(&rx);

        // Branche créée depuis le dépôt principal, puis dans un nouveau dossier de refs.
        git::run(Some(main.path()), &["branch", "nouvelle"]).unwrap();
        assert_eq!(rx.recv_timeout(Duration::from_secs(5)).unwrap(), path, "{mode:?} : branche créée ailleurs");
        drain(&rx);
        git::run(Some(main.path()), &["branch", "feature/x"]).unwrap();
        assert!(notified(&rx, 5000), "{mode:?} : branche dans un nouveau dossier");
        drain(&rx);
        // L'index du dépôt principal ne change rien à ce worktree.
        fs::write(main.path().join("b.txt"), "x").unwrap();
        git::run(Some(main.path()), &["add", "b.txt"]).unwrap();
        assert!(!notified(&rx, 1200), "{mode:?} : index du dépôt principal");

        // Ses propres changements : comme un dépôt ordinaire.
        commit_file(&wt, "c.txt", "1");
        assert!(notified(&rx, 5000), "{mode:?} : commit dans le worktree");

        w.watch_with(None, mode, |_| {}).unwrap();
        // Le worktree est retiré avant ses dossiers temporaires (veilles fermées).
        let _ = git::run(Some(main.path()), &["worktree", "remove", "--force", &path]);
    }

    #[test]
    fn recursive_mode_follows_a_linked_worktree() {
        check_linked_worktree(Mode::Recursive);
    }

    #[test]
    fn per_directory_mode_follows_a_linked_worktree() {
        check_linked_worktree(Mode::PerDirectory);
    }

    #[test]
    fn recursive_mode_notifies() {
        check_mode(Mode::Recursive);
    }

    #[test]
    fn per_directory_mode_notifies() {
        check_mode(Mode::PerDirectory);
    }
}
