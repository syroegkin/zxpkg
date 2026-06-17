// Gopher human face: mirror the registry website as gophermaps under the store,
// so the umbrella Gophernicus hub serves a browsable /pkg menu to ZX gopher
// clients. Regenerated on every rebuildIndex() (i.e. whenever the site changes).
//
// Formatted for nihirash's Moon Rabbit ZX Spectrum client at env.gopher.cols (64)
// columns. Gophermap lines (RFC 1436): tab-separated <type><display>\t<selector>\t
// <host>\t<port>; info lines use type 'i'. Selectors are absolute from the gopher
// root, so they carry env.gopher.prefix (e.g. /pkg).
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { query } from "./db";
import { store } from "./store";
import { env } from "./env";

interface PkgRow {
  name: string; version: string; type: string; description: string | null;
  machine_csv: string; os_csv: string; homepage: string | null; command: string | null;
}
export interface GopherPkg {
  name: string; version: string; type: string; description: string;
  machine: string; os: string; homepage: string; commands: string[];
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

// external http(s) link — gopher type 'h' with a "URL:" selector (clients open it directly).
const extlink = (display: string, url: string): string =>
  `h${clip(display)}${TAB}URL:${url}${TAB}${env.gopher.host}${TAB}${env.gopher.port}`;

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

// --- markdown -> plain-text gopher doc (type 0), reflowed to the client width ---
export interface DocLink { slug: string; title: string; file: string; }
export const DOCS: DocLink[] = [
  { slug: "docs",   title: "Guide: dot commands & how to install", file: "docs.md" },
  { slug: "client", title: "On-device client (.pkg / .pkg-inst)",   file: "client.md" },
  { slug: "wifi",   title: "Installing packages over WiFi",         file: "wifi.md" },
];

const stripInline = (s: string): string => s
  .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")   // [text](url) -> text (url)
  .replace(/\*\*([^*]+)\*\*/g, "$1")
  .replace(/\*([^*]+)\*/g, "$1")
  .replace(/_([^_]+)_/g, "$1")
  .replace(/`([^`]+)`/g, "$1");

const wrapWords = (words: string[], c: number): string[] => {
  const out: string[] = [];
  let cur = "";
  for (let w of words) {
    while (w.length > c) { if (cur) { out.push(cur); cur = ""; } out.push(w.slice(0, c)); w = w.slice(c); }
    if (!cur) cur = w;
    else if ((cur + " " + w).length <= c) cur += " " + w;
    else { out.push(cur); cur = w; }
  }
  if (cur) out.push(cur);
  return out.length ? out : [""];
};

// Lightweight markdown: headings (underlined), paragraphs (reflowed), -/*/N. lists
// (hanging indent), ``` code (verbatim). Inline **/_/`/[]() are flattened.
export function md2gopher(md: string, c: number = env.gopher.cols): string {
  const out: string[] = [];
  let para: string[] = [];
  let item: string[] | null = null;
  let marker = "";
  let code = false;
  const flushPara = () => { if (para.length) { out.push(...wrapWords(para, c)); para = []; } };
  const flushItem = () => {
    if (item) {
      const ind = " ".repeat(marker.length);
      wrapWords(item, Math.max(8, c - marker.length)).forEach((ln, i) => out.push((i ? ind : marker) + ln));
      item = null; marker = "";
    }
  };
  const flush = () => { flushPara(); flushItem(); };
  for (const raw of md.replace(/\r\n/g, "\n").split("\n")) {
    if (raw.trim().startsWith("```")) { flush(); code = !code; continue; }
    if (code) { out.push("  " + raw); continue; }
    const line = raw.trim();
    if (line === "") { flush(); out.push(""); continue; }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      const t = stripInline(h[2]);
      out.push("");
      if (h[1].length === 1) { out.push(t.toUpperCase().slice(0, c)); out.push("=".repeat(Math.min(t.length, c))); }
      else if (h[1].length === 2) { out.push(t.slice(0, c)); out.push("-".repeat(Math.min(t.length, c))); }
      else out.push(t.slice(0, c));
      out.push("");
      continue;
    }
    const li = /^([-*]|\d+\.)\s+(.*)$/.exec(line);
    if (li) { flush(); marker = li[1] === "-" || li[1] === "*" ? "- " : li[1] + " "; item = stripInline(li[2]).split(/\s+/).filter(Boolean); continue; }
    const words = stripInline(line).split(/\s+/).filter(Boolean);
    if (item) item.push(...words); else para.push(...words);
  }
  flush();
  return out.join("\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "") + "\n";
}

export function renderRootMap(pkgs: GopherPkg[], docs: DocLink[] = []): string {
  const L = [info("ZXPkg — ZX Spectrum package registry"), info("")];
  if (docs.length) {
    L.push(info("Help & how-to:"));
    for (const d of docs) L.push(link("0", d.title, `/${d.slug}`));
    L.push(info(""), info("Packages:"));
  }
  for (const p of pkgs) {
    L.push(link("1", `${p.name} ${p.version} - ${p.description}`, `/p/${p.name}`));
  }
  return L.join("\r\n") + "\r\n";
}

export function renderPkgMap(p: GopherPkg): string {
  const L = [info(`${p.name} ${p.version}  [${p.type}]`), info("")];
  for (const line of wrap(p.description || "(no description)")) L.push(info(line));
  L.push(info(""), info(`machine: ${p.machine}   os: ${p.os}`), info(""));
  if (p.commands.length) {
    L.push(info("Download (signed):"));
    for (const cmd of p.commands) L.push(link("9", cmd, `/artifacts/${p.name}/${p.version}/${cmd}`));
  } else {
    L.push(info("No on-device artifact yet — browse on the web:"));
    if (p.homepage) L.push(extlink(p.homepage, p.homepage));
  }
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
            machine: r.machine_csv, os: r.os_csv, homepage: r.homepage || "", commands: [] };
      byName.set(r.name, p);
    }
    if (r.command) p.commands.push(r.command); // link-only (catalog) packages have no artifact
  }
  return [...byName.values()];
}

export async function rebuildGopher(): Promise<void> {
  const rows = await query<PkgRow>(
    `SELECT p.name, v.version, v.type, p.description, v.machine_csv, v.os_csv, p.homepage, a.command
     FROM versions v
     JOIN packages p ON p.id = v.package_id
     LEFT JOIN artifacts a ON a.version_id = v.id
     WHERE v.is_latest = 1 AND p.archive_state = 'listed'
     ORDER BY p.name, a.command`
  );
  const pkgs = groupPkgs(rows);
  mkdirSync(store.root, { recursive: true });

  // help/how-to: markdown (content/) -> 64-col text docs; skip any not deployed
  const docs: DocLink[] = [];
  for (const d of DOCS) {
    try {
      const md = readFileSync(join(process.cwd(), "content", d.file), "utf8");
      writeFileSync(store.gopherDocFile(d.slug), md2gopher(md));
      docs.push(d);
    } catch {
      /* content file absent in this deploy — just omit its menu entry */
    }
  }

  writeFileSync(store.gopherRootMap(), renderRootMap(pkgs, docs));
  rmSync(store.gopherPkgDir(""), { recursive: true, force: true }); // clear stale per-package menus
  for (const p of pkgs) {
    mkdirSync(store.gopherPkgDir(p.name), { recursive: true });
    writeFileSync(store.gopherPkgMap(p.name), renderPkgMap(p));
  }
}
