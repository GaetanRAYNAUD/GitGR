import { describe, expect, it } from "vitest";
import { parseRemote } from "./profiles";
import { instance, instanceHost, instanceLabel, remoteAccount, remoteProvider, tokenPageUrl, withAccount } from "./providers";
import cases from "./providerUrls.cases.json";
import type { Account, Profile, ProviderKind } from "./types";

const account = (kind: ProviderKind, url: string, login: string): Account => ({ id: `${kind}|${url}|${login}`, kind, url, login, name: null });

const profile = (id: string, accounts: Account[]): Profile => ({
  id,
  name: id,
  userName: id,
  userEmail: `${id}@exemple.fr`,
  sshKey: null,
  rules: [],
  color: 0,
  accounts,
});

describe("instance", () => {
  // Cas partagés avec le backend (providers.rs) : mêmes résultats des deux côtés.
  it.each(cases.cases)("$kind « $input » → $url", ({ kind, input, url, api }) => {
    expect(instance(kind as ProviderKind, input)).toEqual(url === null ? null : { url, api });
  });

  it("hôte et libellé d'une instance", () => {
    expect(instanceHost("https://gitlab.exemple.fr:8443/outils")).toBe("gitlab.exemple.fr");
    expect(instanceHost("https://github.com")).toBe("github.com");
    expect(instanceLabel("https://gitlab.exemple.fr/outils")).toBe("gitlab.exemple.fr/outils");
    expect(instanceLabel("http://gitlab.local:8080")).toBe("http://gitlab.local:8080");
  });
});

describe("tokenPageUrl", () => {
  it("ouvre la page de création sur la bonne instance, droits pré-cochés", () => {
    expect(tokenPageUrl("github", "https://github.com")).toBe(
      "https://github.com/settings/tokens/new?description=GitGR&scopes=repo,read:user,read:org,admin:public_key,admin:ssh_signing_key,write:gpg_key",
    );
    expect(tokenPageUrl("gitlab", "https://gitlab.exemple.fr/outils")).toBe(
      "https://gitlab.exemple.fr/outils/-/user_settings/personal_access_tokens?name=GitGR&scopes=api,read_user",
    );
  });
});

describe("remoteProvider", () => {
  const profiles = [profile("perso", []), profile("boulot", [account("gitlab", "https://code.exemple.fr", "camille")])];

  it("reconnaît github.com, gitlab.com et les noms d'hôte parlants", () => {
    expect(remoteProvider([], parseRemote("git@github.com:org/depot.git"))).toBe("github");
    expect(remoteProvider([], parseRemote("https://gitlab.com/groupe/depot"))).toBe("gitlab");
    expect(remoteProvider([], parseRemote("git@gitlab.exemple.fr:groupe/depot.git"))).toBe("gitlab");
    expect(remoteProvider([], parseRemote("git@github.exemple.fr:org/depot.git"))).toBe("github");
    expect(remoteProvider([], parseRemote("ssh://git@ssh.github.com:443/org/depot.git"))).toBe("github");
  });

  it("reconnaît l'instance d'un compte connecté, quel que soit le profil", () => {
    expect(remoteProvider([], parseRemote("git@code.exemple.fr:groupe/depot.git"))).toBeNull();
    expect(remoteProvider(profiles, parseRemote("git@code.exemple.fr:groupe/depot.git"))).toBe("gitlab");
  });

  it("ne devine rien pour un hôte quelconque ou un chemin local", () => {
    expect(remoteProvider(profiles, parseRemote("git@exemple.fr:depot.git"))).toBeNull();
    expect(remoteProvider(profiles, parseRemote("git@mongithub.fr:depot.git"))).toBeNull();
    expect(remoteProvider(profiles, parseRemote("/srv/git/depot.git"))).toBeNull();
    expect(remoteProvider(profiles, null)).toBeNull();
  });
});

describe("remoteAccount", () => {
  const gh = account("github", "https://github.com", "octo");
  const gl = account("gitlab", "https://gitlab.exemple.fr:8443", "camille");
  const p = profile("p", [gh, gl]);

  it("prend le compte du profil dont l'instance est sur l'hôte du remote", () => {
    expect(remoteAccount(p, parseRemote("git@github.com:org/depot.git"))).toBe(gh);
    // Le port de l'interface web n'est pas celui de ssh : seul l'hôte compte.
    expect(remoteAccount(p, parseRemote("ssh://git@gitlab.exemple.fr:2222/groupe/depot.git"))).toBe(gl);
  });

  it("aucun compte pour un autre hôte, sans profil ou sans remote", () => {
    expect(remoteAccount(p, parseRemote("git@gitlab.com:groupe/depot.git"))).toBeNull();
    expect(remoteAccount(null, parseRemote("git@github.com:org/depot.git"))).toBeNull();
    expect(remoteAccount(p, null)).toBeNull();
    expect(remoteAccount(profile("vide", []), parseRemote("git@github.com:org/depot.git"))).toBeNull();
  });
});

describe("withAccount", () => {
  it("ajoute un compte, ou remplace celui de la même instance", () => {
    const octo = account("github", "https://github.com", "octo");
    const autre = account("github", "https://github.com", "autre");
    const gl = account("gitlab", "https://gitlab.com", "octo");
    expect(withAccount(undefined, octo)).toEqual([octo]);
    expect(withAccount([octo, gl], autre)).toEqual([gl, autre]);
  });
});
