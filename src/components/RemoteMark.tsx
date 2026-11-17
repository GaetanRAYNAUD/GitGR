// Icône d'un remote : avatar du propriétaire du dépôt (organisation, groupe, utilisateur) avec la
// marque du provider en petit. Barre latérale (en-tête des sections distantes) et étiquettes du graphe.

import { parseRemote, remoteProfile } from "../lib/profiles";
import { remoteAccount, remoteInstance, remoteOwner, remoteProvider } from "../lib/providers";
import type { Profile, ProviderKind, RemoteInfo, RepoProfiles } from "../lib/types";
import { useOwnerAvatar } from "../store/avatars";
import { Icon } from "./Icon";

/** De quoi dessiner l'icône d'un remote. */
export interface RemoteMarkInfo {
  provider: ProviderKind;
  /** Instance (API) du provider. */
  url: string | null;
  owner: string | null;
  /** Compte dont le token sert. */
  account: string | null;
  /** Hôte du remote (minuscules). */
  host: string;
  /** Dépôt `propriétaire/nom` (minuscules). */
  repo: string;
}

/** Provider reconnu d'après l'hôte du remote, propriétaire du dépôt et compte du profil du remote ;
 *  `null` : provider inconnu (dépôt local, hôte non reconnu). */
export function remoteMarkOf(profiles: Profile[], binding: RepoProfiles | undefined, remote: Pick<RemoteInfo, "name" | "url">): RemoteMarkInfo | null {
  const parsed = parseRemote(remote.url);
  const provider = remoteProvider(profiles, parsed);
  if (!provider || !parsed) return null;
  const account = remoteAccount(remoteProfile(profiles, binding, remote).profile, parsed);
  return { provider, url: remoteInstance(profiles, parsed, account), owner: remoteOwner(parsed), account: account?.id ?? null, host: parsed.host, repo: parsed.path };
}

/** L'avatar du propriétaire avec la marque du provider en petit, sinon la seule marque. */
export function RemoteMark({ mark, size = 15, className }: { mark: RemoteMarkInfo; size?: number; className?: string }) {
  const avatar = useOwnerAvatar(mark.provider, mark.url, mark.owner, mark.account);
  if (!avatar) return <Icon name={mark.provider} size={size} className={className} />;
  return (
    <span className={className ? `remote-mark ${className}` : "remote-mark"}>
      <img className="remote-avatar" src={avatar} alt="" draggable={false} />
      <span className="remote-badge">
        <Icon name={mark.provider} size={Math.round(size * 0.6)} />
      </span>
    </span>
  );
}
