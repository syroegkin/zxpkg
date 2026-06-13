// Gopher human face: mirror the registry website as gophermaps under the store,
// so the umbrella Gophernicus hub serves a browsable /pkg menu to ZX gopher
// clients. Regenerated on every rebuildIndex() (i.e. whenever the site changes).
//
// Formatted for nihirash's Moon Rabbit ZX Spectrum client at env.gopher.cols (64)
// columns. Gophermap lines (RFC 1436): tab-separated <type><display>\t<selector>\t
// <host>\t<port>; info lines use type 'i'. Selectors are absolute from the gopher
// root, so they carry env.gopher.prefix (e.g. /pkg).
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { query } from "./db";
import { store } from "./store";
import { env } from "./env";

interface PkgRow {
  name: string; version: string; type: string; description: string | null;
  machine: string; os_csv: string; command: string;
}
export interface GopherPkg {
  name: string; version: string; type: string; description: string;
  machine: string; os: string; commands: string[];
}

const TAB = "\t";
const cols = () => env.gopher.cols;

const sanitize = (s: string): string => (s || "").replace(/[\t\r\n]/g, " ");
const clip = (s: string): string => sanitize(s).slice(0, cols());

// info line — display text only (selector/host/port are inert for type 'i').
const info = (text = ""): string => `i${clip(text)}${TAB}fake${TAB}(NULL)${TAB}0`;

// resource line — type + display, pointing at <prefix><selector> on the hub.
const link = (type: string, display: string, selector: string): string =>
  `${type}${clip(display)}${TAB}${env.gopher.prefix}${selector}${TAB}${env.gopher.host}${TAB}${env.gopher.port}`;

// word-wrap to the client width; only hard-splits a word too long to ever fit.
function wrap(s: string): string[] {
  const words = sanitize(s).split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const out: string[] = [];
  let cur = "";
  for (let w of words) {
    while (w.length > cols()) {              // word longer than a whole line
      if (cur) { out.push(cur); cur = ""; }
      out.push(w.slice(0, cols()));
      w = w.slice(cols());
    }
    if (!cur) cur = w;
    else if ((cur + " " + w).length <= cols()) cur += " " + w;
    else { out.push(cur); cur = w; }        // word fits on its own line -> wrap to next
  }
  if (cur) out.push(cur);
  return out;
}

export function renderRootMap(pkgs: GopherPkg[]): string {
  const L = [info("ZXPkg — ZX Spectrum package registry"), info("")];
  for (const p of pkgs) {
    L.push(link("1", `${p.name} ${p.version} - ${p.description}`, `/p/${p.name}`));
  }
  return L.join("\r\n") + "\r\n";
}

export function renderPkgMap(p: GopherPkg): string {
  const L = [info(`${p.name} ${p.version}  [${p.type}]`), info("")];
  for (const line of wrap(p.description || "(no description)")) L.push(info(line));
  L.push(info(""), info(`machine: ${p.machine}   os: ${p.os}`), info(""), info("Download (signed):"));
  for (const cmd of p.commands) L.push(link("9", cmd, `/artifacts/${p.name}/${p.version}/${cmd}`));
  L.push(info(""), link("1", "< back to package list", ""));
  return L.join("\r\n") + "\r\n";
}

// group the latest-version artifact rows into one entry per package.
export function groupPkgs(rows: PkgRow[]): GopherPkg[] {
  const byName = new Map<string, GopherPkg>();
  for (const r of rows) {
    let p = byName.get(r.name);
    if (!p) {
      p = { name: r.name, version: r.version, type: r.type, description: r.description || "",
            machine: r.machine, os: r.os_csv, commands: [] };
      byName.set(r.name, p);
    }
    p.commands.push(r.command);
  }
  return [...byName.values()];
}

export async function rebuildGopher(): Promise<void> {
  const rows = await query<PkgRow>(
    `SELECT p.name, v.version, v.type, p.description, v.machine, v.os_csv, a.command
     FROM versions v
     JOIN packages p ON p.id = v.package_id
     JOIN artifacts a ON a.version_id = v.id
     WHERE v.is_latest = 1
     ORDER BY p.name, a.command`
  );
  const pkgs = groupPkgs(rows);
  mkdirSync(store.root, { recursive: true });
  writeFileSync(store.gopherRootMap(), renderRootMap(pkgs));
  rmSync(store.gopherPkgDir(""), { recursive: true, force: true }); // clear stale per-package menus
  for (const p of pkgs) {
    mkdirSync(store.gopherPkgDir(p.name), { recursive: true });
    writeFileSync(store.gopherPkgMap(p.name), renderPkgMap(p));
  }
}
