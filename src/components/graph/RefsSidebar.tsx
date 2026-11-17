// Barre latérale : branches locales, distantes (une section par remote) et tags.
// Sections repliables et masquables, choix mémorisés par dépôt.

import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { parseRemote, profileColor, remoteProfile } from "../../lib/profiles";
import { PROVIDER_NAMES, remoteAccount, remoteInstance, remoteOwner, remoteProvider } from "../../lib/providers";
import { refSections, refTree, type RefNode, type RefSection } from "../../lib/refs";
import type { GitRef, RemoteInfo, RepoUi } from "../../lib/types";
import { LAYOUT, sectionKey, useWidthStyle } from "../../lib/layout";
import { useDismiss } from "../../lib/useDismiss";
import { useApp } from "../../store/app";
import { useGraph } from "../../store/graph";
import { useOps } from "../../store/ops";
import { useProfiles } from "../../store/profiles";
import { openContextMenu } from "../ContextMenu";
import { Icon, type IconName } from "../Icon";
import { ProfileAvatar } from "../ProfileAvatar";
import { RemoteMark } from "../RemoteMark";
import { checkoutRef, refMenu, remoteMenu } from "./menus";
import { ResizableBlock } from "../Splitter";

/** Par défaut, les tags sont repliés (souvent nombreux). */
export const DEFAULT_REPO_UI: RepoUi = { collapsed: ["tags"], hidden: [] };

const ICONS: Record<RefSection["kind"], IconName> = { local: "folder", remote: "cloud", tags: "tag" };

function toggle(list: string[], key: string): string[] {
  return list.includes(key) ? list.filter((k) => k !== key) : [...list, key];
}

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
  const menuRef = useRef<HTMLDivElement>(null);

  const profiles = useProfiles((s) => s.profiles);
  const binding = useProfiles((s) => s.repoProfiles[path]);

  const sections = useMemo(() => refSections(refs), [refs]);
  /** Remote d'une section distante (sans URL connue si git ne le liste plus). */
  const remoteOf = (s: RefSection): RemoteInfo | null =>
    s.kind === "remote" ? (refs?.remotes.find((r) => r.name === s.remote) ?? { name: s.remote!, url: null, pushUrl: null }) : null;
  const title = (s: RefSection) => (s.kind === "local" ? t("sidebar.local") : s.kind === "tags" ? t("sidebar.tags") : s.remote!);
  const shown = sections.filter((s) => !ui.hidden.includes(s.key));
  const hiddenCount = sections.length - shown.length;
  const q = filter.trim().toLowerCase();

  const closeMenu = useCallback(() => setMenuOpen(false), []);
  useDismiss(menuRef, menuOpen, closeMenu);

  const go = async (r: GitRef) => {
    setMissing(null);
    if (!(await reveal(path, r.target))) setMissing(r.name);
  };

  const refButton = (r: GitRef, label: string, depth: number) => {
    const current = r.kind === "local" && r.short === refs?.headBranch;
    const meta = [r.ahead ? `↑${r.ahead}` : "", r.behind ? `↓${r.behind}` : ""].filter(Boolean).join(" ");
    const cls = ["side-item", current && "current", selected === r.target && "sel"].filter(Boolean).join(" ");
    return (
      <li key={r.name}>
        <button
          className={cls}
          style={{ "--depth": depth } as React.CSSProperties}
          onClick={() => go(r)}
          onDoubleClick={() => checkoutRef(path, r, refs)}
          onContextMenu={(e) => openContextMenu(e, refMenu(t, path, r, refs))}
          title={missing === r.name ? t("sidebar.notFound") : r.kind === "tag" ? r.short : `${r.short}\n${t("sidebar.dblClick")}`}
        >
          <span className="side-label">{label}</span>
          {r.gone && <span className="side-meta">{t("sidebar.gone")}</span>}
          {meta && <span className="side-meta">{meta}</span>}
        </button>
      </li>
    );
  };

  /** Branches rangées en dossiers selon les `/` (`feature/…`) ; dossiers repliables, mémorisés. */
  const renderNodes = (section: string, nodes: RefNode[], depth: number): React.ReactNode =>
    nodes.map((n) => {
      if (n.type === "ref") return refButton(n.ref, n.name, depth);
      const key = `${section}/${n.path}`;
      const open = q !== "" || !ui.collapsed.includes(key);
      return (
        <li key={key}>
          <button
            className="side-item side-folder"
            style={{ "--depth": depth } as React.CSSProperties}
            aria-expanded={open}
            onClick={() => setUi(path, { ...ui, collapsed: toggle(ui.collapsed, key) })}
          >
            <Icon name="chevron" size={12} className={open ? "chev" : "chev closed"} />
            <Icon name="folder" size={14} />
            <span className="side-label">{n.name}</span>
            <span className="side-meta">{n.count}</span>
          </button>
          {open && <ul>{renderNodes(section, n.children, depth + 1)}</ul>}
        </li>
      );
    });

  return (
    <nav className="refs-sidebar" aria-label={t("sidebar.label")} style={widthStyle}>
      <div className="sidebar-tools" ref={menuRef}>
        <label className="sidebar-filter">
          <Icon name="search" size={15} />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t("sidebar.filter")} aria-label={t("sidebar.filter")} />
        </label>
        <button className="icon-btn bordered" aria-label={t("remotes.addButton")} title={t("remotes.addButton")} onClick={() => useOps.getState().addRemote(path)}>
          <Icon name="plus" size={15} />
        </button>
        <button
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
                <input
                  type="checkbox"
                  checked={!ui.hidden.includes(s.key)}
                  onChange={() => setUi(path, { ...ui, hidden: toggle(ui.hidden, s.key) })}
                />
                {title(s)}
              </label>
            ))}
            <div className="menu-hint">{t("sidebar.sectionsHint")}</div>
          </div>
        )}
      </div>

      {shown.map((s) => {
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
        return (
          <div className="side-group" key={s.key}>
            <button
              className="section-h section-btn"
              aria-expanded={open}
              title={remote ? [remote.url, remote.pushUrl && t("remotes.pushUrl", { url: remote.pushUrl }), profileHint, accountHint, t("remotes.menuHint")].filter(Boolean).join("\n") : undefined}
              onClick={() => setUi(path, { ...ui, collapsed: toggle(ui.collapsed, s.key) })}
              onContextMenu={remote ? (e) => openContextMenu(e, remoteMenu(t, path, remote, refs)) : undefined}
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
                <ResizableBlock
                  layoutKey={sectionKey(s.key)}
                  label={t("layout.section", { name: title(s) })}
                  className="side-content"
                >
                  <ul>
                    {s.kind === "tags"
                      ? items.map((r) => refButton(r, r.short, 0))
                      : renderNodes(s.key, refTree(items), 0)}
                  </ul>
                </ResizableBlock>
              ))}
          </div>
        );
      })}

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

