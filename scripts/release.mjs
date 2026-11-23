#!/usr/bin/env node
// Outils de release de GitGR, utilisés par les workflows `version.yml` et `release.yml` (et
// lançables en local) :
//
//   node scripts/release.mjs bump <patch|minor|major|current> [--prs prs.json] [--dry-run]
//       Nouvelle version : package.json, package-lock.json, src-tauri/Cargo.toml et
//       Cargo.lock ; la section « Non publié » de CHANGELOG.md devient celle de la version
//       (datée). Si elle est vide, elle est remplie avec les titres des PR fusionnées depuis le
//       tag précédent (`--prs` : sortie de `gh pr list --json number,title,mergedAt,url`).
//       `current` garde la version actuelle (première release). Écrit la version sur la sortie
//       standard, et dans $GITHUB_OUTPUT (`version=`) dans un workflow. Ne commite rien.
//
//   node scripts/release.mjs notes <version>
//       Notes de la release : la section de la version dans CHANGELOG.md.
//
//   node scripts/release.mjs manifest <version> <dossier> <url de base>
//       Manifeste `latest.json` de l'updater de Tauri, à partir des paquets signés du dossier
//       (`.sig` à côté de chaque paquet). Écrit sur la sortie standard.

import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const path = (p) => join(ROOT, p);
const read = (p) => readFileSync(path(p), "utf8");
const UNRELEASED = "## Non publié";

/** Version suivante selon le niveau (`current` : inchangée). */
export function nextVersion(version, level) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!m) throw new Error(`version invalide : ${version}`);
  const [major, minor, patch] = m.slice(1).map(Number);
  switch (level) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    case "current":
      return version;
    default:
      throw new Error(`niveau inconnu : ${level} (patch, minor, major ou current)`);
  }
}

/** Sections du changelog : `## …` jusqu'au titre suivant. */
function sections(changelog) {
  const lines = changelog.split("\n");
  const starts = lines.flatMap((l, i) => (l.startsWith("## ") ? [i] : []));
  const list = starts.map((start, k) => ({ title: lines[start], start, end: starts[k + 1] ?? lines.length }));
  return { lines, list };
}

/** Corps d'une section, sans lignes vides autour. */
function body(lines, s) {
  return lines.slice(s.start + 1, s.end).join("\n").trim();
}

/** La section « Non publié » devient celle de `version` ; une nouvelle « Non publié » vide
 *  est ajoutée au-dessus. `prs` remplit une section vide. */
export function releaseChangelog(changelog, version, date, prs = []) {
  const { lines, list } = sections(changelog);
  if (list.some((s) => s.title.startsWith(`## [${version}]`))) throw new Error(`CHANGELOG.md a déjà une section ${version}`);
  const unreleased = list.find((s) => s.title.trim() === UNRELEASED);
  if (!unreleased) throw new Error(`CHANGELOG.md : section « ${UNRELEASED} » introuvable`);
  let content = body(lines, unreleased);
  if (!content) {
    if (!prs.length) throw new Error("rien à publier : section « Non publié » vide et aucune PR fusionnée depuis le dernier tag");
    content = prs.map((p) => `- ${p.title} ([#${p.number}](${p.url}))`).join("\n");
  }
  const head = lines.slice(0, unreleased.start);
  const tail = lines.slice(unreleased.end);
  return [...head, UNRELEASED, "", `## [${version}] — ${date}`, "", content, "", ...tail].join("\n").replace(/\n{3,}/g, "\n\n");
}

/** Notes de `version` dans le changelog. */
export function releaseNotes(changelog, version) {
  const { lines, list } = sections(changelog);
  const s = list.find((x) => x.title.startsWith(`## [${version}]`));
  if (!s) throw new Error(`CHANGELOG.md : pas de section pour ${version}`);
  return body(lines, s);
}

/** Manifeste de l'updater : pour chaque plateforme, l'URL du paquet et sa signature. Clés
 *  `os-arch` et `os-arch-paquet` (le plugin essaie la seconde d'abord). */
export function manifest(version, notes, files, readSig, baseUrl, date) {
  const platforms = {};
  const add = (keys, file) => {
    if (!files.includes(`${file}.sig`)) throw new Error(`signature manquante : ${file}.sig`);
    const entry = { signature: readSig(`${file}.sig`).trim(), url: `${baseUrl}/${encodeURIComponent(file)}` };
    for (const k of keys) platforms[k] = entry;
  };
  const find = (re, what) => {
    const f = files.find((x) => re.test(x));
    if (!f) throw new Error(`paquet introuvable : ${what}`);
    return f;
  };
  add(["windows-x86_64", "windows-x86_64-nsis"], find(/-setup\.exe$/, "installateur NSIS"));
  add(["linux-x86_64", "linux-x86_64-appimage"], find(/\.AppImage$/, "AppImage"));
  const mac = files.find((x) => x.endsWith(".app.tar.gz"));
  if (mac) add(["darwin-x86_64", "darwin-aarch64", "darwin-x86_64-app", "darwin-aarch64-app"], mac);
  return { version, notes, pub_date: date, platforms };
}

function setVersion(version) {
  for (const p of ["package.json", "package-lock.json"]) {
    const json = JSON.parse(read(p));
    json.version = version;
    if (json.packages?.[""]) json.packages[""].version = version;
    writeFileSync(path(p), JSON.stringify(json, null, 2) + "\n");
  }
  const cargo = read("src-tauri/Cargo.toml");
  const updated = cargo.replace(/^(\[package\][^[]*?\nversion = ")[^"]+"/m, `$1${version}"`);
  if (updated === cargo && !cargo.includes(`version = "${version}"`)) throw new Error("src-tauri/Cargo.toml : version introuvable");
  writeFileSync(path("src-tauri/Cargo.toml"), updated);
  const lock = read("src-tauri/Cargo.lock");
  const lockUpdated = lock.replace(/(\[\[package\]\]\nname = "gitgr"\nversion = ")[^"]+"/, `$1${version}"`);
  if (!lockUpdated.includes(`name = "gitgr"\nversion = "${version}"`)) throw new Error("src-tauri/Cargo.lock : paquet gitgr introuvable");
  writeFileSync(path("src-tauri/Cargo.lock"), lockUpdated);
}

function bump(level, args) {
  const current = JSON.parse(read("package.json")).version;
  const cargoVersion = /^\[package\][^[]*?\nversion = "([^"]+)"/m.exec(read("src-tauri/Cargo.toml"))?.[1];
  if (cargoVersion !== current) throw new Error(`versions différentes : package.json ${current}, Cargo.toml ${cargoVersion}`);
  const version = nextVersion(current, level);
  const tags = execFileSync("git", ["tag", "--list", `v${version}`], { cwd: ROOT, encoding: "utf8" }).trim();
  if (tags) throw new Error(`le tag v${version} existe déjà`);
  const prsFile = args[args.indexOf("--prs") + 1];
  const prs = args.includes("--prs") && existsSync(prsFile) ? JSON.parse(readFileSync(prsFile, "utf8")) : [];
  const date = new Date().toISOString().slice(0, 10);
  const changelog = releaseChangelog(read("CHANGELOG.md"), version, date, prs);
  if (args.includes("--dry-run")) {
    console.error(`${current} → ${version}\n\n${releaseNotes(changelog, version)}`);
  } else {
    if (version !== current) setVersion(version);
    writeFileSync(path("CHANGELOG.md"), changelog);
  }
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`);
  console.log(version);
}

function main([cmd, ...args]) {
  if (cmd === "bump") return bump(args[0], args.slice(1));
  if (cmd === "notes") return console.log(releaseNotes(read("CHANGELOG.md"), args[0]));
  if (cmd === "manifest") {
    const [version, dir, baseUrl] = args;
    const files = readdirSync(dir);
    const notes = releaseNotes(read("CHANGELOG.md"), version);
    const out = manifest(version, notes, files, (f) => readFileSync(join(dir, f), "utf8"), baseUrl, new Date().toISOString());
    return console.log(JSON.stringify(out, null, 2));
  }
  throw new Error("usage : release.mjs bump <niveau> | notes <version> | manifest <version> <dossier> <url>");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(`release.mjs : ${e.message}`);
    process.exit(1);
  }
}
