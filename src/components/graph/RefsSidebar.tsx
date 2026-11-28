// Barre latérale : branches locales, distantes (une section par remote) et tags.
// Sections repliables et masquables, choix mémorisés par dépôt. Au clavier, un arbre à une
// seule tabulation (lib/treeNav) : ↑ / ↓, → / ←, Entrée (le commit dans le graphe),
// Maj+Entrée (checkout), Maj+F10 (menu), recherche à la frappe ; Ctrl+Maj+E y amène.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { parseRemote, profileColor, remoteProfile } from "../../lib/profiles";
import { PROVIDER_NAMES, remoteAccount, remoteInstance, remoteOwner, remoteProvider } from "../../lib/providers";
import { refSections, refTree, splitRemoteBranch, type RefNode, type RefSection } from "../../lib/refs";
import type { GitRef, RemoteInfo, RepoUi } from "../../lib/types";
import { LAYOUT, sectionKey, useWidthStyle } from "../../lib/layout";
import { useDismiss } from "../../lib/useDismiss";
import { useTreeNav } from "../../lib/treeNav";
import { useApp } from "../../store/app";
import { useGraph } from "../../store/graph";
import { useOps } from "../../store/ops";
import { useProfiles } from "../../store/profiles";
import { usePublishDialog } from "../../store/publish";
import { isHeader, type MenuItem, openContextMenu } from "../ContextMenu";
import { Icon, type IconName } from "../Icon";
import { ProfileAvatar } from "../ProfileAvatar";
import { RemoteMark } from "../RemoteMark";
import { checkoutRef, refMenu, remoteMenu, startBranchDrag } from "./menus";
import { PULLS_SECTION, PullsSection, termOf } from "./PullsSection";
import { STASHES_SECTION, StashesSection } from "./StashesSection";
import { pullOfRef, usePullContexts, usePullList } from "../../store/pullList";
import { pullRef } from "../../lib/pulls";
import { ResizableBlock } from "../Splitter";

/** Par défaut, les tags sont repliés (souvent nombreux). */
export const DEFAULT_REPO_UI: RepoUi = { collapsed: ["tags"], hidden: [] };

/** Local : une branche (et non un dossier, pris par les `feature/…`). */
const ICONS: Record<RefSection["kind"], IconName> = { local: "branch", remote: "cloud", tags: "tag" };

function toggle(list: string[], key: string): string[] {
  return list.includes(key) ? list.filter((k) => k !== key) : [...list, key];
}

/** Clé d'arbre (`data-ti`) d'un en-tête de section. */
export const sectionTi = (key: string) => `section:${key}`;

export function RefsSidebar({ path }: { path: string }) {
  const { t } = useTranslation();
  const refs = useGraph((s) => s.graphs[path]?.refs ?? null);
  const reveal = useGraph((s) => s.reveal);
  const selected = useGraph((s) => s.graphs[path]?.selected ?? null);
  const ui = useApp((s) => s.repoUi[path]) ?? DEFAULT_REPO_UI;
  const setUi = useApp((s) => s.setRepoUi);
  const widthStyle = useWidthStyle(LAYOUT.sidebar);
  const [filter, setFilter] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [missing, setMissing] = useState<string | null>(null);
  /** Ref cliquée : seule surlignée parmi celles qui pointent sur le même commit. */
  const [clicked, setClicked] = useState<string | null>(null);
  const [noMatch, setNoMatch] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const sectionsBtn = useRef<HTMLButtonElement>(null);
  const filterInput = useRef<HTMLInputElement>(null);
  // Filtre sans résultat : rien dans l'arbre, on le dit (au lieu d'une barre vide). Recalculé
  // à chaque changement de l'arbre (les sections Stashes et PR / MR se rendent seules).
  const queryRef = useRef("");
  const tree = useTreeNav((count) => {
    const none = queryRef.current !== "" && count === 0;
    setNoMatch((was) => (was === none ? was : none));
  });

  const profiles = useProfiles((s) => s.profiles);
  const binding = useProfiles((s) => s.repoProfiles[path]);

  const sections = useMemo(() => refSections(refs), [refs]);
  const contexts = usePullContexts(path);
  const pullLists = usePullList((s) => s.lists);
  const showPulls = contexts.length > 0 && !ui.hidden.includes(PULLS_SECTION);
  /** Remote d'une section distante (sans URL connue si git ne le liste plus). */
  const remoteOf = (s: RefSection): RemoteInfo | null =>
    s.kind === "remote" ? (refs?.remotes.find((r) => r.name === s.remote) ?? { name: s.remote!, url: null, pushUrl: null }) : null;
  const title = (s: RefSection) => (s.kind === "local" ? t("sidebar.local") : s.kind === "tags" ? t("sidebar.tags") : s.remote!);
  const shown = sections.filter((s) => !ui.hidden.includes(s.key));
  const hasStashes = (refs?.stashes ?? 0) > 0;
  const hiddenCount =
    sections.length - shown.length + (contexts.length > 0 && ui.hidden.includes(PULLS_SECTION) ? 1 : 0) + (hasStashes && ui.hidden.includes(STASHES_SECTION) ? 1 : 0);
  const q = filter.trim().toLowerCase();
  queryRef.current = q;

  // Menu des sections affichées : le focus y entre, et revient au bouton à la fermeture.
  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    sectionsBtn.current?.focus();
  }, []);
  useDismiss(menuRef, menuOpen, closeMenu);
  useEffect(() => {
    if (menuOpen) menuRef.current?.querySelector<HTMLInputElement>(".sections-menu input")?.focus();
  }, [menuOpen]);

  // Ctrl+Maj+E : le focus dans l'arbre (comme l'explorateur d'un éditeur).
  const focusTree = tree.focus;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey || e.key.toUpperCase() !== "E") return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      e.preventDefault();
      focusTree();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusTree]);

  const go = async (r: GitRef) => {
    setMissing(null);
    setClicked(r.name);
    if (!(await reveal(path, r.target))) setMissing(r.name);
  };

  const remoteNames = useMemo(() => (refs?.remotes ?? []).map((x) => x.name), [refs]);
  const localNames = useMemo(() => new Set((refs?.refs ?? []).filter((x) => x.kind === "local").map((x) => x.short)), [refs]);

  const refButton = (r: GitRef, label: string, depth: number, parent: string) => {
    const current = r.kind === "local" && r.short === refs?.headBranch;
    const meta = [r.ahead ? `↑${r.ahead}` : "", r.behind ? `↓${r.behind}` : ""].filter(Boolean).join(" ");
    // Sélection : la ref cliquée ; si la sélection vient d'ailleurs (graphe), toutes celles du commit.
    const sel = selected === r.target && (!clicked || !refs?.refs.some((x) => x.name === clicked && x.target === selected) || clicked === r.name);
    const cls = ["side-item", current && "current", sel && "sel"].filter(Boolean).join(" ");
    const pr = pullOfRef(pullLists, contexts, refs, r);
    const prRef = pr && pullRef(pr.ctx.kind, pr.pull.number);
    // Distante dont la locale existe déjà : le double-clic la met aussi à jour.
    const split = r.kind === "remote" ? splitRemoteBranch(remoteNames, r.short) : null;
    const pulls = !!split && localNames.has(split.local);
    const hint = pulls ? t("sidebar.dblClickPull", { branch: split.local }) : t("sidebar.dblClick");
    // Lu après le nom : le chemin complet (dans un dossier), puis ce que disent les marques
    // (branche courante, PR / MR, ↑ ↓, disparue).
    const details = [
      label !== r.short && r.short,
      current && t("sidebar.isCurrent"),
      prRef && t("sidebar.hasPull", { ref: prRef }),
      r.ahead && t("sidebar.ahead", { count: r.ahead }),
      r.behind && t("sidebar.behind", { count: r.behind }),
      r.gone && t("sidebar.gone"),
    ]
      .filter(Boolean)
      .join(", ");
    // Menu : la PR / MR de la branche d'abord (sa puce n'est pas atteignable au clavier).
    // (Sous l'en-tête du menu, qui nomme la branche.)
    const menu = (): MenuItem[] => {
      const items = refMenu(t, path, r, refs);
      const head = items[0] && isHeader(items[0]) ? [items[0]] : [];
      const pull: MenuItem[] = pr && prRef ? [{ label: t("sidebar.openPull", { ref: prRef }), onClick: () => usePullList.getState().show(path, pr.ctx, pr.pull.number) }, "sep"] : [];
      return [...head, ...pull, ...items.slice(head.length)];
    };
    return (
      <li key={r.name}>
        <button
          className={cls}
          role="treeitem"
          aria-level={depth + 2}
          aria-selected={sel}
          aria-current={current || undefined}
          aria-label={label}
          aria-description={details || undefined}
          aria-keyshortcuts={r.kind === "tag" ? undefined : "Shift+Enter"}
          data-ti={`ref:${r.name}`}
          data-ti-parent={parent}
          style={{ "--depth": depth } as React.CSSProperties}
          onClick={() => go(r)}
          onDoubleClick={() => checkoutRef(path, r, refs)}
          onContextMenu={(e) => openContextMenu(e, menu())}
          onMouseDown={r.kind === "local" ? (e) => startBranchDrag(e, t, path, r) : undefined}
          data-drop-ref={r.kind === "local" ? r.name : undefined}
          title={missing === r.name ? t("sidebar.notFound") : r.kind === "tag" ? r.short : `${r.short}\n${hint}`}
        >
          <span className="side-label">{label}</span>
          {pr && prRef && (
            <span
              className={`side-pull ${pr.pull.state}`}
              aria-hidden="true"
              title={t("prv.branchPull", { ref: prRef, title: pr.pull.title })}
              onClick={(e) => {
                e.stopPropagation();
                usePullList.getState().show(path, pr.ctx, pr.pull.number);
              }}
            >
              {prRef}
            </span>
          )}
          {r.gone && (
            <span className="side-meta" aria-hidden="true">
              {t("sidebar.gone")}
            </span>
          )}
          {meta && (
            <span className="side-meta" aria-hidden="true">
              {meta}
            </span>
          )}
        </button>
      </li>
    );
  };

  /** Branches rangées en dossiers selon les `/` (`feature/…`) ; dossiers repliables, mémorisés. */
  const renderNodes = (section: string, nodes: RefNode[], depth: number, parent: string): React.ReactNode =>
    nodes.map((n) => {
      if (n.type === "ref") return refButton(n.ref, n.name, depth, parent);
      const key = `${section}/${n.path}`;
      const open = q !== "" || !ui.collapsed.includes(key);
      const flip = () => setUi(path, { ...ui, collapsed: toggle(ui.collapsed, key) });
      return (
        <li key={key}>
          <button
            className="side-item side-folder"
            role="treeitem"
            aria-level={depth + 2}
            aria-expanded={open}
            data-ti={`folder:${key}`}
            data-ti-parent={parent}
            title={n.path}
            style={{ "--depth": depth } as React.CSSProperties}
            onClick={flip}
            onContextMenu={(e) => openContextMenu(e, [{ label: t(open ? "sidebar.collapse" : "sidebar.expand"), onClick: flip }])}
          >
            <Icon name="chevron" size={12} className={open ? "chev" : "chev closed"} />
            <Icon name="folder" size={14} />
            <span className="side-label">{n.name}</span>
            <span className="side-meta">{n.count}</span>
          </button>
          {open && <ul role="group">{renderNodes(section, n.children, depth + 1, `folder:${key}`)}</ul>}
        </li>
      );
    });

  /** Menu d'un en-tête de section : replier / déplier, masquer (le remote a le sien). */
  const sectionMenu = (key: string, open: boolean): MenuItem[] => [
    { label: t(open ? "sidebar.collapse" : "sidebar.expand"), onClick: () => setUi(path, { ...ui, collapsed: toggle(ui.collapsed, key) }) },
    { label: t("sidebar.hideSection"), onClick: () => setUi(path, { ...ui, hidden: [...ui.hidden, key] }) },
  ];

  const renderSection = (s: RefSection) => {
    const items = q ? s.items.filter((r) => r.short.toLowerCase().includes(q)) : s.items;
    if (q && items.length === 0) return null;
    const open = q !== "" || !ui.collapsed.includes(s.key);
    // Remote : son profil (clé SSH) en pastille, à changer par un clic droit.
    const remote = remoteOf(s);
    const rp = remote && remoteProfile(profiles, binding, remote);
    const profileHint = rp && (rp.profile ? t(`remotes.hint.${rp.source}`, { name: rp.profile.name }) : t("remotes.hint.none"));
    // Provider reconnu d'après l'hôte : son icône, et le compte du profil du remote (API).
    const parsed = remote && parseRemote(remote.url);
    const provider = remoteProvider(profiles, parsed);
    const account = rp && remoteAccount(rp.profile, parsed);
    const accountHint =
      provider &&
      rp?.profile &&
      (account ? t("remotes.account", { provider: PROVIDER_NAMES[provider], login: account.login }) : t("remotes.accountNone", { provider: PROVIDER_NAMES[provider] }));
    // Détails du remote (URL, profil, compte) : en infobulle et lus avec l'en-tête.
    const details = remote ? [remote.url, remote.pushUrl && t("remotes.pushUrl", { url: remote.pushUrl }), profileHint, accountHint].filter(Boolean).join(" · ") : undefined;
    const ti = sectionTi(s.key);
    return (
      <div className="side-group" key={s.key}>
        <button
          className="section-h section-btn"
          role="treeitem"
          aria-level={1}
          aria-expanded={open}
          aria-description={details}
          data-ti={ti}
          title={remote ? [remote.name, remote.url, remote.pushUrl && t("remotes.pushUrl", { url: remote.pushUrl }), profileHint, accountHint, t("remotes.menuHint")].filter(Boolean).join("\n") : undefined}
          onClick={() => setUi(path, { ...ui, collapsed: toggle(ui.collapsed, s.key) })}
          onContextMenu={(e) => openContextMenu(e, remote ? remoteMenu(t, path, remote, refs) : sectionMenu(s.key, open))}
        >
          <Icon name="chevron" size={13} className={open ? "chev" : "chev closed"} />
          <span className="section-icon" data-provider={provider ?? undefined}>
            {provider && parsed ? (
              <RemoteMark mark={{ provider, url: remoteInstance(profiles, parsed, account), owner: remoteOwner(parsed), account: account?.id ?? null, host: parsed.host, repo: parsed.path }} />
            ) : (
              <Icon name={ICONS[s.kind]} size={15} />
            )}
          </span>
          <span className="section-name">{title(s)}</span>
          {rp?.profile && (
            <span className="section-profile" data-source={rp.source}>
              {rp.profile.image ? (
                <ProfileAvatar profile={rp.profile} className="pill-avatar" />
              ) : (
                <span className="dot" style={{ background: profileColor(rp.profile) }} />
              )}
              <span className="section-profile-name">{rp.profile.name}</span>
            </span>
          )}
          <span className="section-count">{items.length}</span>
        </button>
        {open &&
          (items.length === 0 ? (
            <p className="side-empty">{t("sidebar.empty")}</p>
          ) : (
            <ResizableBlock layoutKey={sectionKey(s.key)} label={t("layout.section", { name: title(s) })} className="side-content">
              <ul role="group">
                {s.kind === "tags" ? items.map((r) => refButton(r, r.short, 0, ti)) : renderNodes(s.key, refTree(items), 0, ti)}
              </ul>
            </ResizableBlock>
          ))}
      </div>
    );
  };

  return (
    <nav className="refs-sidebar" aria-label={t("sidebar.label")} style={widthStyle}>
      <div className="sidebar-tools" ref={menuRef}>
        <label className="sidebar-filter">
          <Icon name="search" size={15} />
          <input
            ref={filterInput}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              // Échap : vide le filtre ; un second Échap passe dans l'arbre.
              if (e.key !== "Escape") return;
              e.preventDefault();
              e.stopPropagation();
              if (filter) setFilter("");
              else tree.focus();
            }}
            placeholder={t("sidebar.filter")}
            aria-label={t("sidebar.filter")}
          />
          {filter && (
            <button
              type="button"
              className="filter-clear"
              aria-label={t("sidebar.clearFilter")}
              title={t("sidebar.clearFilter")}
              onClick={() => {
                setFilter("");
                filterInput.current?.focus();
              }}
            >
              <Icon name="close" size={12} />
            </button>
          )}
        </label>
        <button className="icon-btn bordered" aria-label={t("remotes.addButton")} title={t("remotes.addButton")} onClick={() => useOps.getState().addRemote(path)}>
          <Icon name="plus" size={15} />
        </button>
        <button
          ref={sectionsBtn}
          className="icon-btn bordered"
          aria-label={t("sidebar.sections")}
          aria-expanded={menuOpen}
          title={t("sidebar.sections")}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <Icon name="sliders" size={15} />
        </button>
        {menuOpen && (
          <div className="popover sections-menu" role="dialog" aria-label={t("sidebar.sections")}>
            <div className="eyebrow">{t("sidebar.sections")}</div>
            {sections.map((s) => (
              <label key={s.key} className="menu-check">
                <input type="checkbox" checked={!ui.hidden.includes(s.key)} onChange={() => setUi(path, { ...ui, hidden: toggle(ui.hidden, s.key) })} />
                {title(s)}
              </label>
            ))}
            {contexts.length > 0 && (
              <label className="menu-check">
                <input type="checkbox" checked={!ui.hidden.includes(PULLS_SECTION)} onChange={() => setUi(path, { ...ui, hidden: toggle(ui.hidden, PULLS_SECTION) })} />
                {t(`prv.section_${termOf(contexts)}`)}
              </label>
            )}
            {hasStashes && (
              <label className="menu-check">
                <input type="checkbox" checked={!ui.hidden.includes(STASHES_SECTION)} onChange={() => setUi(path, { ...ui, hidden: toggle(ui.hidden, STASHES_SECTION) })} />
                {t("stashes.section")}
              </label>
            )}
            <div className="menu-hint">{t("sidebar.sectionsHint")}</div>
          </div>
        )}
      </div>

      <div className="refs-tree" role="tree" aria-label={t("sidebar.tree")} ref={tree.root} onFocus={tree.onFocus} onKeyDown={tree.onKeyDown}>
        {shown.filter((s) => s.kind !== "tags").map(renderSection)}
        {refs?.remotes.length === 0 && !q && (
          <div className="side-group side-publish">
            <p className="side-empty">{t("publish.noRemote")}</p>
            <button className="btn side-publish-btn" title={t("publish.buttonHint")} onClick={() => usePublishDialog.getState().show(path)}>
              <Icon name="cloud" size={15} />
              {t("publish.sidebar")}
            </button>
          </div>
        )}
        {showPulls && <PullsSection path={path} contexts={contexts} query={q} ui={ui} />}
        {!ui.hidden.includes(STASHES_SECTION) && <StashesSection path={path} query={q} ui={ui} />}
        {shown.filter((s) => s.kind === "tags").map(renderSection)}
      </div>

      {noMatch && (
        <p className="side-empty side-nomatch" role="status">
          {t("sidebar.noMatch", { query: filter.trim() })}{" "}
          <button className="link" onClick={() => setFilter("")}>
            {t("sidebar.clearFilter")}
          </button>
        </p>
      )}
      {hiddenCount > 0 && (
        <button className="link side-hidden" onClick={() => setMenuOpen(true)}>
          {t("sidebar.hidden", { count: hiddenCount })}
        </button>
      )}
      {missing && (
        <p className="side-empty" role="status">
          {t("sidebar.notFound")}
        </p>
      )}
    </nav>
  );
}
