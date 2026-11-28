// Ouvrir un fichier du dépôt dans l'éditeur choisi dans les réglages (ligne de commande :
// `code`, `"C:\Program Files\…\idea64.exe" --line 1 {file}`…), plutôt qu'avec le programme
// associé du système.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// Découpe une ligne de commande : mots séparés par des espaces, guillemets doubles ou simples
/// pour un mot qui en contient (chemin Windows avec espaces). Pas d'échappement par `\` : les
/// chemins Windows en sont pleins.
pub fn split_command(line: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut quote: Option<char> = None;
    let mut started = false;
    for c in line.chars() {
        match quote {
            Some(q) if c == q => quote = None,
            Some(_) => cur.push(c),
            // Une apostrophe au milieu d'un mot (`D'Arc`) en fait partie.
            None if c == '"' || (c == '\'' && !started) => {
                quote = Some(c);
                started = true;
            }
            None if c.is_whitespace() => {
                if started {
                    out.push(std::mem::take(&mut cur));
                    started = false;
                }
            }
            None => {
                cur.push(c);
                started = true;
            }
        }
    }
    if started {
        out.push(cur);
    }
    out
}

/// Programme et arguments pour ouvrir `file` : `{file}` remplacé par le chemin, sinon le
/// chemin ajouté à la fin ; `{line}` par la ligne (1 sans ligne). `None` si la commande est vide.
pub fn editor_args(editor: &str, file: &Path, line: Option<u32>) -> Option<(String, Vec<String>)> {
    let mut words = split_command(editor);
    if words.is_empty() {
        return None;
    }
    let program = words.remove(0);
    let path = file.to_string_lossy().to_string();
    let mut placed = false;
    let line = line.unwrap_or(1).to_string();
    for w in words.iter_mut() {
        if w.contains("{line}") {
            *w = w.replace("{line}", &line);
        }
        if w.contains("{file}") {
            *w = w.replace("{file}", &path);
            placed = true;
        }
    }
    if !placed {
        words.push(path);
    }
    Some((program, words))
}

/// Programme cherché dans le `PATH` (Windows : avec les extensions de `PATHEXT`, pour `code`
/// qui est un `code.cmd`) ; tel quel s'il a un chemin ou n'est pas trouvé.
fn resolve(program: &str) -> PathBuf {
    let p = Path::new(program);
    if p.components().count() > 1 || !cfg!(windows) || p.extension().is_some() {
        return p.to_path_buf();
    }
    let exts = std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".into());
    for dir in std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()) {
        for ext in exts.split(';').filter(|e| !e.is_empty()) {
            let candidate = dir.join(format!("{program}{}", ext.to_lowercase()));
            if candidate.is_file() {
                return candidate;
            }
        }
    }
    p.to_path_buf()
}

/// Lance l'éditeur sur `file`, sans l'attendre. `editor_not_found` si le programme n'existe pas.
pub fn open(editor: &str, file: &Path, cwd: &Path, line: Option<u32>) -> Result<(), String> {
    let (program, args) = editor_args(editor, file, line).ok_or("editor_not_found")?;
    let mut cmd = Command::new(resolve(&program));
    cmd.args(&args).current_dir(cwd).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // Un `code.cmd` ouvrirait sinon une console le temps de lancer l'éditeur.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    match cmd.spawn() {
        Ok(_) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Err("editor_not_found".into()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn commands_are_split_with_quotes() {
        assert_eq!(split_command("code -r"), ["code", "-r"]);
        assert_eq!(split_command(r#""C:\Program Files\Idea\idea64.exe"  --wait"#), [r"C:\Program Files\Idea\idea64.exe", "--wait"]);
        assert_eq!(split_command("vim '' x"), ["vim", "", "x"]);
        assert_eq!(split_command(r"C:\Users\D'Arc\ed.exe -n"), [r"C:\Users\D'Arc\ed.exe", "-n"]);
        assert!(split_command("   ").is_empty());
    }

    #[test]
    fn the_file_goes_at_its_place_or_at_the_end() {
        let f = Path::new("/d/a b.txt");
        assert_eq!(editor_args("code -r", f, None), Some(("code".into(), vec!["-r".into(), "/d/a b.txt".into()])));
        assert_eq!(editor_args("subl {file}:{line}", f, Some(12)), Some(("subl".into(), vec!["/d/a b.txt:12".into()])));
        assert_eq!(editor_args("idea --line {line} {file}", f, None), Some(("idea".into(), vec!["--line".into(), "1".into(), "/d/a b.txt".into()])));
        assert_eq!(editor_args("", f, None), None);
    }

    #[test]
    fn a_missing_editor_is_named() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(open("gitgr-editeur-introuvable-xyz", &dir.path().join("a"), dir.path(), None), Err("editor_not_found".into()));
    }
}
