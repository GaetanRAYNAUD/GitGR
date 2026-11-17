//! Commandes Tauri appelées par le frontend (`invoke("nom", { ... })`).
//!
//! Les commandes qui lancent git sont `async` : Tauri les exécute hors du
//! thread principal, l'interface ne gèle donc pas pendant l'appel.

use crate::branches::{self, OpResult};
use crate::git::{self, GitInfo, RepoSummary};
use crate::history::{self, Commit, CommitDetails, FileDiff, RefsInfo};
use crate::profiles::{self, SshKeyInfo};
use crate::providers::{self, Account};
use crate::worktree::{self, LineRef, WorkStatus};
use crate::watch::RepoWatcher;
use crate::store::{AppState, ColorValue, Profile, RepoEntry, RepoProfiles, RepoUi, Session, Settings, Store};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, State};

type StoreState<'a> = State<'a, Mutex<Store>>;

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[tauri::command]
pub async fn git_info() -> Result<GitInfo, String> {
    Ok(git::info())
}

#[tauri::command]
pub fn get_state(store: StoreState<'_>) -> AppState {
    store.lock().unwrap().state.clone()
}

/// Valide `path` comme dépôt Git, l'ajoute (ou le remonte) dans la liste
/// des dépôts récents et renvoie son entrée.
#[tauri::command]
pub async fn open_repo(path: String, store: StoreState<'_>) -> Result<RepoEntry, String> {
    let top = git::toplevel(Path::new(&path))?;
    let top_str = top.to_string_lossy().to_string();
    let name = top
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| top_str.clone());
    let mut s = store.lock().unwrap();
    // Le nom choisi dans l'app survit à une réouverture.
    let prev = s.state.repos.iter().find(|r| r.path == top_str);
    let alias = prev.and_then(|r| r.alias.clone());
    let color = prev.and_then(|r| r.color.clone());
    let entry = RepoEntry { path: top_str.clone(), name, last_opened: now_ms(), alias, color };
    s.state.repos.retain(|r| r.path != top_str);
    s.state.repos.insert(0, entry.clone());
    s.save()?;
    Ok(entry)
}

/// Retire un dépôt de la liste (ne touche pas aux fichiers sur disque).
#[tauri::command]
pub fn forget_repo(path: String, store: StoreState<'_>) -> Result<(), String> {
    let mut s = store.lock().unwrap();
    s.state.repos.retain(|r| r.path != path);
    s.state.session.open_tabs.retain(|p| *p != path);
    s.state.repo_ui.remove(&path);
    s.state.repo_profiles.remove(&path);
    s.state.written_config.remove(&path);
    if s.state.session.active.as_deref() == Some(path.as_str()) {
        s.state.session.active = None;
    }
    sync_identities(&s.state);
    s.save()
}

/// Change le nom affiché d'un dépôt (vide ou `None` = retour au nom du dossier).
#[tauri::command]
pub fn rename_repo(path: String, alias: Option<String>, store: StoreState<'_>) -> Result<(), String> {
    let alias = alias.map(|a| a.trim().to_string()).filter(|a| !a.is_empty());
    let mut s = store.lock().unwrap();
    if let Some(r) = s.state.repos.iter_mut().find(|r| r.path == path) {
        r.alias = alias;
    }
    s.save()
}

/// Couleur de la pastille d'onglet d'un dépôt (`None` = automatique).
#[tauri::command]
pub fn set_repo_color(path: String, color: Option<ColorValue>, store: StoreState<'_>) -> Result<(), String> {
    let mut s = store.lock().unwrap();
    if let Some(r) = s.state.repos.iter_mut().find(|r| r.path == path) {
        r.color = color;
    }
    s.save()
}

#[tauri::command]
pub fn set_session(session: Session, store: StoreState<'_>) -> Result<(), String> {
    let mut s = store.lock().unwrap();
    s.state.session = session;
    s.save()
}

#[tauri::command]
pub fn set_settings(settings: Settings, store: StoreState<'_>) -> Result<(), String> {
    let mut s = store.lock().unwrap();
    s.state.settings = settings;
    s.save()
}

#[tauri::command]
pub fn set_repo_ui(path: String, ui: RepoUi, store: StoreState<'_>) -> Result<(), String> {
    let mut s = store.lock().unwrap();
    s.state.repo_ui.insert(path, ui);
    s.save()
}

#[tauri::command]
pub async fn repo_summary(path: String) -> Result<RepoSummary, String> {
    git::summary(Path::new(&path))
}

/// Erreurs de lecture : codes connus (dépôt déplacé, propriétaire…) ou message brut de git.
fn classify(e: String) -> String {
    git::classify_error(&e).map(str::to_string).unwrap_or(e)
}

#[tauri::command]
pub async fn repo_log(path: String, skip: u32, limit: u32) -> Result<Vec<Commit>, String> {
    history::log(Path::new(&path), skip, limit).map_err(classify)
}

#[tauri::command]
pub async fn repo_refs(path: String) -> Result<RefsInfo, String> {
    history::refs(Path::new(&path)).map_err(classify)
}

#[tauri::command]
pub async fn commit_details(path: String, sha: String) -> Result<CommitDetails, String> {
    history::details(Path::new(&path), &sha).map_err(classify)
}

#[tauri::command]
pub async fn commit_diff(
    path: String,
    sha: String,
    file: String,
    old_file: Option<String>,
) -> Result<FileDiff, String> {
    history::diff(Path::new(&path), &sha, &file, old_file.as_deref()).map_err(classify)
}

// --- Copie de travail ------------------------------------------------------

#[tauri::command]
pub async fn work_status(path: String) -> Result<WorkStatus, String> {
    worktree::status(Path::new(&path)).map_err(classify)
}

/// `area` : "unstaged" | "staged" | "untracked" | "conflicted".
#[tauri::command]
pub async fn work_diff(path: String, file: String, old_file: Option<String>, area: String) -> Result<FileDiff, String> {
    worktree::file_diff(Path::new(&path), &file, old_file.as_deref(), &area).map_err(classify)
}

#[tauri::command]
pub async fn stage_files(path: String, files: Vec<String>) -> Result<(), String> {
    worktree::stage_files(Path::new(&path), &files).map_err(classify)
}

#[tauri::command]
pub async fn unstage_files(path: String, files: Vec<String>) -> Result<(), String> {
    worktree::unstage_files(Path::new(&path), &files).map_err(classify)
}

#[tauri::command]
pub async fn stage_all(path: String) -> Result<(), String> {
    worktree::stage_all(Path::new(&path)).map_err(classify)
}

#[tauri::command]
pub async fn unstage_all(path: String) -> Result<(), String> {
    worktree::unstage_all(Path::new(&path)).map_err(classify)
}

#[tauri::command]
pub async fn discard_files(path: String, tracked: Vec<String>, untracked: Vec<String>) -> Result<(), String> {
    worktree::discard_files(Path::new(&path), &tracked, &untracked).map_err(classify)
}

#[tauri::command]
pub async fn discard_all(path: String) -> Result<(), String> {
    worktree::discard_all(Path::new(&path)).map_err(classify)
}

#[tauri::command]
pub async fn stash_all(path: String, message: String) -> Result<(), String> {
    worktree::stash_all(Path::new(&path), &message).map_err(classify)
}

/// Indexe (`unstage = false`) ou retire de l'index les lignes choisies d'un fichier.
#[tauri::command]
pub async fn stage_lines(
    path: String,
    file: String,
    old_file: Option<String>,
    lines: Vec<LineRef>,
    fingerprint: String,
    unstage: bool,
) -> Result<(), String> {
    worktree::stage_lines(Path::new(&path), &file, old_file.as_deref(), &lines, &fingerprint, unstage)
        .map_err(classify)
}

#[tauri::command]
pub async fn discard_lines(path: String, file: String, lines: Vec<LineRef>, fingerprint: String) -> Result<(), String> {
    worktree::discard_lines(Path::new(&path), &file, &lines, &fingerprint).map_err(classify)
}

#[tauri::command]
pub async fn commit(path: String, message: String, amend: bool) -> Result<String, String> {
    worktree::commit(Path::new(&path), &message, amend).map_err(classify)
}

#[tauri::command]
pub async fn head_message(path: String) -> Result<String, String> {
    worktree::head_message(Path::new(&path)).map_err(classify)
}

// --- Branches et réseau -----------------------------------------------------
// Les erreurs sont déjà classées par `branches::classify`.

#[tauri::command]
pub async fn checkout(path: String, branch: String, auto_stash: bool) -> Result<OpResult, String> {
    branches::checkout(Path::new(&path), &branch, auto_stash)
}

/// Renvoie le résultat et le nom de la branche locale.
#[tauri::command]
pub async fn checkout_remote(path: String, branch: String, auto_stash: bool) -> Result<(OpResult, String), String> {
    branches::checkout_remote(Path::new(&path), &branch, auto_stash)
}

#[tauri::command]
pub async fn checkout_detached(path: String, sha: String, auto_stash: bool) -> Result<OpResult, String> {
    branches::checkout_detached(Path::new(&path), &sha, auto_stash)
}

#[tauri::command]
pub async fn create_branch(
    path: String,
    name: String,
    start: Option<String>,
    checkout: bool,
    auto_stash: bool,
) -> Result<OpResult, String> {
    branches::create_branch(Path::new(&path), &name, start.as_deref(), checkout, auto_stash)
}

#[tauri::command]
pub async fn rename_branch(path: String, old: String, new: String) -> Result<(), String> {
    branches::rename_branch(Path::new(&path), &old, &new)
}

#[tauri::command]
pub async fn delete_branch(path: String, branch: String, force: bool) -> Result<(), String> {
    branches::delete_branch(Path::new(&path), &branch, force)
}

#[tauri::command]
pub async fn delete_remote_branch(path: String, branch: String) -> Result<(), String> {
    branches::delete_remote_branch(Path::new(&path), &branch)
}

#[tauri::command]
pub async fn fetch(path: String) -> Result<(), String> {
    branches::fetch(Path::new(&path))
}

#[tauri::command]
pub async fn pull(path: String, strategy: String, auto_stash: bool) -> Result<OpResult, String> {
    branches::pull(Path::new(&path), &strategy, auto_stash)
}

/// Tire la branche `branch` du remote `remote` dans la branche courante (« Tirer depuis… »).
#[tauri::command]
pub async fn pull_from(path: String, remote: String, branch: String, strategy: String, auto_stash: bool) -> Result<OpResult, String> {
    branches::pull_from(Path::new(&path), &remote, &branch, &strategy, auto_stash)
}

/// `remote` : destination choisie (« Pousser vers… ») ; absent : celle de la branche suivie.
#[tauri::command]
pub async fn push(path: String, force: bool, remote: Option<String>) -> Result<(), String> {
    branches::push(Path::new(&path), force, remote.as_deref())
}

// --- Remotes -------------------------------------------------------------------

#[tauri::command]
pub async fn add_remote(path: String, name: String, url: String) -> Result<(), String> {
    crate::remotes::add(Path::new(&path), &name, &url)
}

#[tauri::command]
pub async fn rename_remote(path: String, old: String, new: String) -> Result<(), String> {
    crate::remotes::rename(Path::new(&path), &old, &new)
}

#[tauri::command]
pub async fn set_remote_url(path: String, name: String, url: String) -> Result<(), String> {
    crate::remotes::set_url(Path::new(&path), &name, &url)
}

#[tauri::command]
pub async fn remove_remote(path: String, name: String) -> Result<(), String> {
    crate::remotes::remove(Path::new(&path), &name)
}

#[tauri::command]
pub async fn stash_pop(path: String) -> Result<OpResult, String> {
    branches::stash_pop(Path::new(&path))
}

#[tauri::command]
pub async fn abort_operation(path: String) -> Result<(), String> {
    branches::abort_operation(Path::new(&path)).map_err(|e| branches::classify(&e))
}

#[tauri::command]
pub async fn continue_operation(path: String) -> Result<OpResult, String> {
    branches::continue_operation(Path::new(&path))
}

/// Surveille le dépôt de l'onglet actif (`None` : aucun) ; l'interface reçoit l'événement
/// `repo-changed` quand il change sur disque.
#[tauri::command]
pub async fn watch_repo(path: Option<String>, app: AppHandle, watcher: State<'_, Mutex<RepoWatcher>>) -> Result<(), String> {
    watcher.lock().unwrap().watch(path, move |repo| {
        let _ = app.emit("repo-changed", repo);
    })
}

// --- Profils ------------------------------------------------------------------

/// Met à jour les identités injectées dans git (après tout changement de profils).
pub fn sync_identities(state: &AppState) {
    git::set_identities(state.identities());
    crate::remotes::set_table(state.remote_table());
}

/// Remplace la liste des profils ; renvoie les profils des dépôts, nettoyés de ceux supprimés.
#[tauri::command]
pub fn set_profiles(profiles: Vec<Profile>, store: StoreState<'_>) -> Result<HashMap<String, RepoProfiles>, String> {
    let mut s = store.lock().unwrap();
    let accounts = s.state.account_ids();
    s.state.profiles = profiles;
    forget_tokens(&accounts, &s.state);
    s.state.prune_profiles();
    // Avant la sauvegarde : même si elle échoue, git suit l'état en mémoire, celui que
    // l'interface affiche.
    sync_identities(&s.state);
    s.save()?;
    Ok(s.state.repo_profiles.clone())
}

#[tauri::command]
pub fn set_repo_profiles(path: String, profiles: RepoProfiles, store: StoreState<'_>) -> Result<(), String> {
    let mut s = store.lock().unwrap();
    s.state.repo_profiles.insert(path, profiles);
    s.state.prune_profiles();
    sync_identities(&s.state);
    s.save()
}

/// Dossier personnel, avec des `/` (règles `~/…`, chemin proposé pour une nouvelle clé).
#[tauri::command]
pub fn home_dir() -> Option<String> {
    git::home_dir().map(|h| h.to_string_lossy().replace('\\', "/"))
}

#[tauri::command]
pub async fn ssh_key_info(path: String) -> Result<SshKeyInfo, String> {
    profiles::key_info(&path)
}

/// Enregistre (après vérification) ou oublie (`None`) la phrase de passe d'une clé.
#[tauri::command]
pub async fn set_key_passphrase(path: String, passphrase: Option<String>) -> Result<SshKeyInfo, String> {
    profiles::set_passphrase(&path, passphrase.as_deref())
}

#[tauri::command]
pub async fn generate_ssh_key(path: String, comment: String, passphrase: Option<String>) -> Result<SshKeyInfo, String> {
    profiles::generate_key(&path, &comment, passphrase.as_deref())
}

/// « Écrire l'identité dans .git/config » : identité et signature du profil actif, pour
/// qu'elles vaillent aussi en ligne de commande. Ce qu'une écriture précédente avait posé et
/// que ce profil ne définit plus (signature d'un autre profil) est retiré.
#[tauri::command]
pub async fn apply_identity(path: String, store: StoreState<'_>) -> Result<(), String> {
    let p = Path::new(&path);
    let id = git::identity_for(p).ok_or("no_profile")?;
    let previous = store.lock().unwrap().state.written_config.get(&path).cloned().unwrap_or_default();
    let written = git::write_local_config(p, &id.config(), &previous).map_err(classify)?;
    let mut s = store.lock().unwrap();
    s.state.written_config.insert(path, written);
    s.save()
}

/// Clés GPG secrètes, pour choisir celle d'un profil.
#[tauri::command]
pub async fn gpg_keys() -> Result<Vec<crate::signing::GpgKey>, String> {
    crate::signing::gpg_keys()
}

// --- Comptes providers ---------------------------------------------------------

/// Oublie les tokens des comptes de `before` qu'aucun profil ne porte plus (profil supprimé,
/// compte déconnecté). Un trousseau indisponible n'est pas une erreur ici.
fn forget_tokens(before: &std::collections::HashSet<String>, state: &AppState) {
    let kept = state.account_ids();
    for id in before.difference(&kept) {
        let _ = crate::secrets::delete_token(id);
    }
}

/// Connecte un compte GitHub / GitLab au profil : le token est vérifié auprès de l'instance
/// (`url` vide : github.com / gitlab.com), rangé dans le trousseau, et le compte ajouté au
/// profil. Il remplace le compte que le profil avait déjà sur cette instance.
#[tauri::command]
pub async fn connect_account(profile: String, kind: String, url: String, token: String, store: StoreState<'_>) -> Result<Account, String> {
    link_account(&store, &profile, || providers::connect(&kind, &url, &token))
}

/// Connecte un compte au profil : `connect` vérifie le token et le range dans le trousseau
/// (appel réseau, sans tenir le verrou de l'état), puis le compte est lié au profil, à la place
/// de celui qu'il avait sur cette instance.
fn link_account(store: &StoreState<'_>, profile: &str, connect: impl FnOnce() -> Result<Account, String>) -> Result<Account, String> {
    let known = |s: &Store| s.state.profiles.iter().any(|p| p.id == profile);
    if !known(&store.lock().unwrap()) {
        return Err("no_profile".into());
    }
    let account = connect()?;
    let mut s = store.lock().unwrap();
    let mut tokens = s.state.account_ids();
    tokens.insert(account.id.clone());
    let previous = s.state.profiles.clone();
    if let Some(p) = s.state.profiles.iter_mut().find(|p| p.id == profile) {
        p.accounts.retain(|a| !(a.kind == account.kind && a.url == account.url));
        p.accounts.push(account.clone());
    }
    // Profil supprimé pendant l'appel, ou écriture en échec : rien ne change.
    let saved = if known(&s) { s.save() } else { Err("no_profile".into()) };
    if saved.is_err() {
        s.state.profiles = previous;
    }
    // Une fois l'état fixé : le token d'un compte remplacé — ou du compte refusé — ne reste pas.
    forget_tokens(&tokens, &s.state);
    saved.map(|()| account)
}

// --- Connexion OAuth à GitHub (device flow) -------------------------------------

/// Connexions en cours : identifiant → code de l'appareil (jamais envoyé à l'interface).
static DEVICE_FLOWS: std::sync::LazyLock<Mutex<HashMap<u64, String>>> = std::sync::LazyLock::new(Default::default);

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceStart {
    flow_id: u64,
    #[serde(flatten)]
    code: providers::DeviceCode,
}

/// Résultat d'une demande du token : « en attente » (avec l'intervalle à respecter) ou compte
/// connecté.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevicePollResult {
    account: Option<Account>,
    interval: Option<u64>,
}

/// Commence une connexion à github.com : code à saisir sur la page de GitHub.
#[tauri::command]
pub async fn github_device_start() -> Result<DeviceStart, String> {
    use std::sync::atomic::{AtomicU64, Ordering};
    static SEQ: AtomicU64 = AtomicU64::new(1);
    let flow = providers::device_start_with(providers::GITHUB_LOGIN)?;
    let flow_id = SEQ.fetch_add(1, Ordering::Relaxed);
    DEVICE_FLOWS.lock().unwrap().insert(flow_id, flow.device_code);
    Ok(DeviceStart { flow_id, code: flow.code })
}

/// Demande le token de la connexion `flow_id` ; une fois donné, le compte est lié au profil
/// comme avec un token personnel.
#[tauri::command]
pub async fn github_device_poll(profile: String, flow_id: u64, store: StoreState<'_>) -> Result<DevicePollResult, String> {
    let device_code = DEVICE_FLOWS.lock().unwrap().get(&flow_id).cloned().ok_or("device_expired")?;
    let poll = providers::device_poll_with(providers::GITHUB_LOGIN, &device_code);
    let token = match poll {
        Ok(providers::DevicePoll::Pending) => return Ok(DevicePollResult { account: None, interval: None }),
        Ok(providers::DevicePoll::SlowDown(interval)) => return Ok(DevicePollResult { account: None, interval: Some(interval) }),
        Ok(providers::DevicePoll::Token(token)) => token,
        Err(e) => {
            DEVICE_FLOWS.lock().unwrap().remove(&flow_id);
            return Err(e);
        }
    };
    DEVICE_FLOWS.lock().unwrap().remove(&flow_id);
    let account = link_account(&store, &profile, || providers::connect("github", "", &token))?;
    Ok(DevicePollResult { account: Some(account), interval: None })
}

/// Abandonne une connexion en cours.
#[tauri::command]
pub fn github_device_cancel(flow_id: u64) {
    DEVICE_FLOWS.lock().unwrap().remove(&flow_id);
}

/// Retire un compte du profil ; son token est oublié si aucun autre profil ne porte ce compte.
#[tauri::command]
pub fn disconnect_account(profile: String, account: String, store: StoreState<'_>) -> Result<(), String> {
    let mut s = store.lock().unwrap();
    let before = s.state.account_ids();
    let previous = s.state.profiles.clone();
    if let Some(p) = s.state.profiles.iter_mut().find(|p| p.id == profile) {
        p.accounts.retain(|a| a.id != account);
    }
    // Écriture en échec : le compte reste (l'interface l'affiche encore), avec son token.
    if let Err(e) = s.save() {
        s.state.profiles = previous;
        return Err(e);
    }
    forget_tokens(&before, &s.state);
    Ok(())
}

/// Le token du compte est-il toujours valable ? (`token_missing`, `token_invalid`…)
#[tauri::command]
pub async fn check_account(account: String, store: StoreState<'_>) -> Result<Account, String> {
    let found = store.lock().unwrap().state.profiles.iter().flat_map(|p| &p.accounts).find(|a| a.id == account).cloned();
    providers::check(&found.ok_or("account_not_found")?)
}

/// Dépôts accessibles au compte (fenêtre de clone).
#[tauri::command]
pub async fn list_account_repos(account: String, store: StoreState<'_>) -> Result<providers::RepoList, String> {
    let found = store.lock().unwrap().state.profiles.iter().flat_map(|p| &p.accounts).find(|a| a.id == account).cloned();
    providers::list_repos(&found.ok_or("account_not_found")?)
}

// --- Clone ----------------------------------------------------------------------

/// Clone `url` dans `parent/name` avec la clé SSH du profil `profile` ; l'interface reçoit
/// l'événement `clone-progress` pendant le clone. Renvoie la racine du nouveau dépôt (à ouvrir
/// avec `open_repo`). Le dossier parent est retenu par l'interface (`settings.cloneDir`).
#[tauri::command]
pub async fn clone_repo(url: String, parent: String, name: String, profile: Option<String>, app: AppHandle) -> Result<String, String> {
    // Un clone peut durer des minutes : sur un fil à part, pas sur ceux du runtime async.
    tauri::async_runtime::spawn_blocking(move || {
        crate::clone::clone(&url, &parent, &name, profile.as_deref(), |progress| {
            let _ = app.emit("clone-progress", progress);
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Arrête le clone en cours ; il échoue avec `clone_cancelled`.
#[tauri::command]
pub fn cancel_clone() {
    crate::clone::cancel();
}

// --- Clés du profil sur ses comptes ----------------------------------------------

/// Clés du profil (enregistré) à mettre sur ses comptes : clé SSH, et clé de signature (SSH ou
/// GPG). Une clé illisible donne son erreur à la place.
fn local_keys(profile: &Profile) -> Vec<Result<providers::LocalKey, (providers::KeyKind, String)>> {
    use crate::git::Signing;
    use providers::{KeyKind, LocalKey};
    let ssh = |kind: KeyKind, path: &str| profiles::public_key(path).map(|(public, fpr)| LocalKey::ssh(kind, &public, &fpr)).map_err(|e| (kind, e));
    let mut keys = Vec::new();
    if let Some(path) = profile.ssh_key.as_deref().filter(|k| !k.trim().is_empty()) {
        keys.push(ssh(KeyKind::Auth, path));
    }
    match profile.signing() {
        Signing::Ssh(path) => keys.push(ssh(KeyKind::Signing, &path)),
        Signing::Gpg(wanted) => keys.push(
            crate::signing::gpg_keys()
                .and_then(|all| crate::signing::resolve_key(&all, wanted.as_deref(), &profile.user_email).ok_or_else(|| "gpg_key_not_found".to_string()))
                .and_then(|key| crate::signing::export_public(&key.fingerprint).map(|armored| LocalKey::gpg(&armored, &key.fingerprint)))
                .map_err(|e| (KeyKind::Gpg, e)),
        ),
        Signing::Config | Signing::Off => {}
    }
    keys
}

/// Profil enregistré et l'un de ses comptes.
fn profile_account(store: &StoreState<'_>, profile: &str, account: &str) -> Result<(Profile, Account), String> {
    let s = store.lock().unwrap();
    let p = s.state.profiles.iter().find(|p| p.id == profile).cloned().ok_or("no_profile")?;
    let a = p.accounts.iter().find(|a| a.id == account).cloned().ok_or("account_not_found")?;
    Ok((p, a))
}

/// Clés du profil et leur présence sur le compte.
#[tauri::command]
pub async fn account_keys(profile: String, account: String, store: StoreState<'_>) -> Result<Vec<providers::KeyEntry>, String> {
    let (p, a) = profile_account(&store, &profile, &account)?;
    let keys = local_keys(&p);
    let ok: Vec<providers::LocalKey> = keys.iter().filter_map(|k| k.as_ref().ok().cloned()).collect();
    let mut found = if ok.is_empty() { Vec::new() } else { providers::key_entries(&a, &ok)? }.into_iter();
    Ok(keys
        .into_iter()
        .map(|k| match k {
            Ok(_) => found.next().expect("une entrée par clé lue"),
            Err((kind, e)) => providers::KeyEntry { kind, label: String::new(), present: false, error: Some(e) },
        })
        .collect())
}

/// Ajoute au compte la clé `kind` ("auth" | "signing" | "gpg") du profil, nommée d'après le
/// profil et la machine.
#[tauri::command]
pub async fn add_account_key(profile: String, account: String, kind: String, store: StoreState<'_>) -> Result<(), String> {
    let kind = providers::KeyKind::parse(&kind)?;
    let (p, a) = profile_account(&store, &profile, &account)?;
    let keys: Vec<providers::LocalKey> = local_keys(&p).into_iter().filter_map(Result::ok).collect();
    let key = keys.iter().find(|k| k.kind == kind).ok_or("key_not_found")?;
    let machine = std::env::var("COMPUTERNAME").or_else(|_| std::env::var("HOSTNAME")).unwrap_or_default();
    let title = if machine.trim().is_empty() { format!("GitGR · {}", p.name) } else { format!("GitGR · {} · {}", p.name, machine.trim()) };
    providers::add_key(&a, key, &keys, &title)
}

// --- Avatars ---------------------------------------------------------------------

/// Token du compte `account`, seulement s'il est de l'instance `url` du provider `kind` : il
/// ne part jamais vers une autre adresse.
fn instance_token(store: &StoreState<'_>, account: Option<String>, kind: &str, url: &str) -> Option<String> {
    let id = account?;
    let s = store.lock().unwrap();
    let found = s.state.profiles.iter().flat_map(|p| &p.accounts).find(|a| a.id == id).cloned()?;
    let same = providers::Kind::parse(kind).and_then(|k| providers::instance(k, url)).is_ok_and(|i| i.url == found.url && found.kind == kind);
    same.then(|| crate::secrets::token(&found.id)).flatten()
}

/// Avatar du propriétaire `owner` (utilisateur, organisation, groupe) sur l'instance `url`, en
/// data URL. `account` : compte dont le token est joint (seulement s'il est de cette instance).
#[tauri::command]
pub async fn owner_avatar(kind: String, url: String, owner: String, account: Option<String>, store: StoreState<'_>) -> Result<Option<String>, String> {
    let token = instance_token(&store, account, &kind, &url);
    crate::avatars::owner_avatar(&kind, &url, &owner, token.as_deref())
}

/// Avatars des auteurs de commits (adresse en minuscules → data URL, ou `None`). `kind`, `url`
/// et `repo` (`propriétaire/nom`) : provider et dépôt du remote `origin`, s'il est connu ;
/// `account` : compte dont le token est joint.
#[tauri::command]
pub async fn author_avatars(
    kind: Option<String>,
    url: Option<String>,
    repo: Option<String>,
    account: Option<String>,
    emails: Vec<String>,
    store: StoreState<'_>,
) -> Result<HashMap<String, Option<String>>, String> {
    let token = match (&kind, &url) {
        (Some(k), Some(u)) => instance_token(&store, account, k, u),
        _ => None,
    };
    // Plusieurs téléchargements, parfois lents : sur un fil à part.
    tauri::async_runtime::spawn_blocking(move || {
        let kind = kind.as_deref().and_then(|k| providers::Kind::parse(k).ok());
        let ctx = match (kind, url.as_deref()) {
            (Some(kind), Some(url)) => Some(crate::avatars::RepoContext { kind, url, repo: repo.as_deref(), token: token.as_deref() }),
            _ => None,
        };
        crate::avatars::author_avatars(ctx.as_ref(), &emails).into_iter().collect()
    })
    .await
    .map_err(|e| e.to_string())
}

// --- Pull requests / merge requests -------------------------------------------

/// Token du compte `account` pour l'instance `url` du provider `kind` ; l'API de cette instance.
fn pull_access(store: &StoreState<'_>, account: Option<String>, kind: &str, url: &str) -> Result<(providers::Kind, String, String), String> {
    let k = providers::Kind::parse(kind)?;
    let api = providers::instance(k, url)?.api;
    let token = instance_token(store, account, kind, url).ok_or("account_missing")?;
    Ok((k, api, token))
}

/// Brouillon d'une PR / MR : commits de `source` absents de `target`, modèle du dépôt.
#[tauri::command]
pub async fn pull_draft(path: String, source: String, target: String, kind: Option<String>) -> Result<crate::pulls::PullDraft, String> {
    let kind = kind.as_deref().and_then(|k| providers::Kind::parse(k).ok());
    crate::pulls::draft(Path::new(&path), &source, &target, kind)
}

/// Branche par défaut du dépôt `repo` (`propriétaire/nom`) sur l'instance `url`.
#[tauri::command]
pub async fn remote_default_branch(kind: String, url: String, repo: String, account: Option<String>, store: StoreState<'_>) -> Result<String, String> {
    let (k, api, token) = pull_access(&store, account, &kind, &url)?;
    tauri::async_runtime::spawn_blocking(move || crate::pulls::default_branch(k, &api, &repo, &token)).await.map_err(|e| e.to_string())?
}

/// Crée la PR / MR (ou renvoie celle qui existe déjà pour ces branches).
#[tauri::command]
pub async fn create_pull(kind: String, url: String, account: Option<String>, request: crate::pulls::NewPull, store: StoreState<'_>) -> Result<crate::pulls::Pull, String> {
    let (k, api, token) = pull_access(&store, account, &kind, &url)?;
    tauri::async_runtime::spawn_blocking(move || crate::pulls::create(k, &api, &token, &request)).await.map_err(|e| e.to_string())?
}
