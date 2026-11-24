//! Lecture de l'historique : commits (pour le graphe), refs, détails d'un commit et diff.
//!
//! Tout passe par le binaire `git` (cf. `git::run`) avec des sorties séparées par des
//! caractères de contrôle (`-z`, `%x1f`), jamais par des espaces : les messages et les
//! chemins peuvent contenir n'importe quoi d'autre.

use crate::git::{run, run_raw};
use serde::Serialize;
use std::path::Path;

/// Arbre vide de Git : sert de « parent » pour le diff d'un commit racine.
const EMPTY_TREE: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
/// Au-delà, le diff d'un fichier est tronqué (l'interface le signale).
const MAX_DIFF_LINES: usize = 20_000;

/// Refuse tout ce qui n'est pas un SHA (abrégé ou complet) : évite qu'une valeur
/// commençant par `-` soit prise pour une option de git.
pub(crate) fn check_sha(sha: &str) -> Result<(), String> {
    if (4..=64).contains(&sha.len()) && sha.chars().all(|c| c.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err("invalid_sha".into())
    }
}

pub(crate) fn check_dir(path: &Path) -> Result<(), String> {
    if path.is_dir() { Ok(()) } else { Err("path_not_found".into()) }
}

// ---------------------------------------------------------------------------
// Log
// ---------------------------------------------------------------------------

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    pub sha: String,
    pub parents: Vec<String>,
    pub author: String,
    pub email: String,
    /// Date d'auteur, en secondes depuis l'epoch Unix.
    pub time: i64,
    pub subject: String,
}

const LOG_FORMAT: &str = "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%s";

/// Une page de l'historique de toutes les refs (hors stash et notes, qui ne sont pas de
/// l'historique ; `--exclude` doit précéder `--all`), du plus récent au plus ancien.
/// `--date-order` garantit qu'un commit apparaît toujours avant ses parents, ce dont le
/// calcul des lanes a besoin.
pub fn log(path: &Path, skip: u32, limit: u32) -> Result<Vec<Commit>, String> {
    check_dir(path)?;
    let skip = format!("--skip={skip}");
    let limit = format!("--max-count={limit}");
    let out = run(
        Some(path),
        &["log", "--exclude=refs/stash", "--exclude=refs/notes/*", "--all", "--date-order", "-z", LOG_FORMAT, &skip, &limit],
    );
    // Dépôt sans aucun commit : `--all` ne trouve aucune ref, la sortie est simplement vide.
    Ok(parse_log(&out?))
}

fn parse_log(out: &str) -> Vec<Commit> {
    out.split('\0')
        .filter_map(|rec| {
            let rec = rec.trim_start_matches('\n');
            if rec.is_empty() {
                return None;
            }
            let mut f = rec.splitn(6, '\x1f');
            let sha = f.next()?.to_string();
            let parents = f.next()?.split_whitespace().map(str::to_string).collect();
            let author = f.next()?.to_string();
            let email = f.next()?.to_string();
            let time = f.next()?.parse().unwrap_or(0);
            let subject = f.next().unwrap_or("").to_string();
            Some(Commit { sha, parents, author, email, time, subject })
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Recherche dans les modifications
// ---------------------------------------------------------------------------

const SEARCH_LIMIT: u32 = 200;

/// Commits (de toutes les branches) qui ajoutent ou retirent `text` : `git log -S` (nombre
/// d'occurrences qui change), ou `-G` si `regex` (lignes modifiées qui correspondent à
/// l'expression). `file` : limité à ce chemin (fichier ou dossier), suivi littéralement.
pub fn search_changes(path: &Path, text: &str, regex: bool, file: Option<&str>) -> Result<Vec<Commit>, String> {
    check_dir(path)?;
    if text.is_empty() {
        return Err("search_empty".into());
    }
    let pickaxe = format!("{}{text}", if regex { "-G" } else { "-S" });
    let limit = format!("--max-count={SEARCH_LIMIT}");
    let mut args = vec!["--literal-pathspecs", "log", "--exclude=refs/stash", "--exclude=refs/notes/*", "--all", "--date-order", "-z", LOG_FORMAT, &limit, &pickaxe, "--"];
    if let Some(f) = file.filter(|f| !f.is_empty()) {
        args.push(f);
    }
    match run(Some(path), &args) {
        Ok(out) => Ok(parse_log(&out)),
        Err(e) if regex && (e.contains("Invalid regular expression") || e.contains("invalid regex") || e.contains("regcomp")) => Err("search_bad_regex".into()),
        // Dépôt sans commit : rien à chercher.
        Err(e) if e.contains("does not have any commits") || e.contains("bad default revision") => Ok(vec![]),
        Err(e) => Err(e),
    }
}

// ---------------------------------------------------------------------------
// Historique d'un fichier
// ---------------------------------------------------------------------------

const FILE_HISTORY_LIMIT: u32 = 500;

/// Un commit qui touche le fichier, avec ce qu'il lui a fait (chemin à ce commit, ancien
/// chemin s'il a été renommé).
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileHistoryEntry {
    pub commit: Commit,
    pub change: FileChange,
}

/// Commits de la branche courante (HEAD) qui modifient `file`, du plus récent au plus ancien,
/// en suivant ses renommages (`--follow`). Les fusions qui ne le changent pas sont omises.
pub fn file_history(path: &Path, file: &str) -> Result<Vec<FileHistoryEntry>, String> {
    check_dir(path)?;
    if file.is_empty() {
        return Err("path_not_found".into());
    }
    let limit = format!("--max-count={FILE_HISTORY_LIMIT}");
    let format = format!("--format=%x1e{}", &LOG_FORMAT["--format=".len()..]);
    let args = ["--literal-pathspecs", "log", "--follow", "-M", "-z", "--name-status", "--no-ext-diff", &format, &limit, "HEAD", "--", file];
    match run_raw(Some(path), &args) {
        Ok(out) => Ok(parse_file_history(&out)),
        // Dépôt sans commit : pas encore d'historique.
        Err(e) if e.contains("does not have any commits") || e.contains("bad default revision") || e.contains("unknown revision") => Ok(vec![]),
        Err(e) => Err(e),
    }
}

/// Sortie de `log -z --name-status` avec un `\x1e` en tête de chaque commit : l'en-tête
/// (champs de `LOG_FORMAT`) jusqu'au premier `\0`, puis ses fichiers.
fn parse_file_history(out: &str) -> Vec<FileHistoryEntry> {
    out.split('\x1e')
        .filter_map(|rec| {
            let (head, files) = rec.split_once('\0')?;
            let commit = parse_log(head).into_iter().next()?;
            let change = parse_name_status(files.trim_start_matches('\n')).into_iter().next()?;
            Some(FileHistoryEntry { commit, change })
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Blame
// ---------------------------------------------------------------------------

/// Commit d'origine d'au moins une ligne du blame.
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BlameCommit {
    /// Que des zéros pour les lignes pas encore commitées (copie de travail).
    pub sha: String,
    pub author: String,
    pub email: String,
    pub time: i64,
    pub summary: String,
    /// Chemin du fichier dans ce commit (différent après un renommage).
    pub filename: String,
    /// Commit d'avant qui avait ces lignes, et le chemin du fichier là-bas (`previous` de
    /// `git blame --porcelain`) ; absent pour le commit qui a créé le fichier.
    pub previous: Option<BlamePrevious>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BlamePrevious {
    pub sha: String,
    pub filename: String,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BlameLine {
    pub sha: String,
    /// Numéro de la ligne dans le commit d'origine.
    pub orig: u32,
    pub text: String,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Blame {
    /// Chaque commit une fois, dans l'ordre de leur première ligne.
    pub commits: Vec<BlameCommit>,
    pub lines: Vec<BlameLine>,
    /// Plus de `MAX_DIFF_LINES` lignes : la suite n'est pas montrée.
    pub truncated: bool,
}

/// Origine de chaque ligne de `file` : au commit `rev`, ou dans la copie de travail (`None`,
/// lignes pas encore commitées comprises). `git blame --porcelain`.
pub fn blame(path: &Path, file: &str, rev: Option<&str>) -> Result<Blame, String> {
    check_dir(path)?;
    if file.is_empty() {
        return Err("path_not_found".into());
    }
    let mut args = vec!["--literal-pathspecs", "blame", "--porcelain"];
    if let Some(rev) = rev {
        check_sha(rev)?;
        args.push(rev);
    }
    args.extend(["--", file]);
    let out = run_raw(Some(path), &args).map_err(|e| {
        // Absent au commit, non suivi, ou supprimé de la copie de travail (« Cannot lstat »).
        let missing = ["no such path", "no such ref", "does not have any commits", "Cannot lstat"];
        if missing.iter().any(|m| e.contains(m)) { "blame_no_file".to_string() } else { e }
    })?;
    Ok(parse_blame(&out))
}

fn parse_blame(out: &str) -> Blame {
    let mut commits: Vec<BlameCommit> = vec![];
    let mut lines = vec![];
    let mut truncated = false;
    let mut current: Option<(String, u32)> = None;
    for line in out.split('\n') {
        if let Some(text) = line.strip_prefix('\t') {
            let Some((sha, orig)) = current.take() else { continue };
            if lines.len() >= MAX_DIFF_LINES {
                truncated = true;
                break;
            }
            lines.push(BlameLine { sha, orig, text: text.trim_end_matches('\r').to_string() });
            continue;
        }
        let mut words = line.split(' ');
        let first = words.next().unwrap_or("");
        // SHA-1 (40) ou SHA-256 (64) : seules les lignes d'en-tête commencent ainsi.
        if (first.len() == 40 || first.len() == 64) && first.chars().all(|c| c.is_ascii_hexdigit()) {
            let orig = words.next().and_then(|n| n.parse().ok()).unwrap_or(0);
            if !commits.iter().any(|c| c.sha == first) {
                commits.push(BlameCommit {
                    sha: first.into(),
                    author: String::new(),
                    email: String::new(),
                    time: 0,
                    summary: String::new(),
                    filename: String::new(),
                    previous: None,
                });
            }
            current = Some((first.into(), orig));
            continue;
        }
        let Some((sha, _)) = &current else { continue };
        let Some(c) = commits.iter_mut().find(|c| &c.sha == sha) else { continue };
        let value = line.split_once(' ').map(|(_, v)| v).unwrap_or("");
        match first {
            "author" => c.author = value.into(),
            "author-mail" => c.email = value.trim_start_matches('<').trim_end_matches('>').into(),
            "author-time" => c.time = value.parse().unwrap_or(0),
            "summary" => c.summary = value.into(),
            "filename" => c.filename = value.into(),
            "previous" => {
                c.previous = value.split_once(' ').map(|(sha, filename)| BlamePrevious { sha: sha.into(), filename: filename.into() });
            }
            _ => {}
        }
    }
    Blame { commits, lines, truncated }
}

// ---------------------------------------------------------------------------
// Reflog
// ---------------------------------------------------------------------------

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReflogEntry {
    /// Commit où était la ref après cette opération.
    pub sha: String,
    /// Opération (`commit`, `checkout`, `reset`, `rebase (finish)`, `pull`…).
    pub action: String,
    /// Le reste du message du reflog (`moving from main to x`, sujet du commit…).
    pub message: String,
    /// Date de l'opération (secondes Unix), pas celle du commit.
    pub time: i64,
    /// Sujet du commit.
    pub subject: String,
}

const REFLOG_LIMIT: u32 = 500;

/// Positions passées de HEAD (`refname = "HEAD"`) ou d'une branche locale, de la plus récente
/// à la plus ancienne : de quoi retrouver un commit perdu (reset, rebase, branche supprimée).
pub fn reflog(path: &Path, refname: &str) -> Result<Vec<ReflogEntry>, String> {
    check_dir(path)?;
    let full = if refname == "HEAD" {
        "HEAD".to_string()
    } else {
        if refname.is_empty() || refname.starts_with('-') {
            return Err("invalid_branch_name".into());
        }
        let full = format!("refs/heads/{refname}");
        run(Some(path), &["rev-parse", "-q", "--verify", &full]).map_err(|_| "branch_not_found".to_string())?;
        full
    };
    let limit = format!("--max-count={REFLOG_LIMIT}");
    // `%gd` avec `--date=unix` : `HEAD@{1700000000}`, la date de l'entrée du reflog.
    let out = match run(Some(path), &["log", "-g", "-z", "--date=unix", "--format=%H%x1f%gd%x1f%gs%x1f%s", &limit, &full, "--"]) {
        Ok(out) => out,
        // Dépôt sans commit, ou ref sans reflog : rien à montrer.
        Err(_) => return Ok(vec![]),
    };
    Ok(out
        .split('\0')
        .filter_map(|rec| {
            let rec = rec.trim_start_matches('\n');
            if rec.is_empty() {
                return None;
            }
            let mut f = rec.splitn(4, '\x1f');
            let sha = f.next()?.to_string();
            let selector = f.next()?;
            let time = selector.rsplit_once('{').and_then(|(_, t)| t.trim_end_matches('}').parse().ok()).unwrap_or(0);
            let gs = f.next().unwrap_or("");
            let (action, message) = match gs.split_once(": ") {
                Some((a, m)) => (a.to_string(), m.to_string()),
                None => (gs.to_string(), String::new()),
            };
            Some(ReflogEntry { sha, action, message, time, subject: f.next().unwrap_or("").to_string() })
        })
        .collect())
}

// ---------------------------------------------------------------------------
// Refs
// ---------------------------------------------------------------------------

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitRef {
    /// Nom complet (`refs/heads/main`), unique.
    pub name: String,
    /// Nom court affiché (`main`, `origin/main`, `v1.0`).
    pub short: String,
    /// "local" | "remote" | "tag"
    pub kind: String,
    /// Commit pointé (déréférencé pour les tags annotés).
    pub target: String,
    /// Branche distante suivie (branches locales uniquement).
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    /// L'upstream configuré n'existe plus.
    pub gone: bool,
}

#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct RefsInfo {
    /// Commit courant (`None` si dépôt sans commit).
    pub head: Option<String>,
    /// Branche courante (`None` si HEAD détachée).
    pub head_branch: Option<String>,
    pub refs: Vec<GitRef>,
    /// Nombre d'entrées dans la pile de stash.
    pub stashes: u32,
    /// Dernier stash s'il vient de l'auto-stash (pas encore réappliqué).
    pub autostash: Option<crate::branches::AutoStash>,
    /// Remotes du dépôt, avec leur URL (même sans branche récupérée).
    pub remotes: Vec<crate::remotes::Remote>,
}

pub fn refs(path: &Path) -> Result<RefsInfo, String> {
    check_dir(path)?;
    let out = run(
        Some(path),
        &[
            "for-each-ref",
            "--format=%(refname)%00%(refname:short)%00%(objectname)%00%(*objectname)%00%(upstream:short)%00%(upstream:track)",
            "refs/heads",
            "refs/remotes",
            "refs/tags",
        ],
    )?;
    let (stashes, autostash) = crate::branches::stash_info(path);
    Ok(RefsInfo {
        head: run(Some(path), &["rev-parse", "-q", "--verify", "HEAD"]).ok(),
        head_branch: run(Some(path), &["symbolic-ref", "-q", "--short", "HEAD"]).ok(),
        refs: parse_refs(&out),
        stashes,
        autostash,
        remotes: crate::remotes::list(path),
    })
}

fn parse_refs(out: &str) -> Vec<GitRef> {
    out.lines()
        .filter_map(|line| {
            let f: Vec<&str> = line.split('\0').collect();
            if f.len() < 6 {
                return None;
            }
            let name = f[0];
            let kind = if name.starts_with("refs/heads/") {
                "local"
            } else if name.starts_with("refs/remotes/") {
                // `origin/HEAD` n'est qu'un alias de la branche par défaut.
                if name.ends_with("/HEAD") {
                    return None;
                }
                "remote"
            } else {
                "tag"
            };
            let (ahead, behind, gone) = parse_track(f[5]);
            Some(GitRef {
                name: name.to_string(),
                short: f[1].to_string(),
                kind: kind.to_string(),
                target: if f[3].is_empty() { f[2] } else { f[3] }.to_string(),
                upstream: (!f[4].is_empty()).then(|| f[4].to_string()),
                ahead,
                behind,
                gone,
            })
        })
        .collect()
}

/// `[ahead 2, behind 1]`, `[ahead 2]`, `[gone]` ou vide.
fn parse_track(s: &str) -> (u32, u32, bool) {
    let s = s.trim_matches(|c| c == '[' || c == ']');
    let (mut ahead, mut behind) = (0, 0);
    for part in s.split(", ") {
        if let Some(n) = part.strip_prefix("ahead ") {
            ahead = n.parse().unwrap_or(0);
        } else if let Some(n) = part.strip_prefix("behind ") {
            behind = n.parse().unwrap_or(0);
        }
    }
    (ahead, behind, s == "gone")
}

// ---------------------------------------------------------------------------
// Détails d'un commit
// ---------------------------------------------------------------------------

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    /// "A" ajouté, "M" modifié, "D" supprimé, "R" renommé, "C" copié, "T" type changé.
    pub status: String,
    pub path: String,
    /// Ancien chemin (renommage / copie).
    pub old_path: Option<String>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CommitDetails {
    pub sha: String,
    pub parents: Vec<String>,
    pub author: String,
    pub email: String,
    pub time: i64,
    pub committer: String,
    pub committer_email: String,
    pub commit_time: i64,
    pub subject: String,
    pub body: String,
    /// Fichiers modifiés par rapport au premier parent (ou à l'arbre vide).
    pub files: Vec<FileChange>,
}

pub fn details(path: &Path, sha: &str) -> Result<CommitDetails, String> {
    check_dir(path)?;
    check_sha(sha)?;
    let out = run(
        Some(path),
        &["show", "-s", "--format=%H%x00%P%x00%an%x00%ae%x00%at%x00%cn%x00%ce%x00%ct%x00%B", sha, "--"],
    )?;
    let f: Vec<&str> = out.splitn(9, '\0').collect();
    if f.len() < 9 {
        return Err("invalid_sha".into());
    }
    let parents: Vec<String> = f[1].split_whitespace().map(str::to_string).collect();
    let message = f[8].trim();
    let (subject, body) = match message.split_once('\n') {
        Some((s, b)) => (s.trim().to_string(), b.trim().to_string()),
        None => (message.to_string(), String::new()),
    };
    let base = parents.first().map(String::as_str).unwrap_or(EMPTY_TREE);
    let raw = run_raw(
        Some(path),
        &["diff-tree", "-r", "-M", "-z", "--name-status", "--no-ext-diff", base, f[0], "--"],
    )?;
    Ok(CommitDetails {
        sha: f[0].to_string(),
        author: f[2].to_string(),
        email: f[3].to_string(),
        time: f[4].parse().unwrap_or(0),
        committer: f[5].to_string(),
        committer_email: f[6].to_string(),
        commit_time: f[7].parse().unwrap_or(0),
        subject,
        body,
        parents,
        files: parse_name_status(&raw),
    })
}

/// Sortie de `--name-status -z` : `M\0chemin\0` ou `R100\0ancien\0nouveau\0`.
pub(crate) fn parse_name_status(out: &str) -> Vec<FileChange> {
    let mut files = vec![];
    let mut it = out.split('\0').filter(|s| !s.is_empty());
    while let Some(st) = it.next() {
        let status = st.chars().next().unwrap_or('M').to_string();
        let Some(first) = it.next() else { break };
        if status == "R" || status == "C" {
            let Some(second) = it.next() else { break };
            files.push(FileChange { status, path: second.into(), old_path: Some(first.into()) });
        } else {
            files.push(FileChange { status, path: first.into(), old_path: None });
        }
    }
    files
}

// ---------------------------------------------------------------------------
// Diff d'un fichier
// ---------------------------------------------------------------------------

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    /// "+" ajout, "-" suppression, " " contexte.
    pub kind: String,
    pub old: Option<u32>,
    pub new: Option<u32>,
    pub text: String,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Hunk {
    /// En-tête complet : `@@ -1,3 +1,4 @@ fn main()`.
    pub header: String,
    pub lines: Vec<DiffLine>,
}

#[derive(Serialize, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub binary: bool,
    pub truncated: bool,
    pub hunks: Vec<Hunk>,
    /// Empreinte de la sortie brute de git : renvoyée avec une sélection de lignes, elle
    /// garantit que le diff n'a pas changé entre l'affichage et l'action.
    pub fingerprint: String,
}

/// Diff d'un fichier entre `sha` et son premier parent (ou l'arbre vide).
pub fn diff(path: &Path, sha: &str, file: &str, old_file: Option<&str>) -> Result<FileDiff, String> {
    check_dir(path)?;
    check_sha(sha)?;
    let parent = run(Some(path), &["rev-parse", "-q", "--verify", &format!("{sha}^1")]).ok();
    if let Some(p) = &parent {
        check_sha(p)?;
    }
    let base = parent.as_deref().unwrap_or(EMPTY_TREE);
    // `--literal-pathspecs` : un nom de fichier contenant `*`, `?`, `[` ou commençant par `:`
    // désigne ce fichier, pas un motif.
    let mut args = vec!["--literal-pathspecs", "diff", "--no-color", "--no-ext-diff", "-M", "--unified=3", base, sha, "--"];
    if let Some(old) = old_file {
        args.push(old);
    }
    args.push(file);
    let out = run_raw(Some(path), &args)?;
    Ok(parse_diff(&out))
}

// ---------------------------------------------------------------------------
// Ce qui part au push / arrive au pull
// ---------------------------------------------------------------------------

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RangeChanges {
    /// Départ du diff cumulé : base commune de HEAD et de sa branche suivie (l'arbre vide
    /// si elles n'ont rien en commun).
    pub base: String,
    /// Bout de la plage : HEAD (push) ou la branche suivie, telle qu'au dernier fetch (pull).
    pub tip: String,
    /// Commits de la plage, du plus récent au plus ancien (au plus `RANGE_LIMIT`).
    pub commits: Vec<Commit>,
    pub files: Vec<FileChange>,
}

const RANGE_LIMIT: u32 = 500;

/// Commits et fichiers qui partent au push (`direction = "push"` : branche suivie..HEAD) ou
/// arrivent au pull (`"pull"` : HEAD..branche suivie).
pub fn range_changes(path: &Path, direction: &str) -> Result<RangeChanges, String> {
    check_dir(path)?;
    let head = run(Some(path), &["rev-parse", "-q", "--verify", "HEAD^{commit}"])?;
    let upstream = run(Some(path), &["rev-parse", "-q", "--verify", "@{upstream}^{commit}"]).map_err(|_| "no_upstream".to_string())?;
    check_sha(&head)?;
    check_sha(&upstream)?;
    let (from, tip) = match direction {
        "push" => (upstream, head),
        "pull" => (head, upstream),
        _ => return Err(format!("unknown direction: {direction}")),
    };
    let base = run(Some(path), &["merge-base", &from, &tip]).unwrap_or_else(|_| EMPTY_TREE.to_string());
    check_sha(&base)?;
    let range = format!("{from}..{tip}");
    let limit = format!("--max-count={RANGE_LIMIT}");
    let commits = parse_log(&run(Some(path), &["log", "--date-order", "-z", LOG_FORMAT, &limit, &range, "--"])?);
    let raw = run_raw(Some(path), &["diff-tree", "-r", "-M", "-z", "--name-status", "--no-ext-diff", &base, &tip, "--"])?;
    Ok(RangeChanges { base, tip, commits, files: parse_name_status(&raw) })
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StashChanges {
    /// Commit d'où part le stash.
    pub base: String,
    /// Le stash lui-même (copie de travail au moment du stash).
    pub tip: String,
    /// Commit des fichiers non suivis mis de côté (`stash -u`), s'il y en a.
    pub untracked: Option<String>,
    /// Fichiers suivis modifiés : diff `base..tip`.
    pub files: Vec<FileChange>,
    /// Fichiers non suivis : diff depuis l'arbre vide jusqu'à `untracked`.
    pub untracked_files: Vec<FileChange>,
}

/// Fichiers d'un stash : ceux qui étaient suivis (diff par rapport à son commit de départ)
/// et les non suivis mis de côté avec lui.
pub fn stash_changes(path: &Path, sha: &str) -> Result<StashChanges, String> {
    check_dir(path)?;
    check_sha(sha)?;
    let base = run(Some(path), &["rev-parse", "-q", "--verify", &format!("{sha}^1")])?;
    let untracked = run(Some(path), &["rev-parse", "-q", "--verify", &format!("{sha}^3")]).ok();
    let tree = |from: &str, to: &str| -> Result<Vec<FileChange>, String> {
        Ok(parse_name_status(&run_raw(Some(path), &["diff-tree", "-r", "-M", "-z", "--name-status", "--no-ext-diff", from, to, "--"])?))
    };
    let files = tree(&base, sha)?;
    let untracked_files = match &untracked {
        Some(u) => tree(EMPTY_TREE, u)?,
        None => vec![],
    };
    Ok(StashChanges { base, tip: sha.to_string(), untracked, files, untracked_files })
}

/// Fichiers modifiés entre deux commits (changements cumulés d'une sélection de commits ;
/// `base` peut être l'arbre vide, pour une plage qui part du premier commit).
pub fn compare_files(path: &Path, base: &str, tip: &str) -> Result<Vec<FileChange>, String> {
    check_dir(path)?;
    check_sha(base)?;
    check_sha(tip)?;
    Ok(parse_name_status(&run_raw(Some(path), &["diff-tree", "-r", "-M", "-z", "--name-status", "--no-ext-diff", base, tip, "--"])?))
}

/// Diff d'un fichier entre deux commits (diff cumulé d'une plage).
pub fn range_diff(path: &Path, base: &str, tip: &str, file: &str, old_file: Option<&str>) -> Result<FileDiff, String> {
    check_dir(path)?;
    check_sha(base)?;
    check_sha(tip)?;
    let mut args = vec!["--literal-pathspecs", "diff", "--no-color", "--no-ext-diff", "-M", "--unified=3", base, tip, "--"];
    if let Some(old) = old_file {
        args.push(old);
    }
    args.push(file);
    Ok(parse_diff(&run_raw(Some(path), &args)?))
}

/// Empreinte stable d'un texte (pour détecter qu'un diff a changé).
pub(crate) fn fingerprint(text: &str) -> String {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    text.hash(&mut h);
    format!("{:016x}", h.finish())
}

/// Les numéros de ligne (`DiffLine` d'indice i dans un hunk) servent aussi à désigner une
/// sélection : `worktree::split_raw` parcourt la sortie brute avec les mêmes règles.
pub(crate) fn parse_diff(out: &str) -> FileDiff {
    let mut d = FileDiff { fingerprint: fingerprint(out), ..FileDiff::default() };
    let (mut old, mut new) = (0u32, 0u32);
    let mut count = 0usize;
    for line in out.lines() {
        if let Some(rest) = line.strip_prefix("@@") {
            let (o, n) = parse_hunk_header(rest);
            old = o;
            new = n;
            d.hunks.push(Hunk { header: line.to_string(), lines: vec![] });
            continue;
        }
        let Some(hunk) = d.hunks.last_mut() else {
            // En-têtes avant le premier hunk (diff --git, index, ---, +++).
            if line.starts_with("Binary files ") || line.starts_with("GIT binary patch") {
                d.binary = true;
            }
            continue;
        };
        if count >= MAX_DIFF_LINES {
            d.truncated = true;
            break;
        }
        let (kind, text) = match line.chars().next() {
            Some('+') => ("+", &line[1..]),
            Some('-') => ("-", &line[1..]),
            Some(' ') => (" ", &line[1..]),
            Some('\\') => continue, // « \ No newline at end of file »
            None => (" ", ""),
            _ => continue,
        };
        let (o, n) = match kind {
            "+" => (None, Some(new)),
            "-" => (Some(old), None),
            _ => (Some(old), Some(new)),
        };
        if kind != "+" {
            old += 1;
        }
        if kind != "-" {
            new += 1;
        }
        hunk.lines.push(DiffLine { kind: kind.into(), old: o, new: n, text: text.into() });
        count += 1;
    }
    d
}

/// ` -12,5 +14,6 @@ ...` → (12, 14)
pub(crate) fn parse_hunk_header(rest: &str) -> (u32, u32) {
    let mut old = 1;
    let mut new = 1;
    for part in rest.split_whitespace() {
        if let Some(v) = part.strip_prefix('-') {
            old = v.split(',').next().and_then(|n| n.parse().ok()).unwrap_or(1);
        } else if let Some(v) = part.strip_prefix('+') {
            new = v.split(',').next().and_then(|n| n.parse().ok()).unwrap_or(1);
        } else if part == "@@" {
            break;
        }
    }
    (old, new)
}

#[cfg(test)]
mod tests {

    #[test]
    fn file_history_follows_renames() {
        let repo = crate::git::tests::temp_repo();
        let p = repo.path();
        crate::git::tests::commit_file(p, "a.txt", "un\ndeux\ntrois\nquatre\n");
        crate::git::tests::commit_file(p, "b.txt", "autre\n");
        crate::git::tests::commit_file(p, "a.txt", "un\ndeux\ntrois\nquatre\ncinq\n");
        run(Some(p), &["mv", "a.txt", "c.txt"]).unwrap();
        run(Some(p), &["commit", "-qm", "renomme"]).unwrap();
        let list = file_history(p, "c.txt").unwrap();
        let got: Vec<_> = list.iter().map(|e| (e.change.status.as_str(), e.change.path.as_str(), e.change.old_path.as_deref())).collect();
        assert_eq!(got, [("R", "c.txt", Some("a.txt")), ("M", "a.txt", None), ("A", "a.txt", None)]);
        assert_eq!(list[0].commit.subject, "renomme");
        assert!(file_history(p, "absent.txt").unwrap().is_empty());
        assert!(file_history(p, "").is_err());
    }

    #[test]
    fn blame_tells_each_line_its_commit() {
        let repo = crate::git::tests::temp_repo();
        let p = repo.path();
        crate::git::tests::commit_file(p, "a.txt", "un\ndeux\n");
        let first = run(Some(p), &["rev-parse", "HEAD"]).unwrap();
        crate::git::tests::commit_file(p, "a.txt", "un\ndeux\ntrois\n");
        let second = run(Some(p), &["rev-parse", "HEAD"]).unwrap();
        std::fs::write(p.join("a.txt"), "un\ndeux\ntrois\nquatre\n").unwrap();

        let b = blame(p, "a.txt", Some(&first)).unwrap();
        assert_eq!(b.lines.iter().map(|l| (l.sha.as_str(), l.text.as_str())).collect::<Vec<_>>(), [(first.as_str(), "un"), (first.as_str(), "deux")]);
        assert_eq!(b.commits.len(), 1);
        assert_eq!(b.commits[0].filename, "a.txt");
        assert!(b.commits[0].time > 0);

        let work = blame(p, "a.txt", None).unwrap();
        let shas: Vec<_> = work.lines.iter().map(|l| l.sha.as_str()).collect();
        assert_eq!(shas[..3], [first.as_str(), first.as_str(), second.as_str()]);
        assert!(shas[3].chars().all(|c| c == '0'));
        assert_eq!(work.lines[2].orig, 3);
        assert_eq!(work.commits.len(), 3);
        let by = |sha: &str| work.commits.iter().find(|c| c.sha == sha).unwrap();
        assert_eq!(by(&first).previous, None);
        assert_eq!(by(&second).previous, Some(BlamePrevious { sha: first.clone(), filename: "a.txt".into() }));

        assert_eq!(blame(p, "absent.txt", Some(&second)).unwrap_err(), "blame_no_file");
        assert!(blame(p, "a.txt", Some("-x")).is_err());
        std::fs::remove_file(p.join("a.txt")).unwrap();
        assert_eq!(blame(p, "a.txt", None).unwrap_err(), "blame_no_file");
        std::fs::write(p.join("n.txt"), "x\n").unwrap();
        assert_eq!(blame(p, "n.txt", None).unwrap_err(), "blame_no_file");
    }

    #[test]
    fn search_changes_finds_when_text_came_and_went() {
        let repo = crate::git::tests::temp_repo();
        let p = repo.path();
        crate::git::tests::commit_file(p, "a.txt", "rien\n");
        crate::git::tests::commit_file(p, "a.txt", "rien\naiguille\n");
        let added = run(Some(p), &["rev-parse", "HEAD"]).unwrap();
        crate::git::tests::commit_file(p, "b.txt", "autre\n");
        crate::git::tests::commit_file(p, "a.txt", "rien\n");
        let removed = run(Some(p), &["rev-parse", "HEAD"]).unwrap();
        let shas = |v: Vec<Commit>| v.into_iter().map(|c| c.sha).collect::<Vec<_>>();
        assert_eq!(shas(search_changes(p, "aiguille", false, None).unwrap()), [removed.clone(), added.clone()]);
        assert_eq!(shas(search_changes(p, "aig.ille", true, None).unwrap()), [removed, added]);
        assert!(search_changes(p, "aiguille", false, Some("b.txt")).unwrap().is_empty());
        assert!(search_changes(p, "-aiguille", false, None).unwrap().is_empty());
        assert_eq!(search_changes(p, "", false, None).unwrap_err(), "search_empty");
        assert_eq!(search_changes(p, "a(", true, None).unwrap_err(), "search_bad_regex");
    }
    use super::*;
    use crate::git::tests::{commit_file, temp_repo};

    fn git(repo: &Path, args: &[&str]) -> String {
        run(Some(repo), args).unwrap()
    }

    #[test]
    fn stash_changes_lists_tracked_and_untracked_files() {
        let dir = temp_repo();
        let p = dir.path();
        commit_file(p, "a.txt", "1
");
        std::fs::write(p.join("a.txt"), "2
").unwrap();
        std::fs::write(p.join("neuf.txt"), "n
").unwrap();
        git(p, &["stash", "push", "-q", "-u"]);
        let sha = git(p, &["rev-parse", "stash@{0}"]).trim().to_string();
        let c = stash_changes(p, &sha).unwrap();
        assert_eq!(c.files.iter().map(|f| f.path.as_str()).collect::<Vec<_>>(), ["a.txt"]);
        assert_eq!(c.untracked_files.iter().map(|f| (f.status.as_str(), f.path.as_str())).collect::<Vec<_>>(), [("A", "neuf.txt")]);
        let d = range_diff(p, EMPTY_TREE, c.untracked.as_deref().unwrap(), "neuf.txt", None).unwrap();
        assert_eq!(d.hunks.len(), 1);
    }

    #[test]
    fn range_changes_lists_what_push_and_pull_move() {
        let dir = temp_repo();
        let p = dir.path();
        commit_file(p, "a.txt", "1");
        git(p, &["branch", "amont"]);
        commit_file(p, "a.txt", "2");
        commit_file(p, "b.txt", "x");
        git(p, &["branch", "--set-upstream-to=amont"]);

        let push = range_changes(p, "push").unwrap();
        assert_eq!(push.commits.len(), 2);
        assert_eq!(push.base, git(p, &["rev-parse", "amont"]));
        assert_eq!(push.tip, git(p, &["rev-parse", "HEAD"]));
        let files: Vec<_> = push.files.iter().map(|f| (f.status.as_str(), f.path.as_str())).collect();
        assert_eq!(files, vec![("M", "a.txt"), ("A", "b.txt")]);
        let d = range_diff(p, &push.base, &push.tip, "a.txt", None).unwrap();
        assert_eq!(d.hunks.len(), 1);

        let pull = range_changes(p, "pull").unwrap();
        assert!(pull.commits.is_empty() && pull.files.is_empty());

        git(p, &["branch", "--unset-upstream"]);
        assert_eq!(range_changes(p, "push").unwrap_err(), "no_upstream");
        assert_eq!(range_diff(p, "--x", "HEAD", "a.txt", None).unwrap_err(), "invalid_sha");
    }

    #[test]
    fn parses_log_records() {
        let out = "aaa\x1fbbb ccc\x1fAnn\x1fann@x.fr\x1f1700000000\x1fMerge: a\x1fb\0ddd\x1f\x1fBob\x1fb@x.fr\x1f1\x1fracine\0";
        let c = parse_log(out);
        assert_eq!(c.len(), 2);
        assert_eq!(c[0].parents, vec!["bbb", "ccc"]);
        // Le sujet garde tout, même un séparateur inattendu.
        assert_eq!(c[0].subject, "Merge: a\x1fb");
        assert!(c[1].parents.is_empty());
        assert_eq!(c[1].time, 1);
    }

    #[test]
    fn parses_refs_and_tracking() {
        let out = "refs/heads/main\0main\0aaa\0\0origin/main\0[ahead 2, behind 1]\n\
                   refs/remotes/origin/HEAD\0origin\0aaa\0\0\0\n\
                   refs/remotes/origin/main\0origin/main\0bbb\0\0\0\n\
                   refs/tags/v1\0v1\0tagobj\0ccc\0\0\n\
                   refs/heads/old\0old\0ddd\0\0origin/old\0[gone]";
        let r = parse_refs(out);
        assert_eq!(r.len(), 4, "origin/HEAD est ignoré");
        assert_eq!((r[0].kind.as_str(), r[0].ahead, r[0].behind), ("local", 2, 1));
        assert_eq!(r[0].upstream.as_deref(), Some("origin/main"));
        assert_eq!(r[1].kind, "remote");
        assert_eq!((r[2].kind.as_str(), r[2].target.as_str()), ("tag", "ccc"));
        assert!(r[3].gone);
    }

    #[test]
    fn parses_name_status_with_renames() {
        let f = parse_name_status("M\0a.txt\0R087\0old.rs\0new.rs\0A\0dir/b c.txt\0");
        assert_eq!(f.len(), 3);
        assert_eq!(f[1].status, "R");
        assert_eq!(f[1].old_path.as_deref(), Some("old.rs"));
        assert_eq!(f[1].path, "new.rs");
        assert_eq!(f[2].path, "dir/b c.txt");
    }

    #[test]
    fn parses_unified_diff_with_line_numbers() {
        let out = "diff --git a/f b/f\nindex 1..2 100644\n--- a/f\n+++ b/f\n@@ -2,3 +2,3 @@ ctx\n a\n-b\n+B\n c\n\\ No newline at end of file\n@@ -10 +10,2 @@\n x\n+y";
        let d = parse_diff(out);
        assert!(!d.binary && !d.truncated);
        assert_eq!(d.hunks.len(), 2);
        let l = &d.hunks[0].lines;
        assert_eq!(l.len(), 4);
        assert_eq!((l[0].old, l[0].new), (Some(2), Some(2)));
        assert_eq!((l[1].kind.as_str(), l[1].old, l[1].new), ("-", Some(3), None));
        assert_eq!((l[2].kind.as_str(), l[2].old, l[2].new), ("+", None, Some(3)));
        assert_eq!((l[3].old, l[3].new), (Some(4), Some(4)));
        assert_eq!(d.hunks[1].lines[1].new, Some(11));
    }

    #[test]
    fn detects_binary_diff() {
        let d = parse_diff("diff --git a/i.png b/i.png\nindex 1..2\nBinary files a/i.png and b/i.png differ");
        assert!(d.binary);
        assert!(d.hunks.is_empty());
    }

    #[test]
    fn rejects_non_sha_arguments() {
        assert_eq!(check_sha("--output=x").unwrap_err(), "invalid_sha");
        assert_eq!(check_sha("abc").unwrap_err(), "invalid_sha");
        assert!(check_sha("a91f3c2").is_ok());
    }

    // --- Sur de vrais dépôts ---------------------------------------------

    #[test]
    fn log_of_empty_repo_is_empty() {
        let repo = temp_repo();
        assert!(log(repo.path(), 0, 100).unwrap().is_empty());
        let r = refs(repo.path()).unwrap();
        assert!(r.head.is_none() && r.refs.is_empty());
        assert_eq!(r.head_branch.as_deref(), Some("main"));
    }

    #[test]
    fn log_lists_all_branches_children_first_and_pages() {
        let repo = temp_repo();
        let p = repo.path();
        commit_file(p, "a.txt", "1");
        git(p, &["checkout", "-q", "-b", "feature"]);
        commit_file(p, "b.txt", "1");
        git(p, &["checkout", "-q", "main"]);
        commit_file(p, "c.txt", "1");
        git(p, &["merge", "-q", "--no-ff", "-m", "fusion", "feature"]);
        git(p, &["stash", "list"]); // pas de stash : rien ne doit casser

        let all = log(p, 0, 100).unwrap();
        assert_eq!(all.len(), 4);
        assert_eq!(all[0].subject, "fusion");
        assert_eq!(all[0].parents.len(), 2);
        // Chaque commit apparaît avant ses parents.
        for (i, c) in all.iter().enumerate() {
            for parent in &c.parents {
                let j = all.iter().position(|x| &x.sha == parent).unwrap();
                assert!(j > i);
            }
        }
        // Pagination.
        let page = log(p, 1, 2).unwrap();
        assert_eq!(page, all[1..3].to_vec());
    }

    #[test]
    fn log_excludes_stashes() {
        let repo = temp_repo();
        let p = repo.path();
        commit_file(p, "a.txt", "1");
        std::fs::write(p.join("a.txt"), "2").unwrap();
        git(p, &["stash", "-q"]);
        assert_eq!(log(p, 0, 100).unwrap().len(), 1);
        // Les notes non plus : leurs commits ne font pas partie de l'historique du code.
        git(p, &["notes", "add", "-m", "une note"]);
        assert_eq!(log(p, 0, 100).unwrap().len(), 1);
    }

    #[test]
    fn refs_reads_branches_tags_and_head() {
        let repo = temp_repo();
        let p = repo.path();
        commit_file(p, "a.txt", "1");
        git(p, &["tag", "-a", "v1", "-m", "version 1"]);
        git(p, &["branch", "autre"]);
        let head = git(p, &["rev-parse", "HEAD"]);

        let r = refs(p).unwrap();
        assert_eq!(r.head.as_deref(), Some(head.as_str()));
        assert_eq!(r.head_branch.as_deref(), Some("main"));
        let tag = r.refs.iter().find(|x| x.kind == "tag").unwrap();
        assert_eq!(tag.target, head, "le tag annoté est déréférencé vers son commit");
        assert_eq!(r.refs.iter().filter(|x| x.kind == "local").count(), 2);

        git(p, &["checkout", "-q", "--detach"]);
        assert!(refs(p).unwrap().head_branch.is_none());
    }

    #[test]
    fn details_and_diff_of_a_commit() {
        let repo = temp_repo();
        let p = repo.path();
        commit_file(p, "a.txt", "un\ndeux\ntrois\n");
        let root = git(p, &["rev-parse", "HEAD"]);
        std::fs::write(p.join("a.txt"), "un\nDEUX\ntrois\n").unwrap();
        std::fs::write(p.join("b.txt"), "nouveau\n").unwrap();
        git(p, &["add", "."]);
        git(p, &["commit", "-q", "-m", "Titre", "-m", "Corps du message\nsur deux lignes"]);
        let sha = git(p, &["rev-parse", "HEAD"]);

        let d = details(p, &sha).unwrap();
        assert_eq!(d.subject, "Titre");
        assert_eq!(d.body, "Corps du message\nsur deux lignes");
        assert_eq!(d.parents, vec![root.clone()]);
        assert_eq!(d.author, "Test");
        let st: Vec<_> = d.files.iter().map(|f| (f.status.as_str(), f.path.as_str())).collect();
        assert_eq!(st, vec![("M", "a.txt"), ("A", "b.txt")]);

        let fd = diff(p, &sha, "a.txt", None).unwrap();
        let changed: Vec<_> = fd.hunks[0]
            .lines
            .iter()
            .filter(|l| l.kind != " ")
            .map(|l| (l.kind.as_str(), l.text.as_str()))
            .collect();
        assert_eq!(changed, vec![("-", "deux"), ("+", "DEUX")]);

        // Commit racine : tout est ajouté, comparé à l'arbre vide.
        let r = details(p, &root).unwrap();
        assert_eq!(r.files[0].status, "A");
        let rd = diff(p, &root, "a.txt", None).unwrap();
        assert_eq!(rd.hunks[0].lines.len(), 3);
        assert!(rd.hunks[0].lines.iter().all(|l| l.kind == "+"));
    }

    #[test]
    fn details_detects_renames_and_diffs_them() {
        let repo = temp_repo();
        let p = repo.path();
        commit_file(p, "ancien.txt", "a\nb\nc\nd\ne\n");
        git(p, &["mv", "ancien.txt", "nouveau.txt"]);
        std::fs::write(p.join("nouveau.txt"), "a\nb\nc\nd\nE\n").unwrap();
        git(p, &["add", "."]);
        git(p, &["commit", "-q", "-m", "renommage"]);
        let sha = git(p, &["rev-parse", "HEAD"]);

        let d = details(p, &sha).unwrap();
        assert_eq!(d.files.len(), 1);
        assert_eq!(d.files[0].status, "R");
        assert_eq!(d.files[0].old_path.as_deref(), Some("ancien.txt"));

        let fd = diff(p, &sha, "nouveau.txt", Some("ancien.txt")).unwrap();
        let changed: Vec<_> = fd.hunks[0].lines.iter().filter(|l| l.kind != " ").collect();
        assert_eq!(changed.len(), 2, "seule la ligne modifiée apparaît, pas tout le fichier");
    }

    #[test]
    fn diff_treats_file_names_literally() {
        let repo = temp_repo();
        let p = repo.path();
        // `[ab].txt` est un nom valide sous Windows ; comme motif, il désignerait `a.txt`.
        commit_file(p, "[ab].txt", "1\n");
        commit_file(p, "a.txt", "1\n");
        std::fs::write(p.join("[ab].txt"), "2\n").unwrap();
        std::fs::write(p.join("a.txt"), "2\n").unwrap();
        git(p, &["add", "."]);
        git(p, &["commit", "-q", "-m", "deux fichiers"]);
        let sha = git(p, &["rev-parse", "HEAD"]);
        let fd = diff(p, &sha, "[ab].txt", None).unwrap();
        assert_eq!(fd.hunks.len(), 1, "seul [ab].txt, pas a.txt (que le motif [ab] désignerait)");
    }

    #[test]
    fn details_of_unknown_commit_fails() {
        let repo = temp_repo();
        commit_file(repo.path(), "a.txt", "1");
        assert!(details(repo.path(), "deadbeefdeadbeef").is_err());
    }
}
