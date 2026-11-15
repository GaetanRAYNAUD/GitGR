import { describe, expect, it } from "vitest";
import {
  defaultKeyPath,
  hostMismatch,
  matchFolder,
  matchHost,
  matchRemote,
  nextColor,
  parseRemote,
  profileComplete,
  ruleKind,
  signingKeyMissing,
  slug,
  suggestProfile,
  uidEmail,
  validEmail,
  type Remote,
} from "./profiles";
import type { Profile } from "./types";

const HOME = "C:/Users/camille";

function profile(id: string, rules: string[], extra: Partial<Profile> = {}): Profile {
  return { id, name: id, userName: "Camille", userEmail: `${id}@exemple.fr`, sshKey: null, rules, color: 0, ...extra };
}

describe("règles des profils", () => {
  it("distingue hôtes et dossiers", () => {
    expect(ruleKind("github.com")).toBe("remote");
    expect(ruleKind("*.exemple.fr")).toBe("remote");
    expect(ruleKind("~/work")).toBe("folder");
    expect(ruleKind("C:\\work")).toBe("folder");
    expect(ruleKind("/home/c/work/*")).toBe("folder");
    expect(ruleKind("github.com/mon-org/*")).toBe("remote");
    expect(ruleKind("git@github.com:mon-org")).toBe("remote");
    expect(ruleKind("D:/repos")).toBe("folder");
  });

  it("hôtes : égalité sans casse, `*` pour un préfixe", () => {
    expect(matchHost("github.com", "GitHub.com")).toBe(true);
    expect(matchHost("github.com", "gist.github.com")).toBe(false);
    expect(matchHost("*.exemple.fr", "gitlab.exemple.fr")).toBe(true);
    expect(matchHost("*.exemple.fr", "exemple.fr")).toBe(false);
    // Le point n'est pas un joker.
    expect(matchHost("gitlab.exemple.fr", "gitlabxexemple.fr")).toBe(false);
    expect(matchHost("", "github.com")).toBe(false);
  });

  it("URL de remote : hôte et chemin", () => {
    expect(parseRemote("git@github.com:Mon-Org/Depot.git")).toEqual({ host: "github.com", path: "mon-org/depot" });
    expect(parseRemote("https://www.github.com/mon-org/depot/")).toEqual({ host: "github.com", path: "mon-org/depot" });
    expect(parseRemote("ssh://git@gitlab.exemple.fr:2222/groupe/sous/depot.git")).toEqual({ host: "gitlab.exemple.fr", path: "groupe/sous/depot" });
    expect(parseRemote("https://user:token@gitlab.com/g/r")).toEqual({ host: "gitlab.com", path: "g/r" });
    expect(parseRemote("C:/repos/remote.git")).toBeNull();
    expect(parseRemote("/srv/git/r.git")).toBeNull();
    expect(parseRemote("file:///srv/git/r.git")).toBeNull();
    expect(parseRemote(null)).toBeNull();
  });

  it("remote : hôte seul, ou hôte et chemin (organisation, groupe)", () => {
    const r = parseRemote("git@github.com:Mon-Org/depot.git") as Remote;
    for (const rule of ["github.com", "github.com/mon-org", "github.com/mon-org/*", "www.github.com/mon-org/*", "https://github.com/Mon-Org/", "git@github.com:mon-org", "github.com/mon-org/depot.git", "github.com/*/depot", "github.com/**"])
      expect(matchRemote(rule, r), rule).toBe(true);
    for (const rule of ["github.com/autre-org", "github.com/mon", "gitlab.com/mon-org", "github.com/mon-org/depot/x"])
      expect(matchRemote(rule, r), rule).toBe(false);
    const sub = parseRemote("https://gitlab.exemple.fr/groupe/sous-groupe/projet.git");
    expect(matchRemote("gitlab.exemple.fr/groupe", sub)).toBe(true);
    expect(matchRemote("gitlab.exemple.fr:2222/groupe/*", sub)).toBe(true);
    expect(matchRemote("*.exemple.fr/groupe/sous-groupe", sub)).toBe(true);
    expect(matchRemote("github.com", null)).toBe(false);
  });

  it("dossiers : le dépôt ou un sous-dossier, avec ~ et des jokers", () => {
    const repo = "C:/Users/camille/work/client-x/api";
    expect(matchFolder("~/work", repo, HOME)).toBe(true);
    expect(matchFolder("~/work/*", repo, HOME)).toBe(true);
    expect(matchFolder("~/work/**", repo, HOME)).toBe(true);
    expect(matchFolder("~\\work\\", repo, HOME)).toBe(true);
    expect(matchFolder("c:/users/CAMILLE/Work", repo, HOME)).toBe(true);
    expect(matchFolder("~/work/client-*/api", repo, HOME)).toBe(true);
    expect(matchFolder("~/wo", repo, HOME)).toBe(false);
    expect(matchFolder("~/perso", repo, HOME)).toBe(false);
    // Sans dossier personnel connu, `~` ne correspond à rien.
    expect(matchFolder("~/work", repo, null)).toBe(false);
    // Chemins Linux : la casse compte.
    expect(matchFolder("/home/c/Work", "/home/c/work/x", null)).toBe(false);
    expect(matchFolder("/home/c/work", "/home/c/work/x", null)).toBe(true);
  });

  it("suggestion : le dossier l'emporte sur le remote, puis la règle la plus précise", () => {
    const perso = profile("perso", ["github.com"]);
    const boulot = profile("boulot", ["~/work"]);
    const client = profile("client", ["~/work/client-x"]);
    const ctx = (path: string, host: string | null) => ({ path, remote: host ? { host, path: "o/r" } : null, home: HOME });
    expect(suggestProfile([perso, boulot], ctx("C:/Users/camille/work/a", "github.com"))?.id).toBe("boulot");
    expect(suggestProfile([perso, boulot], ctx("C:/Users/camille/perso/a", "github.com"))?.id).toBe("perso");
    expect(suggestProfile([perso, boulot, client], ctx("C:/Users/camille/work/client-x/a", null))?.id).toBe("client");
    expect(suggestProfile([perso, boulot], ctx("D:/autre", "gitlab.com"))).toBeNull();
    expect(suggestProfile([], ctx("D:/autre", "github.com"))).toBeNull();
    // Une organisation GitHub l'emporte sur github.com tout court.
    const org = profile("org", ["github.com/mon-org/*"]);
    const at = (url: string) => ({ path: "D:/x", remote: parseRemote(url), home: HOME });
    expect(suggestProfile([perso, org], at("git@github.com:mon-org/api.git"))?.id).toBe("org");
    expect(suggestProfile([perso, org], at("git@github.com:camille/dotfiles.git"))?.id).toBe("perso");
  });

  it("garde-fou : un autre profil correspond à l'hôte, pas l'actif", () => {
    const perso = profile("perso", ["github.com"]);
    const boulot = profile("boulot", ["gitlab.boulot.fr", "~/work"]);
    const neutre = profile("neutre", []);
    const all = [perso, boulot, neutre];
    const at = (host: string | null, path = "D:/ailleurs") => ({ path, remote: host ? { host, path: "o/r" } : null, home: HOME });
    expect(hostMismatch(all, "perso", at("gitlab.boulot.fr"))?.id).toBe("boulot");
    expect(hostMismatch(all, "neutre", at("github.com"))?.id).toBe("perso");
    expect(hostMismatch(all, "perso", at("github.com"))).toBeNull();
    // Personne d'autre ne correspond : rien à signaler.
    expect(hostMismatch(all, "perso", at("bitbucket.org"))).toBeNull();
    expect(hostMismatch(all, null, at("github.com"))).toBeNull();
    expect(hostMismatch(all, "perso", at(null))).toBeNull();
    // Profil actif désigné par son dossier (choix de la sélection automatique) : pas d'alerte,
    // même si l'hôte correspond à un autre profil.
    expect(hostMismatch(all, "boulot", at("github.com", "C:/Users/camille/work/x"))).toBeNull();
    expect(hostMismatch(all, "boulot", at("github.com"))?.id).toBe("perso");
    // Organisation : le profil générique github.com est signalé sur un dépôt de l'organisation.
    const org = profile("org", ["github.com/mon-org"]);
    const remote = parseRemote("https://github.com/mon-org/api");
    expect(hostMismatch([perso, org], "perso", { path: "D:/x", remote, home: HOME })?.id).toBe("org");
    expect(hostMismatch([perso, org], "org", { path: "D:/x", remote, home: HOME })).toBeNull();
  });
});

describe("petites fonctions des profils", () => {
  it("slug et chemin de clé proposé", () => {
    expect(slug("Équipe Boulot !")).toBe("equipe_boulot");
    expect(slug("***")).toBe("profil");
    expect(defaultKeyPath("C:\\Users\\c\\", "Perso")).toBe("C:/Users/c/.ssh/gitgr_perso_ed25519");
    expect(defaultKeyPath(null, "Perso")).toBe("~/.ssh/gitgr_perso_ed25519");
  });

  it("couleur suivante : la moins utilisée", () => {
    expect(nextColor([])).toBe(0);
    expect(nextColor([profile("a", [], { color: 0 }), profile("b", [], { color: 1 })])).toBe(2);
    expect(nextColor([0, 1, 2, 3, 0].map((c, i) => profile(String(i), [], { color: c })))).toBe(1);
  });

  it("profil complet et e-mail valide", () => {
    expect(validEmail(" a@b.fr ")).toBe(true);
    expect(validEmail("a b@c")).toBe(false);
    expect(validEmail("abc")).toBe(false);
    expect(profileComplete(profile("p", []))).toBe(true);
    expect(profileComplete(profile("p", [], { userName: " " }))).toBe(false);
    expect(profileComplete(profile("p", [], { name: "" }))).toBe(false);
  });
});

describe("signature des commits", () => {
  it("signature SSH : une clé (de signature ou du profil) est nécessaire", () => {
    const base = profile("p", []);
    expect(signingKeyMissing({ ...base, signing: "ssh" })).toBe(true);
    expect(profileComplete({ ...base, signing: "ssh" })).toBe(false);
    expect(signingKeyMissing({ ...base, signing: "ssh", sshKey: "~/.ssh/id" })).toBe(false);
    expect(signingKeyMissing({ ...base, signing: "ssh", signingKey: " ~/.ssh/sign " })).toBe(false);
    expect(signingKeyMissing({ ...base, signing: "gpg" })).toBe(false);
  });

  it("e-mail d'une identité GPG", () => {
    expect(uidEmail("Camille Dupont <Camille@Exemple.fr>")).toBe("camille@exemple.fr");
    expect(uidEmail("camille@exemple.fr")).toBe("camille@exemple.fr");
  });
});
