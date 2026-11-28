//! Copie de travail : état des fichiers, indexation (fichier, bloc, ligne), abandon des
//! modifications, stash de tout, commit et amend.
//!
//! Indexer / retirer des lignes passe par un patch partiel appliqué à l'index
//! (`git apply --cached`), construit à partir du diff que l'interface affichait — dont
//! l'empreinte est vérifiée pour ne jamais agir sur un diff qui a changé entre-temps.
//! Abandonner des lignes réécrit directement le fichier de travail (pas de `git apply` sur
//! la copie de travail, qui échoue avec `core.autocrlf` sous Windows).

use crate::git::{run, run_input, run_raw};
use crate::history::{check_dir, fingerprint, parse_diff, parse_hunk_header, FileDiff};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};

/// Au-delà, un fichier non suivi n'est pas affiché ligne à ligne.
const MAX_UNTRACKED_BYTES: usize = 2 * 1024 * 1024;

// ---------------------------------------------------------------------------
// État
// ---------------------------------------------------------------------------

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StatusFile {
    pub path: String,
    /// Ancien chemin d'un renommage indexé.
    pub old_path: Option<String>,
    /// "A" "M" "D" "R" "C" "T", "?" (non suivi) ou "U" (conflit).
    pub status: String,
}

#[derive(Serialize, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkStatus {
    /// Changements indexés (HEAD → index).
    pub staged: Vec<StatusFile>,
    /// Changements non indexés (index → copie de travail), fichiers non suivis compris.
    pub unstaged: Vec<StatusFile>,
    pub conflicted: Vec<StatusFile>,
    /// Opération laissée en cours par git : "merge", "rebase", "cherry-pick", "revert".
    pub operation: Option<String>,
    /// Message préparé par git pour terminer un merge.
    pub merge_message: Option<String>,
}

pub fn status(path: &Path) -> Result<WorkStatus, String> {
    check_dir(path)?;
    let out = run_raw(Some(path), &["status", "--porcelain=v2", "-z", "--untracked-files=all"])?;
    let mut s = parse_status(&out);
    s.operation = crate::branches::operation(path).map(str::to_string);
    if s.operation.as_deref() == Some("merge") {
        s.merge_message = crate::branches::merge_message(path);
    }
    Ok(s)
}

fn file(path: &str, old_path: Option<&str>, status: char) -> StatusFile {
    StatusFile { path: path.into(), old_path: old_path.map(Into::into), status: status.to_string() }
}

/// Sortie de `git status --porcelain=v2 -z` :
/// `1 XY sub mH mI mW hH hI chemin`, `2 XY … Xscore chemin\0ancien`, `u XY … chemin`, `? chemin`.
fn parse_status(out: &str) -> WorkStatus {
    let mut s = WorkStatus::default();
    let mut it = out.split('\0').filter(|r| !r.is_empty());
    while let Some(rec) = it.next() {
        let kind = rec.as_bytes()[0];
        match kind {
            b'?' => s.unstaged.push(file(&rec[2..], None, '?')),
            b'1' | b'2' => {
                let fields = if kind == b'1' { 9 } else { 10 };
                let f: Vec<&str> = rec.splitn(fields, ' ').collect();
                if f.len() < fields {
                    continue;
                }
                let xy: Vec<char> = f[1].chars().collect();
                let p = f[fields - 1];
                let old = if kind == b'2' { it.next() } else { None };
                if xy[0] != '.' {
                    s.staged.push(file(p, old, xy[0]));
                }
                if xy[1] != '.' {
                    s.unstaged.push(file(p, None, xy[1]));
                }
            }
            b'u' => {
                let f: Vec<&str> = rec.splitn(11, ' ').collect();
                if let Some(p) = f.get(10) {
                    s.conflicted.push(file(p, None, 'U'));
                }
            }
            _ => {}
        }
    }
    s
}

// ---------------------------------------------------------------------------
// Diff d'un fichier de la copie de travail
// ---------------------------------------------------------------------------

/// Côté du diff : "unstaged" (index → copie), "staged" (HEAD → index), "untracked", "conflicted".
fn diff_args<'a>(area: &str, file: &'a str, old_file: Option<&'a str>) -> Result<Vec<&'a str>, String> {
    // `--no-textconv` : les lignes affichées doivent être celles du fichier, puisqu'elles
    // servent à construire un patch ou à réécrire le fichier.
    let mut args = vec!["--literal-pathspecs", "diff", "--no-color", "--no-ext-diff", "--no-textconv", "--unified=3"];
    match area {
        "unstaged" => {}
        "staged" => args.extend(["--cached", "-M"]),
        // Fichier en conflit : on montre la copie de travail par rapport à HEAD.
        "conflicted" => args.push("HEAD"),
        _ => return Err("invalid_area".into()),
    }
    args.push("--");
    if let Some(old) = old_file {
        args.push(old);
    }
    args.push(file);
    Ok(args)
}

/// `ignore_ws` : pour l'affichage seulement ; l'indexation par ligne relit le diff sans `-w`.
/// `full` : tout le fichier en contexte (affichage seulement, comme `ignore_ws`).
pub fn file_diff(path: &Path, file: &str, old_file: Option<&str>, area: &str, ignore_ws: bool, full: bool) -> Result<FileDiff, String> {
    check_dir(path)?;
    if area == "untracked" {
        return untracked_diff(path, file);
    }
    let mut args = diff_args(area, file, old_file)?;
    if ignore_ws {
        // Avant le `--` qui précède les chemins.
        let at = args.iter().position(|a| *a == "--").unwrap_or(args.len());
        args.insert(at, "--ignore-all-space");
    }
    crate::history::push_full(&mut args, full);
    let out = run_raw(Some(path), &args)?;
    Ok(parse_diff(&out))
}

/// Un fichier non suivi n'a pas de diff dans git : tout son contenu est « ajouté ».
fn untracked_diff(path: &Path, file: &str) -> Result<FileDiff, String> {
    check_relative(file)?;
    let full = path.join(file);
    // Taille lue avant le contenu : un fichier énorme n'est pas chargé pour rien.
    let len = std::fs::metadata(&full).map_err(|e| e.to_string())?.len();
    let mut d = FileDiff { fingerprint: fingerprint(&len.to_string()), ..FileDiff::default() };
    if len > MAX_UNTRACKED_BYTES as u64 {
        d.truncated = true;
        return Ok(d);
    }
    let bytes = std::fs::read(&full).map_err(|e| e.to_string())?;
    if bytes.iter().take(8000).any(|&b| b == 0) {
        d.binary = true;
        return Ok(d);
    }
    let text = String::from_utf8_lossy(&bytes);
    let mut out = String::new();
    let lines: Vec<&str> = text.lines().collect();
    out.push_str(&format!("@@ -0,0 +1,{} @@\n", lines.len()));
    for l in &lines {
        out.push('+');
        out.push_str(l);
        out.push('\n');
    }
    let mut parsed = if lines.is_empty() { FileDiff::default() } else { parse_diff(&out) };
    parsed.fingerprint = fingerprint(&text);
    Ok(parsed)
}

// ---------------------------------------------------------------------------
// Indexer / retirer / abandonner des fichiers entiers
// ---------------------------------------------------------------------------

fn with_paths<'a>(base: &[&'a str], files: &'a [String]) -> Vec<&'a str> {
    let mut args = vec!["--literal-pathspecs"];
    args.extend_from_slice(base);
    args.push("--");
    args.extend(files.iter().map(String::as_str));
    args
}

/// Chemin relatif fourni par l'interface : ne jamais sortir du dépôt. Refuse `..`, un chemin
/// absolu, vide ou `.` (le dépôt lui-même) et, sous Windows, `\x` ou `C:x`, que `join`
/// placerait ailleurs.
fn check_relative(file: &str) -> Result<(), String> {
    let mut parts = Path::new(file).components().peekable();
    if parts.peek().is_some() && parts.all(|c| matches!(c, std::path::Component::Normal(_))) {
        Ok(())
    } else {
        Err("invalid_path".into())
    }
}

fn has_head(path: &Path) -> bool {
    run(Some(path), &["rev-parse", "-q", "--verify", "HEAD"]).is_ok()
}

pub fn stage_files(path: &Path, files: &[String]) -> Result<(), String> {
    check_dir(path)?;
    run(Some(path), &with_paths(&["add", "-A"], files)).map(|_| ())
}

pub fn unstage_files(path: &Path, files: &[String]) -> Result<(), String> {
    check_dir(path)?;
    if has_head(path) {
        run(Some(path), &with_paths(&["reset", "-q", "HEAD"], files)).map(|_| ())
    } else {
        // Premier commit pas encore fait : il n'y a pas de HEAD à quoi revenir.
        run(Some(path), &with_paths(&["rm", "-q", "-r", "--cached"], files)).map(|_| ())
    }
}

pub fn stage_all(path: &Path) -> Result<(), String> {
    check_dir(path)?;
    run(Some(path), &["add", "-A"]).map(|_| ())
}

pub fn unstage_all(path: &Path) -> Result<(), String> {
    check_dir(path)?;
    if has_head(path) {
        run(Some(path), &["reset", "-q"]).map(|_| ())
    } else {
        run(Some(path), &["rm", "-q", "-r", "--cached", "."]).map(|_| ())
    }
}

/// Abandonne les modifications non indexées : restaure les fichiers suivis depuis l'index,
/// supprime les fichiers non suivis.
pub fn discard_files(path: &Path, tracked: &[String], untracked: &[String]) -> Result<(), String> {
    check_dir(path)?;
    // Avant de toucher à quoi que ce soit : un chemin refusé n'annule rien à moitié.
    untracked.iter().try_for_each(|f| check_relative(f))?;
    if !tracked.is_empty() {
        run(Some(path), &with_paths(&["checkout"], tracked))?;
    }
    for f in untracked {
        let full = path.join(f);
        // `symlink_metadata` : un lien vers un dossier est supprimé comme un fichier (le lien
        // seul), jamais parcouru.
        let is_real_dir = std::fs::symlink_metadata(&full).map(|m| m.is_dir()).unwrap_or(false);
        if is_real_dir {
            std::fs::remove_dir_all(&full)
        } else {
            // Sous Windows, un lien vers un dossier (ou une jonction) se retire comme un
            // dossier : `remove_dir` n'enlève que le lien.
            std::fs::remove_file(&full).or_else(|e| if cfg!(windows) { std::fs::remove_dir(&full).map_err(|_| e) } else { Err(e) })
        }
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Tout annuler : index et copie de travail reviennent à HEAD, fichiers non suivis supprimés
/// (les fichiers ignorés sont conservés). Refusé dans un dépôt sans commit.
pub fn discard_all(path: &Path) -> Result<(), String> {
    check_dir(path)?;
    // Sans commit, tous les fichiers sont « non suivis » : `clean` effacerait tout le projet.
    if !has_head(path) {
        return Err("no_commit_to_restore".into());
    }
    run(Some(path), &["reset", "-q", "--hard"])?;
    run(Some(path), &["clean", "-q", "-f", "-d"]).map(|_| ())
}

/// Met toutes les modifications (non suivies comprises) de côté dans un stash.
pub fn stash_all(path: &Path, message: &str) -> Result<(), String> {
    check_dir(path)?;
    run(Some(path), &["stash", "push", "-q", "-u", "-m", message]).map(|_| ())
}

/// Stash partiel : seulement ces fichiers (suivis ou non), le reste ne bouge pas.
pub fn stash_files(path: &Path, message: &str, files: &[String]) -> Result<(), String> {
    check_dir(path)?;
    if files.is_empty() {
        return Err("no_files".into());
    }
    files.iter().try_for_each(|f| check_relative(f))?;
    run(Some(path), &with_paths(&["stash", "push", "-q", "-u", "-m", message], files)).map(|_| ())
}

// ---------------------------------------------------------------------------
// Blocs et lignes
// ---------------------------------------------------------------------------

/// Une ligne d'un diff : indice du hunk, puis indice de la ligne dans le hunk
/// (mêmes indices que `FileDiff.hunks[h].lines[l]` envoyé à l'interface).
#[derive(Deserialize, Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct LineRef {
    pub hunk: usize,
    pub line: usize,
}

/// Une ligne brute d'un hunk, avec son indice de `DiffLine` (absent pour `\ No newline`).
struct RawLine<'a> {
    index: Option<usize>,
    kind: char,
    raw: &'a str,
}

struct RawHunk<'a> {
    old_start: u32,
    new_start: u32,
    lines: Vec<RawLine<'a>>,
}

/// Découpe la sortie brute de `git diff` (un seul fichier) en en-tête et hunks, avec les
/// mêmes règles d'indexation des lignes que `history::parse_diff`.
fn split_raw(out: &str) -> (Vec<&str>, Vec<RawHunk<'_>>) {
    let mut header = vec![];
    let mut hunks: Vec<RawHunk> = vec![];
    let mut lines: Vec<&str> = out.split('\n').collect();
    if lines.last() == Some(&"") {
        lines.pop();
    }
    for line in lines {
        // `parse_diff` lit avec `str::lines()`, qui retire un `\r` final : même chose ici
        // pour le type de ligne, mais le texte brut (`raw`) garde ses octets.
        let trimmed = line.strip_suffix('\r').unwrap_or(line);
        if let Some(rest) = trimmed.strip_prefix("@@") {
            let (old_start, new_start) = parse_hunk_header(rest);
            hunks.push(RawHunk { old_start, new_start, lines: vec![] });
            continue;
        }
        let Some(h) = hunks.last_mut() else {
            header.push(line);
            continue;
        };
        let next = h.lines.iter().filter(|l| l.index.is_some()).count();
        match trimmed.chars().next() {
            Some(k @ ('+' | '-' | ' ')) => h.lines.push(RawLine { index: Some(next), kind: k, raw: line }),
            None => h.lines.push(RawLine { index: Some(next), kind: ' ', raw: " " }),
            Some('\\') => h.lines.push(RawLine { index: None, kind: '\\', raw: line }),
            _ => {}
        }
    }
    (header, hunks)
}

/// Construit un patch ne contenant que les changements sélectionnés.
///
/// - `reverse = false` (indexer : patch appliqué tel quel) : un `-` non sélectionné reste en
///   contexte, un `+` non sélectionné disparaît.
/// - `reverse = true` (retirer de l'index : patch appliqué avec `-R`) : l'inverse.
///
/// Les tailles des hunks sont recalculées ; les positions de départ restent celles du diff
/// d'origine (git applique avec `--recount`). `None` si rien n'est sélectionné.
fn build_patch(raw: &str, selected: &HashSet<LineRef>, reverse: bool) -> Option<String> {
    let (header, hunks) = split_raw(raw);
    let mut body = String::new();
    for (h, hunk) in hunks.iter().enumerate() {
        let is_sel = |l: &RawLine| l.index.is_some_and(|i| selected.contains(&LineRef { hunk: h, line: i }));
        if !hunk.lines.iter().any(|l| l.kind != ' ' && l.kind != '\\' && is_sel(l)) {
            continue;
        }
        let mut out: Vec<String> = vec![];
        let (mut old_n, mut new_n) = (0u32, 0u32);
        let mut prev_kept = false;
        for l in &hunk.lines {
            let keep_as = match (l.kind, is_sel(l), reverse) {
                (' ', _, _) => Some(' '),
                ('\\', _, _) => {
                    if prev_kept {
                        out.push(l.raw.to_string());
                    }
                    continue;
                }
                (k, true, _) => Some(k),
                ('-', false, false) | ('+', false, true) => Some(' '),
                _ => None,
            };
            prev_kept = keep_as.is_some();
            if let Some(k) = keep_as {
                if k != '+' {
                    old_n += 1;
                }
                if k != '-' {
                    new_n += 1;
                }
                out.push(format!("{k}{}", &l.raw[1..]));
            }
        }
        // Une plage vide commence à 0 (`-0,0`) ; si elle reçoit des lignes de contexte
        // (sélection partielle d'un fichier ajouté ou supprimé), elle commence à la ligne 1.
        let start = |s: u32, n: u32| if s == 0 && n > 0 { 1 } else { s };
        body.push_str(&format!(
            "@@ -{},{old_n} +{},{new_n} @@\n",
            start(hunk.old_start, old_n),
            start(hunk.new_start, new_n)
        ));
        for l in out {
            body.push_str(&l);
            body.push('\n');
        }
    }
    if body.is_empty() {
        return None;
    }
    let partial = hunks.iter().enumerate().any(|(h, hunk)| {
        hunk.lines.iter().any(|l| {
            (l.kind == '+' || l.kind == '-') && !l.index.is_some_and(|i| selected.contains(&LineRef { hunk: h, line: i }))
        })
    });
    let mut patch = if partial { as_modification(&header) } else { header.join("\n") };
    patch.push('\n');
    patch.push_str(&body);
    Some(patch)
}

/// En-tête d'un fichier ajouté ou supprimé, réécrit en simple modification : une sélection
/// partielle laisse le fichier exister des deux côtés (sinon git refuse le patch).
fn as_modification(header: &[&str]) -> String {
    let side = |prefix: &str| header.iter().find_map(|l| l.strip_prefix(prefix)).unwrap_or("");
    // `--- a/chemin` <-> `+++ b/chemin`, éventuellement entre guillemets.
    let swap = |name: &str, from: char, to: char| {
        let (quote, rest) = name.strip_prefix('"').map_or(("", name), |r| ("\"", r));
        let rest = rest.strip_prefix(from).and_then(|r| r.strip_prefix('/')).unwrap_or(rest);
        format!("{quote}{to}/{rest}")
    };
    header
        .iter()
        .filter(|l| !l.starts_with("new file mode") && !l.starts_with("deleted file mode"))
        .map(|l| match *l {
            "--- /dev/null" => format!("--- {}", swap(side("+++ "), 'b', 'a')),
            "+++ /dev/null" => format!("+++ {}", swap(side("--- "), 'a', 'b')),
            other => other.to_string(),
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Relit le diff et vérifie qu'il est toujours celui que l'interface a affiché.
fn current_diff(path: &Path, area: &str, file: &str, old_file: Option<&str>, expected: &str) -> Result<String, String> {
    let raw = run_raw(Some(path), &diff_args(area, file, old_file)?)?;
    if fingerprint(&raw) != expected {
        return Err("diff_changed".into());
    }
    Ok(raw)
}

/// Indexe (`unstage = false`) ou retire de l'index (`unstage = true`) les lignes choisies.
pub fn stage_lines(
    path: &Path,
    file: &str,
    old_file: Option<&str>,
    lines: &[LineRef],
    expected: &str,
    unstage: bool,
) -> Result<(), String> {
    check_dir(path)?;
    let area = if unstage { "staged" } else { "unstaged" };
    let raw = current_diff(path, area, file, old_file, expected)?;
    let selected: HashSet<LineRef> = lines.iter().copied().collect();
    let Some(patch) = build_patch(&raw, &selected, unstage) else { return Ok(()) };
    let mut args = vec!["apply", "--cached", "--recount", "--whitespace=nowarn"];
    if unstage {
        args.push("-R");
    }
    args.push("-");
    run_input(Some(path), &args, &patch).map(|_| ())
}

/// Abandonne les lignes choisies (changements non indexés) en réécrivant le fichier de travail.
pub fn discard_lines(path: &Path, file: &str, lines: &[LineRef], expected: &str) -> Result<(), String> {
    check_dir(path)?;
    check_relative(file)?;
    let raw = current_diff(path, "unstaged", file, None, expected)?;
    let selected: HashSet<LineRef> = lines.iter().copied().collect();
    let full = path.join(file);
    let bytes = std::fs::read(&full).map_err(|e| e.to_string())?;
    let content = String::from_utf8(bytes).map_err(|_| "unsupported_encoding".to_string())?;
    let next = revert_lines(&content, &raw, &selected)?;
    std::fs::write(&full, next).map_err(|e| e.to_string())
}

/// Applique à l'envers, sur le contenu du fichier de travail, les changements sélectionnés
/// du diff index → copie : un `+` sélectionné est supprimé, un `-` sélectionné est réinséré.
fn revert_lines(content: &str, raw: &str, selected: &HashSet<LineRef>) -> Result<String, String> {
    let (_, hunks) = split_raw(raw);
    let lines: Vec<&str> = content.split_inclusive('\n').collect();
    let crlf = lines.iter().filter(|l| l.ends_with("\r\n")).count() * 2 > lines.len();
    let eol = if crlf { "\r\n" } else { "\n" };

    let mut deleted: HashSet<usize> = HashSet::new();
    // Lignes à réinsérer avant la ligne d'indice (0-based) donné, dans l'ordre.
    let mut inserts: BTreeMap<usize, Vec<String>> = BTreeMap::new();
    for (h, hunk) in hunks.iter().enumerate() {
        let new_count = hunk.lines.iter().filter(|l| l.kind == ' ' || l.kind == '+').count();
        // Une plage vide (`+0,0`, fichier vidé) désigne la ligne *après laquelle* insérer.
        let mut pos = if new_count == 0 { hunk.new_start as usize } else { (hunk.new_start as usize).saturating_sub(1) };
        for (i, l) in hunk.lines.iter().enumerate() {
            let sel = l.index.is_some_and(|i| selected.contains(&LineRef { hunk: h, line: i }));
            match l.kind {
                ' ' => pos += 1,
                '+' => {
                    if sel {
                        deleted.insert(pos);
                    }
                    pos += 1;
                }
                '-' if sel => {
                    let text = l.raw[1..].strip_suffix('\r').unwrap_or(&l.raw[1..]);
                    // Suivie de « \ No newline at end of file » : l'ancienne dernière ligne
                    // n'avait pas de saut de ligne, elle revient sans (`push` en met un si
                    // d'autres lignes la suivent).
                    let unterminated = hunk.lines.get(i + 1).is_some_and(|next| next.kind == '\\');
                    inserts.entry(pos).or_default().push(format!("{text}{}", if unterminated { "" } else { eol }));
                }
                _ => {}
            }
        }
    }
    if deleted.iter().any(|&i| i >= lines.len()) || inserts.keys().any(|&i| i > lines.len()) {
        return Err("diff_changed".into());
    }

    let mut out = String::with_capacity(content.len());
    let push = |out: &mut String, chunk: &str| {
        // La dernière ligne d'un fichier peut ne pas finir par un saut de ligne.
        if !out.is_empty() && !out.ends_with('\n') {
            out.push_str(eol);
        }
        out.push_str(chunk);
    };
    for i in 0..=lines.len() {
        if let Some(ins) = inserts.get(&i) {
            for chunk in ins {
                push(&mut out, chunk);
            }
        }
        if i < lines.len() && !deleted.contains(&i) {
            push(&mut out, lines[i]);
        }
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------

/// Crée le commit (ou modifie le dernier avec `amend`) et renvoie son SHA.
pub fn commit(path: &Path, message: &str, amend: bool) -> Result<String, String> {
    check_dir(path)?;
    if message.trim().is_empty() {
        return Err("empty_message".into());
    }
    let mut args = vec!["commit", "-q", "-F", "-"];
    if amend {
        args.push("--amend");
    }
    // gpg-agent qui démarre : le premier essai échoue souvent, le suivant passe. Deux nouveaux
    // essais, une seconde d'écart, avant d'afficher l'erreur.
    let mut retries = 2;
    loop {
        match run_input(Some(path), &args, message) {
            Ok(_) => break,
            Err(e) if retries > 0 && crate::signing::is_transient_gpg_error(&e) => {
                retries -= 1;
                std::thread::sleep(std::time::Duration::from_secs(1));
            }
            Err(e) => return Err(classify_commit_error(&e)),
        }
    }
    run(Some(path), &["rev-parse", "HEAD"])
}

fn classify_commit_error(stderr: &str) -> String {
    if stderr.contains("Please tell me who you are") || stderr.contains("empty ident name") {
        "identity_missing".into()
    } else if stderr.contains("nothing to commit") || stderr.contains("no changes added to commit") {
        "nothing_to_commit".into()
    } else if crate::git::is_sign_error(stderr) {
        "sign_failed".into()
    } else {
        stderr.to_string()
    }
}

/// Message complet du dernier commit (pour pré-remplir un amend).
pub fn head_message(path: &Path) -> Result<String, String> {
    check_dir(path)?;
    run(Some(path), &["log", "-1", "--format=%B"])
}

/// Ajoute une ligne au `.gitignore` à la racine du dépôt (créé s'il n'existe pas), sauf si
/// elle y est déjà. Vrai si le fichier a changé.
/// Ne plus suivre un fichier sans le supprimer du disque (`rm --cached`) et l'ajouter au
/// `.gitignore`, pour qu'il ne revienne pas en fichier non suivi. Le retrait reste à commiter.
pub fn untrack_file(path: &Path, file: &str, pattern: &str) -> Result<(), String> {
    check_dir(path)?;
    check_relative(file)?;
    let files = [file.to_string()];
    run(Some(path), &with_paths(&["rm", "-q", "--cached"], &files)).map_err(|e| {
        // Contenu indexé différent à la fois de HEAD et du fichier : git refuse sans -f.
        if e.contains("staged content different") { "untrack_staged".to_string() } else { e }
    })?;
    add_to_gitignore(path, pattern).map(|_| ())
}

pub fn add_to_gitignore(repo: &Path, pattern: &str) -> Result<bool, String> {
    let pattern = pattern.trim_end_matches(['\r', '\n']);
    if pattern.is_empty() || pattern.contains(['\r', '\n']) {
        return Err("invalid pattern".into());
    }
    let file = repo.join(".gitignore");
    let current = match std::fs::read_to_string(&file) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(e.to_string()),
    };
    if current.lines().any(|l| l.trim_end() == pattern) {
        return Ok(false);
    }
    // Même fin de ligne que le reste du fichier.
    let eol = if current.contains("\r\n") { "\r\n" } else { "\n" };
    let mut text = current;
    if !text.is_empty() && !text.ends_with('\n') {
        text.push_str(eol);
    }
    text.push_str(pattern);
    text.push_str(eol);
    std::fs::write(&file, text).map_err(|e| e.to_string())?;
    Ok(true)
}

/// Au-delà, un fichier en conflit n'est pas ouvert dans la vue de résolution.
const CONFLICT_MAX_BYTES: usize = 5 * 1024 * 1024;

/// Contenu d'un fichier en conflit de la copie de travail (avec les marqueurs de git), pour la
/// vue de résolution. Refusé : absent (supprimé d'un côté), binaire, trop gros, pas en UTF-8.
pub fn conflict_text(path: &Path, file: &str) -> Result<String, String> {
    check_dir(path)?;
    let full = repo_file(path, file)?;
    let bytes = std::fs::read(&full).map_err(|_| "conflict_no_file".to_string())?;
    if bytes.len() > CONFLICT_MAX_BYTES {
        return Err("conflict_too_large".into());
    }
    if bytes.contains(&0) {
        return Err("conflict_binary".into());
    }
    String::from_utf8(bytes).map_err(|_| "conflict_not_utf8".into())
}

/// Les trois versions d'un fichier en conflit, pour la vue en 3 panneaux : la version commune
/// (`None` : ajouté des deux côtés), la nôtre, l'autre — telles que git les a gardées dans
/// l'index (étapes 1, 2, 3), avec les filtres de la copie de travail (fins de ligne) — et le
/// fichier de la copie de travail, avec ses marqueurs (noms des côtés, fins de ligne).
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ConflictVersions {
    pub base: Option<String>,
    pub ours: String,
    pub theirs: String,
    pub working: String,
}

/// Refusé comme [`conflict_text`], et `conflict_deleted` si le fichier a été supprimé d'un
/// côté (pas de version « nôtre » ou « autre » dans l'index).
pub fn conflict_versions(path: &Path, file: &str) -> Result<ConflictVersions, String> {
    let working = conflict_text(path, file)?;
    let out = run_raw(Some(path), &["ls-files", "-u", "-z", "--", file])?;
    let mut stages: [Option<String>; 3] = [None, None, None];
    for entry in out.split('\0').filter(|e| !e.is_empty()) {
        // « mode sha étape\tchemin »
        let Some((meta, name)) = entry.split_once('\t') else { continue };
        if name != file {
            continue;
        }
        let mut parts = meta.split(' ');
        let (_, Some(sha), Some(stage)) = (parts.next(), parts.next(), parts.next()) else { continue };
        if let Ok(n @ 1..=3) = stage.parse::<usize>() {
            stages[n - 1] = Some(sha.to_string());
        }
    }
    let blob = |sha: &Option<String>| -> Result<Option<String>, String> {
        let Some(sha) = sha else { return Ok(None) };
        let text = run_raw(Some(path), &["cat-file", "--filters", &format!("--path={file}"), sha])?;
        if text.len() > CONFLICT_MAX_BYTES {
            return Err("conflict_too_large".into());
        }
        if text.contains('\0') {
            return Err("conflict_binary".into());
        }
        // Sortie de git décodée avec perte : un caractère de remplacement absent de la copie de
        // travail trahit une version qui n'est pas en UTF-8 (elle serait abîmée à l'écriture).
        if text.contains('\u{FFFD}') && !working.contains('\u{FFFD}') {
            return Err("conflict_not_utf8".into());
        }
        Ok(Some(text))
    };
    let [base, ours, theirs] = &stages;
    let (Some(ours), Some(theirs)) = (blob(ours)?, blob(theirs)?) else {
        return Err("conflict_deleted".into());
    };
    Ok(ConflictVersions { base: blob(base)?, ours, theirs, working })
}

/// Écrit la résolution d'un conflit dans la copie de travail et la marque résolue (`git add`).
pub fn resolve_conflict(path: &Path, file: &str, content: &str) -> Result<(), String> {
    check_dir(path)?;
    let full = repo_file(path, file)?;
    std::fs::write(&full, content).map_err(|e| e.to_string())?;
    stage_files(path, &[file.to_string()])
}

/// Fichier `file` (chemin relatif du dépôt, comme Git le donne) de la copie de travail,
/// refusé s'il sort du dépôt (`..`, chemin absolu, lien) : `outside_repo`.
pub fn repo_file(repo: &Path, file: &str) -> Result<PathBuf, String> {
    let rel = Path::new(file);
    if rel.is_absolute() || rel.components().any(|c| !matches!(c, std::path::Component::Normal(_))) {
        return Err("outside_repo".into());
    }
    let root = repo.canonicalize().map_err(|_| "path_not_found".to_string())?;
    let full = root.join(rel);
    // Ce qui existe déjà du chemin doit rester dans le dépôt (pas de lien vers ailleurs).
    if let Some(existing) = full.ancestors().find(|a| a.exists()) {
        let real = existing.canonicalize().map_err(|e| e.to_string())?;
        if !real.starts_with(&root) {
            return Err("outside_repo".into());
        }
    }
    // Le chemin tel que le dépôt est connu, pas sa forme canonique (`\\?\H:\…` sous
    // Windows, que l'explorateur ne comprend pas toujours).
    Ok(repo.join(rel))
}

/// Dossier à montrer pour un fichier : le sien, ou le premier parent qui existe encore
/// (fichier supprimé, dossier supprimé avec lui).
pub fn existing_dir(full: &Path, root: &Path) -> PathBuf {
    full.ancestors()
        .skip(1)
        .find(|a| a.is_dir())
        .map(Path::to_path_buf)
        .unwrap_or_else(|| root.to_path_buf())
}

/// Identité d'un commit (auteur).
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CommitIdentity {
    pub name: String,
    pub email: String,
}

/// Identité qu'aurait un commit fait maintenant dans ce dépôt : celle du profil actif (injectée
/// par `git::run`), sinon la configuration git. `None` si git n'en trouve aucune (il refuserait
/// le commit).
pub fn commit_identity(path: &Path) -> Result<Option<CommitIdentity>, String> {
    Ok(run(Some(path), &["var", "GIT_AUTHOR_IDENT"]).ok().and_then(|out| parse_ident(&out)))
}

/// « Nom <e-mail> horodatage fuseau » → nom et e-mail.
fn parse_ident(line: &str) -> Option<CommitIdentity> {
    let (name, rest) = line.split_once(" <")?;
    let (email, _) = rest.split_once('>')?;
    Some(CommitIdentity { name: name.trim().to_string(), email: email.trim().to_string() })
}

#[cfg(test)]
mod tests {
    #[test]
    fn add_to_gitignore_appends_once() {
        let dir = std::env::temp_dir().join(format!("gitgr-ignore-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert!(add_to_gitignore(&dir, "/a.log").unwrap());
        assert!(!add_to_gitignore(&dir, "/a.log").unwrap());
        std::fs::write(dir.join(".gitignore"), "x\r\ny").unwrap();
        assert!(add_to_gitignore(&dir, "*.tmp").unwrap());
        assert_eq!(std::fs::read_to_string(dir.join(".gitignore")).unwrap(), "x\r\ny\r\n*.tmp\r\n");
        assert!(add_to_gitignore(&dir, "a\nb").is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn repo_file_stays_inside_the_repo() {
        let dir = std::env::temp_dir().join(format!("gitgr-repo-file-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("src")).unwrap();
        std::fs::write(dir.join("src/a.txt"), "a").unwrap();
        assert_eq!(repo_file(&dir, "src/a.txt").unwrap(), dir.join("src/a.txt"));
        // Supprimé : chemin rendu quand même, son dossier existant le plus proche montré.
        let gone = repo_file(&dir, "old/b.txt").unwrap();
        assert_eq!(existing_dir(&gone, &dir), dir);
        assert_eq!(existing_dir(&dir.join("src/a.txt"), &dir), dir.join("src"));
        assert_eq!(repo_file(&dir, "../x").unwrap_err(), "outside_repo");
        assert_eq!(repo_file(&dir, "src/../../x").unwrap_err(), "outside_repo");
        let abs = if cfg!(windows) { "C:/Windows" } else { "/etc" };
        assert_eq!(repo_file(&dir, abs).unwrap_err(), "outside_repo");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    use super::*;
    use crate::git::tests::{commit_file, temp_repo};

    fn git(repo: &Path, args: &[&str]) -> String {
        run(Some(repo), args).unwrap()
    }

    fn write(repo: &Path, name: &str, content: &str) {
        let p = repo.join(name);
        if let Some(dir) = p.parent() {
            std::fs::create_dir_all(dir).unwrap();
        }
        std::fs::write(p, content).unwrap();
    }

    fn read(repo: &Path, name: &str) -> String {
        std::fs::read_to_string(repo.join(name)).unwrap()
    }

    /// Contenu indexé d'un fichier.
    fn staged(repo: &Path, name: &str) -> String {
        run_raw(Some(repo), &["show", &format!(":{name}")]).unwrap()
    }

    fn sel(pairs: &[(usize, usize)]) -> Vec<LineRef> {
        pairs.iter().map(|&(hunk, line)| LineRef { hunk, line }).collect()
    }

    /// Indices des lignes modifiées (`+`/`-`) d'un hunk.
    fn changed(d: &FileDiff, h: usize) -> Vec<(usize, String, String)> {
        d.hunks[h]
            .lines
            .iter()
            .enumerate()
            .filter(|(_, l)| l.kind != " ")
            .map(|(i, l)| (i, l.kind.clone(), l.text.clone()))
            .collect()
    }

    #[test]
    fn commit_identity_reads_the_author_git_would_use() {
        assert_eq!(
            parse_ident("Gaëtan R <g@exemple.fr> 1700000000 +0100"),
            Some(CommitIdentity { name: "Gaëtan R".into(), email: "g@exemple.fr".into() })
        );
        assert_eq!(parse_ident("n'importe quoi"), None);
        let repo = crate::git::tests::temp_repo();
        let p = repo.path();
        run(Some(p), &["config", "user.name", "Locale"]).unwrap();
        run(Some(p), &["config", "user.email", "locale@exemple.fr"]).unwrap();
        assert_eq!(commit_identity(p).unwrap(), Some(CommitIdentity { name: "Locale".into(), email: "locale@exemple.fr".into() }));
    }

    #[test]
    fn conflict_read_then_resolved() {
        let repo = crate::git::tests::temp_repo();
        let p = repo.path();
        crate::git::tests::commit_file(p, "c.txt", "un\n");
        run(Some(p), &["checkout", "-q", "-b", "autre"]).unwrap();
        crate::git::tests::commit_file(p, "c.txt", "deux\n");
        run(Some(p), &["checkout", "-q", "-"]).unwrap();
        crate::git::tests::commit_file(p, "c.txt", "trois\n");
        assert!(run(Some(p), &["merge", "-q", "autre"]).is_err());
        let text = conflict_text(p, "c.txt").unwrap();
        assert!(text.contains("<<<<<<<") && text.contains("deux") && text.contains("trois"));
        assert_eq!(status(p).unwrap().conflicted.len(), 1);

        resolve_conflict(p, "c.txt", "deux\ntrois\n").unwrap();
        assert_eq!(std::fs::read_to_string(p.join("c.txt")).unwrap(), "deux\ntrois\n");
        let s = status(p).unwrap();
        assert!(s.conflicted.is_empty());
        assert_eq!(s.staged[0].path, "c.txt");

        assert_eq!(conflict_text(p, "absent.txt").unwrap_err(), "conflict_no_file");
        assert_eq!(conflict_versions(p, "absent.txt").unwrap_err(), "conflict_no_file");
        assert_eq!(conflict_text(p, "../x").unwrap_err(), "outside_repo");
        std::fs::write(p.join("b.bin"), [0u8, 1, 2]).unwrap();
        assert_eq!(conflict_text(p, "b.bin").unwrap_err(), "conflict_binary");
    }

    #[test]
    fn conflict_versions_reads_the_three_stages() {
        let repo = crate::git::tests::temp_repo();
        let p = repo.path();
        crate::git::tests::commit_file(p, "c.txt", "un\ndeux\n");
        run(Some(p), &["checkout", "-q", "-b", "autre"]).unwrap();
        crate::git::tests::commit_file(p, "c.txt", "un\nDEUX\n");
        crate::git::tests::commit_file(p, "n.txt", "à eux\n");
        run(Some(p), &["checkout", "-q", "-"]).unwrap();
        crate::git::tests::commit_file(p, "c.txt", "un\ndeux ici\n");
        crate::git::tests::commit_file(p, "n.txt", "à nous\n");
        assert!(run(Some(p), &["merge", "-q", "autre"]).is_err());

        let v = conflict_versions(p, "c.txt").unwrap();
        assert_eq!(v.base.as_deref(), Some("un\ndeux\n"));
        assert_eq!(v.ours, "un\ndeux ici\n");
        assert_eq!(v.theirs, "un\nDEUX\n");
        assert!(v.working.contains("<<<<<<<"));
        // Ajouté des deux côtés : pas de version commune.
        let n = conflict_versions(p, "n.txt").unwrap();
        assert_eq!(n.base, None);
        assert_eq!((n.ours.as_str(), n.theirs.as_str()), ("à nous\n", "à eux\n"));
    }

    #[test]
    fn conflict_versions_refuses_a_file_deleted_on_one_side() {
        let repo = crate::git::tests::temp_repo();
        let p = repo.path();
        crate::git::tests::commit_file(p, "c.txt", "un\n");
        run(Some(p), &["checkout", "-q", "-b", "autre"]).unwrap();
        run(Some(p), &["rm", "-q", "c.txt"]).unwrap();
        run(Some(p), &["commit", "-q", "-m", "suppr"]).unwrap();
        run(Some(p), &["checkout", "-q", "-"]).unwrap();
        crate::git::tests::commit_file(p, "c.txt", "deux\n");
        assert!(run(Some(p), &["merge", "-q", "autre"]).is_err());
        assert_eq!(conflict_versions(p, "c.txt").unwrap_err(), "conflict_deleted");
    }

    #[test]
    fn parses_porcelain_v2_z() {
        let out = "1 .M N... 100644 100644 100644 a b src/x.rs\0\
                   1 A. N... 000000 100644 100644 0 b nouveau.txt\0\
                   1 MM N... 100644 100644 100644 a b les deux.txt\0\
                   2 R. N... 100644 100644 100644 a b R100 neuf.rs\0vieux.rs\0\
                   u UU N... 100644 100644 100644 100644 a b c conflit.txt\0\
                   ? non suivi.txt\0";
        let s = parse_status(out);
        let st: Vec<_> = s.staged.iter().map(|f| (f.status.as_str(), f.path.as_str())).collect();
        assert_eq!(st, vec![("A", "nouveau.txt"), ("M", "les deux.txt"), ("R", "neuf.rs")]);
        assert_eq!(s.staged[2].old_path.as_deref(), Some("vieux.rs"));
        let un: Vec<_> = s.unstaged.iter().map(|f| (f.status.as_str(), f.path.as_str())).collect();
        assert_eq!(un, vec![("M", "src/x.rs"), ("M", "les deux.txt"), ("?", "non suivi.txt")]);
        assert_eq!(s.conflicted[0].path, "conflit.txt");
    }

    #[test]
    fn builds_partial_patches_both_ways() {
        let raw = "diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n";
        // Indices : 0 " a", 1 "-b", 2 "+B", 3 " c".
        let only_add: HashSet<_> = sel(&[(0, 2)]).into_iter().collect();
        let p = build_patch(raw, &only_add, false).unwrap();
        assert!(p.ends_with("@@ -1,3 +1,4 @@\n a\n b\n+B\n c\n"), "{p}");
        let p = build_patch(raw, &only_add, true).unwrap();
        assert!(p.ends_with("@@ -1,2 +1,3 @@\n a\n+B\n c\n"), "{p}");
        assert!(build_patch(raw, &HashSet::new(), false).is_none());
        // Une ligne de contexte seule ne déclenche rien.
        let ctx: HashSet<_> = sel(&[(0, 0)]).into_iter().collect();
        assert!(build_patch(raw, &ctx, false).is_none());
    }

    #[test]
    fn status_of_a_real_repo() {
        let repo = temp_repo();
        let p = repo.path();
        commit_file(p, "a.txt", "1\n");
        write(p, "a.txt", "2\n");
        write(p, "dir/b.txt", "x\n");
        write(p, "c.txt", "c\n");
        git(p, &["add", "c.txt"]);
        let s = status(p).unwrap();
        assert_eq!(s.staged, vec![file("c.txt", None, 'A')]);
        assert_eq!(s.unstaged, vec![file("a.txt", None, 'M'), file("dir/b.txt", None, '?')]);
    }

    #[test]
    fn stash_files_keeps_the_others() {
        let repo = temp_repo();
        let p = repo.path();
        commit_file(p, "a.txt", "1
");
        commit_file(p, "b.txt", "1
");
        write(p, "a.txt", "2
");
        write(p, "b.txt", "2
");
        write(p, "neuf.txt", "n
");
        stash_files(p, "partiel", &["a.txt".into(), "neuf.txt".into()]).unwrap();
        let s = status(p).unwrap();
        assert_eq!(s.unstaged, vec![file("b.txt", None, 'M')]);
        assert!(!p.join("neuf.txt").exists());
        assert!(stash_files(p, "x", &["../x".into()]).is_err());
    }

    #[test]
    fn untrack_keeps_the_file_and_ignores_it() {
        let repo = temp_repo();
        let p = repo.path();
        commit_file(p, "app.log", "1
");
        write(p, "app.log", "2
");
        untrack_file(p, "app.log", "/app.log").unwrap();
        assert!(p.join("app.log").exists());
        let s = status(p).unwrap();
        // Retrait indexé, à commiter ; le fichier ne revient pas en non suivi.
        assert_eq!(s.staged, vec![file("app.log", None, 'D')]);
        assert_eq!(s.unstaged, vec![file(".gitignore", None, '?')]);
        assert!(untrack_file(p, "../x", "/x").is_err());
    }

    #[test]
    fn stage_and_unstage_files_including_before_first_commit() {
        let repo = temp_repo();
        let p = repo.path();
        write(p, "a.txt", "1\n");
        stage_files(p, &["a.txt".into()]).unwrap();
        assert_eq!(status(p).unwrap().staged.len(), 1);
        unstage_files(p, &["a.txt".into()]).unwrap(); // pas encore de HEAD
        assert_eq!(status(p).unwrap().unstaged, vec![file("a.txt", None, '?')]);

        stage_all(p).unwrap();
        commit(p, "premier", false).unwrap();
        std::fs::remove_file(p.join("a.txt")).unwrap();
        stage_files(p, &["a.txt".into()]).unwrap(); // suppression indexée
        assert_eq!(status(p).unwrap().staged, vec![file("a.txt", None, 'D')]);
        unstage_all(p).unwrap();
        assert_eq!(status(p).unwrap().unstaged, vec![file("a.txt", None, 'D')]);
    }

    #[test]
    fn stage_single_lines_then_unstage_them() {
        let repo = temp_repo();
        let p = repo.path();
        commit_file(p, "f.txt", "un\ndeux\ntrois\nquatre\n");
        write(p, "f.txt", "un\nDEUX\ntrois\nquatre\ncinq\n");

        let d = file_diff(p, "f.txt", None, "unstaged", false, false).unwrap();
        let ch = changed(&d, 0);
        // -deux, +DEUX, +cinq
        assert_eq!(ch.iter().map(|c| c.2.as_str()).collect::<Vec<_>>(), vec!["deux", "DEUX", "cinq"]);
        // N'indexe que l'ajout de « cinq ».
        stage_lines(p, "f.txt", None, &sel(&[(0, ch[2].0)]), &d.fingerprint, false).unwrap();
        assert_eq!(staged(p, "f.txt"), "un\ndeux\ntrois\nquatre\ncinq\n");
        assert_eq!(read(p, "f.txt"), "un\nDEUX\ntrois\nquatre\ncinq\n", "copie de travail intacte");

        // Puis indexe le remplacement deux → DEUX (suppression et ajout).
        let d = file_diff(p, "f.txt", None, "unstaged", false, false).unwrap();
        let ch = changed(&d, 0);
        let all: Vec<_> = ch.iter().map(|c| (0, c.0)).collect();
        stage_lines(p, "f.txt", None, &sel(&all), &d.fingerprint, false).unwrap();
        assert!(status(p).unwrap().unstaged.is_empty());

        // Retire de l'index la seule ligne « cinq ».
        let d = file_diff(p, "f.txt", None, "staged", false, false).unwrap();
        let cinq = changed(&d, 0).into_iter().find(|c| c.2 == "cinq").unwrap();
        stage_lines(p, "f.txt", None, &sel(&[(0, cinq.0)]), &d.fingerprint, true).unwrap();
        assert_eq!(staged(p, "f.txt"), "un\nDEUX\ntrois\nquatre\n");
    }

    #[test]
    fn ignore_whitespace_hides_space_only_changes() {
        let repo = temp_repo();
        let p = repo.path();
        commit_file(p, "f.txt", "un\ndeux\ntrois\n");
        write(p, "f.txt", "un\n  deux  \nTROIS\n");
        let all = file_diff(p, "f.txt", None, "unstaged", false, false).unwrap();
        assert_eq!(changed(&all, 0).len(), 4);
        // Avec -w, seul trois → TROIS reste.
        let ws = file_diff(p, "f.txt", None, "unstaged", true, false).unwrap();
        let ch = changed(&ws, 0);
        assert_eq!(ch.iter().map(|c| c.2.as_str()).collect::<Vec<_>>(), vec!["trois", "TROIS"]);
    }

    #[test]
    fn partial_unstage_of_a_new_file_keeps_it_staged() {
        let repo = temp_repo();
        let p = repo.path();
        commit_file(p, "base.txt", "x\n");
        write(p, "nouveau.txt", "un\ndeux\ntrois\n");
        stage_files(p, &["nouveau.txt".into()]).unwrap();
        let d = file_diff(p, "nouveau.txt", None, "staged", false, false).unwrap();
        // Retire seulement « deux » de l'index.
        stage_lines(p, "nouveau.txt", None, &sel(&[(0, 1)]), &d.fingerprint, true).unwrap();
        assert_eq!(staged(p, "nouveau.txt"), "un\ntrois\n");
        assert_eq!(status(p).unwrap().staged, vec![file("nouveau.txt", None, 'A')]);

        // Puis tout le reste : le fichier n'est plus indexé du tout.
        let d = file_diff(p, "nouveau.txt", None, "staged", false, false).unwrap();
        let all: Vec<_> = changed(&d, 0).iter().map(|c| (0, c.0)).collect();
        stage_lines(p, "nouveau.txt", None, &sel(&all), &d.fingerprint, true).unwrap();
        assert!(status(p).unwrap().staged.is_empty());
    }

    #[test]
    fn partial_stage_of_a_deleted_file() {
        let repo = temp_repo();
        let p = repo.path();
        commit_file(p, "f.txt", "a\nb\n");
        std::fs::remove_file(p.join("f.txt")).unwrap();
        let d = file_diff(p, "f.txt", None, "unstaged", false, false).unwrap();
        // N'indexe que la suppression de « a ».
        stage_lines(p, "f.txt", None, &sel(&[(0, 0)]), &d.fingerprint, false).unwrap();
        assert_eq!(staged(p, "f.txt"), "b\n");
    }

    #[test]
    fn line_actions_refuse_a_diff_that_changed() {
        let repo = temp_repo();
        let p = repo.path();
        commit_file(p, "f.txt", "a\n");
        write(p, "f.txt", "b\n");
        let d = file_diff(p, "f.txt", None, "unstaged", false, false).unwrap();
        write(p, "f.txt", "c\n");
        let err = stage_lines(p, "f.txt", None, &sel(&[(0, 1)]), &d.fingerprint, false).unwrap_err();
        assert_eq!(err, "diff_changed");
        assert_eq!(discard_lines(p, "f.txt", &sel(&[(0, 1)]), &d.fingerprint).unwrap_err(), "diff_changed");
    }

    #[test]
    fn discard_lines_rewrites_only_selected_changes() {
        let repo = temp_repo();
        let p = repo.path();
        commit_file(p, "f.txt", "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12\n");
        // Deux hunks : 2 → deux (+ ajout), et 11 supprimé.
        write(p, "f.txt", "1\ndeux\nnouveau\n3\n4\n5\n6\n7\n8\n9\n10\n12\n");
        let d = file_diff(p, "f.txt", None, "unstaged", false, false).unwrap();
        assert_eq!(d.hunks.len(), 2);
        let h0 = changed(&d, 0); // -2, +deux, +nouveau
        let h1 = changed(&d, 1); // -11
        // Abandonne « +nouveau » et « -11 » ; garde 2 → deux.
        discard_lines(p, "f.txt", &sel(&[(0, h0[2].0), (1, h1[0].0)]), &d.fingerprint).unwrap();
        assert_eq!(read(p, "f.txt"), "1\ndeux\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12\n");

        // Abandonne le reste : retour au contenu indexé.
        let d = file_diff(p, "f.txt", None, "unstaged", false, false).unwrap();
        let all: Vec<_> = changed(&d, 0).iter().map(|c| (0, c.0)).collect();
        discard_lines(p, "f.txt", &sel(&all), &d.fingerprint).unwrap();
        assert!(status(p).unwrap().unstaged.is_empty());
    }

    #[test]
    fn discard_lines_keeps_crlf_endings() {
        let repo = temp_repo();
        let p = repo.path();
        git(p, &["config", "core.autocrlf", "true"]);
        commit_file(p, "f.txt", "a\r\nb\r\nc\r\n");
        write(p, "f.txt", "a\r\nB\r\nc\r\nd\r\n");
        let d = file_diff(p, "f.txt", None, "unstaged", false, false).unwrap();
        let ch = changed(&d, 0); // -b, +B, +d
        assert_eq!(ch.len(), 3);
        discard_lines(p, "f.txt", &sel(&[(0, ch[0].0), (0, ch[1].0)]), &d.fingerprint).unwrap();
        assert_eq!(read(p, "f.txt"), "a\r\nb\r\nc\r\nd\r\n");
    }

    #[test]
    fn revert_handles_missing_final_newline() {
        let raw = "@@ -1,2 +1,3 @@\n a\n b\n+c\n\\ No newline at end of file\n";
        let s: HashSet<_> = sel(&[(0, 2)]).into_iter().collect();
        assert_eq!(revert_lines("a\nb\nc", raw, &s).unwrap(), "a\nb\n");
        let raw = "@@ -1,2 +1,1 @@\n a\n-b\n";
        let s: HashSet<_> = sel(&[(0, 1)]).into_iter().collect();
        assert_eq!(revert_lines("a", raw, &s).unwrap(), "a\nb\n");
        // L'ancienne dernière ligne n'avait pas de saut de ligne : elle revient telle quelle.
        let raw = "@@ -1,2 +1,2 @@\n a\n-b\n\\ No newline at end of file\n+B\n\\ No newline at end of file\n";
        let s: HashSet<_> = sel(&[(0, 1), (0, 2)]).into_iter().collect();
        assert_eq!(revert_lines("a\nB", raw, &s).unwrap(), "a\nb");
        let only_removed: HashSet<_> = sel(&[(0, 1)]).into_iter().collect();
        assert_eq!(revert_lines("a\nB", raw, &only_removed).unwrap(), "a\nb\nB");
    }

    #[test]
    fn discarding_all_lines_restores_a_file_without_final_newline() {
        let repo = temp_repo();
        let p = repo.path();
        commit_file(p, "f.txt", "a\nb");
        write(p, "f.txt", "a\nB");
        let d = file_diff(p, "f.txt", None, "unstaged", false, false).unwrap();
        let all: Vec<_> = changed(&d, 0).iter().map(|c| (0, c.0)).collect();
        discard_lines(p, "f.txt", &sel(&all), &d.fingerprint).unwrap();
        assert_eq!(read(p, "f.txt"), "a\nb");
        assert!(status(p).unwrap().unstaged.is_empty());
    }

    #[test]
    fn line_staging_ignores_diff_prefix_settings() {
        let repo = temp_repo();
        let p = repo.path();
        write(p, "src/f.txt", "un\ndeux\n");
        write(p, "f.txt", "racine\n");
        stage_all(p).unwrap();
        commit(p, "base", false).unwrap();
        // Sans `a/` `b/`, `git apply` retirerait `src/` du chemin et viserait `f.txt`.
        git(p, &["config", "diff.noprefix", "true"]);
        git(p, &["config", "diff.mnemonicPrefix", "true"]);
        write(p, "src/f.txt", "un\ndeux\ntrois\n");
        let d = file_diff(p, "src/f.txt", None, "unstaged", false, false).unwrap();
        let all: Vec<_> = changed(&d, 0).iter().map(|c| (0, c.0)).collect();
        stage_lines(p, "src/f.txt", None, &sel(&all), &d.fingerprint, false).unwrap();
        assert_eq!(staged(p, "src/f.txt"), "un\ndeux\ntrois\n");
        assert_eq!(staged(p, "f.txt"), "racine\n");
    }

    #[cfg(windows)]
    #[test]
    fn discarding_a_folder_link_removes_only_the_link() {
        let repo = temp_repo();
        let p = repo.path();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("garde.txt"), "x").unwrap();
        let link = p.join("lien");
        let made = crate::git::quiet_command("cmd").arg("/C").arg("mklink").arg("/J").arg(&link).arg(outside.path()).output();
        if !made.is_ok_and(|o| o.status.success()) {
            eprintln!("jonction impossible à créer : test sauté");
            return;
        }
        discard_files(p, &[], &["lien".into()]).unwrap();
        assert!(std::fs::symlink_metadata(&link).is_err(), "le lien est retiré");
        assert!(outside.path().join("garde.txt").exists(), "son contenu est intact");
    }

    #[test]
    fn paths_outside_the_repo_are_refused() {
        for bad in ["", ".", "..", "../x", "a/../../x", "/x"] {
            assert_eq!(check_relative(bad).unwrap_err(), "invalid_path", "{bad:?}");
        }
        if cfg!(windows) {
            for bad in ["\\x", "C:x", "C:\\x", "a\\..\\x"] {
                assert_eq!(check_relative(bad).unwrap_err(), "invalid_path", "{bad:?}");
            }
        }
        for good in ["a.txt", "dir/b c.txt", "sous/module/", "..a/b..", "[ab].txt"] {
            assert!(check_relative(good).is_ok(), "{good:?}");
        }
    }

    #[test]
    fn untracked_files_show_as_added_and_can_be_discarded() {
        let repo = temp_repo();
        let p = repo.path();
        commit_file(p, "a.txt", "1\n");
        write(p, "n.txt", "x\ny\n");
        write(p, "d/bin.dat", "\0\0\0");
        let d = file_diff(p, "n.txt", None, "untracked", false, false).unwrap();
        assert_eq!(d.hunks[0].lines.len(), 2);
        assert!(d.hunks[0].lines.iter().all(|l| l.kind == "+"));
        assert!(file_diff(p, "d/bin.dat", None, "untracked", false, false).unwrap().binary);
        assert_eq!(file_diff(p, "../ailleurs.txt", None, "untracked", false, false).unwrap_err(), "invalid_path");

        write(p, "a.txt", "2\n");
        discard_files(p, &["a.txt".into()], &["n.txt".into(), "d/bin.dat".into()]).unwrap();
        assert_eq!(read(p, "a.txt"), "1\n");
        assert_eq!(status(p).unwrap(), WorkStatus::default());
        assert_eq!(discard_files(p, &[], &["../x".into()]).unwrap_err(), "invalid_path");
        // Un chemin refusé en fin de liste : rien n'est annulé ni supprimé avant lui.
        write(p, "a.txt", "3\n");
        write(p, "garde.txt", "x\n");
        assert_eq!(discard_files(p, &["a.txt".into()], &["garde.txt".into(), "".into()]).unwrap_err(), "invalid_path");
        assert_eq!(read(p, "a.txt"), "3\n");
        assert!(p.join("garde.txt").exists());
    }

    #[test]
    fn discard_all_and_stash_all() {
        let repo = temp_repo();
        let p = repo.path();
        commit_file(p, ".gitignore", "*.log\n");
        commit_file(p, "a.txt", "1\n");
        write(p, "a.txt", "2\n");
        write(p, "new.txt", "n\n");
        write(p, "keep.log", "ignoré\n");
        stash_all(p, "GitGR : test").unwrap();
        assert_eq!(status(p).unwrap(), WorkStatus::default());
        assert!(git(p, &["stash", "list"]).contains("GitGR : test"));

        write(p, "a.txt", "3\n");
        write(p, "new.txt", "n\n");
        discard_all(p).unwrap();
        let empty = temp_repo();
        write(empty.path(), "projet.txt", "à garder\n");
        assert_eq!(discard_all(empty.path()).unwrap_err(), "no_commit_to_restore");
        assert!(empty.path().join("projet.txt").exists());
        assert_eq!(status(p).unwrap(), WorkStatus::default());
        assert!(p.join("keep.log").exists(), "les fichiers ignorés sont conservés");
    }

    #[test]
    fn commit_and_amend() {
        let repo = temp_repo();
        let p = repo.path();
        write(p, "a.txt", "1\n");
        assert_eq!(commit(p, "  \n", false).unwrap_err(), "empty_message");
        stage_all(p).unwrap();
        let first = commit(p, "Titre\n\nCorps avec « accents »", false).unwrap();
        assert_eq!(first.len(), 40);
        assert_eq!(head_message(p).unwrap(), "Titre\n\nCorps avec « accents »");
        assert_eq!(commit(p, "rien", false).unwrap_err(), "nothing_to_commit");

        let amended = commit(p, "Titre corrigé", true).unwrap();
        assert_ne!(amended, first);
        assert_eq!(git(p, &["rev-list", "--count", "HEAD"]), "1");
        assert_eq!(head_message(p).unwrap(), "Titre corrigé");
    }

    #[test]
    fn commit_without_identity_has_a_clear_error() {
        let repo = temp_repo();
        let p = repo.path();
        write(p, "a.txt", "1\n");
        stage_all(p).unwrap();
        // Identité vide au niveau du dépôt (prend le pas sur la config globale).
        git(p, &["config", "user.name", ""]);
        git(p, &["config", "user.email", ""]);
        git(p, &["config", "user.useConfigOnly", "true"]);
        assert_eq!(commit(p, "x", false).unwrap_err(), "identity_missing");
    }
}
