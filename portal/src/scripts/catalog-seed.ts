// catalog-seed.ts — convert the community esxDOS DOT-commands sheet (CSV) into a
// LIGHT, editable catalog seed (YAML).  Each row becomes a metadata + link-only
// package: browsable on the portal, original download URL preserved, NOT signed
// and NOT in the device index until a binary is uploaded/crawled later.
//
// This is a best-effort mapping — hand-edit the output. Re-run to regenerate.
//   npx tsx src/scripts/catalog-seed.ts [in.csv] [out.yaml]
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { stringify } from "yaml";

const IN = resolve(process.cwd(), process.argv[2] || "seed/dot-commands.csv");
const OUT = resolve(process.cwd(), process.argv[3] || "seed/catalog.yaml");

// ---- RFC4180-ish CSV parser (handles quotes, "" escapes, embedded newlines) ----
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\r") { /* skip */ }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const clean = (s: string | undefined) => (s || "").replace(/\s+/g, " ").trim();

// Extract a github/gitlab repo root from any of the given URLs (download / found-on),
// so the package can link to (and mirror) its git source. null if none look like a repo.
function toRepo(...urls: (string | undefined)[]): string | null {
  for (const u of urls) {
    const m = (u || "").match(/^https?:\/\/(?:www\.)?(github\.com|gitlab\.com)\/(.+)$/i);
    if (!m) continue;
    const host = m[1].toLowerCase();
    const segs = m[2].split(/[?#]/)[0].split("/-/")[0].split("/").filter(Boolean); // drop query + gitlab /-/
    if (segs.length < 2) continue;
    return `https://${host}/${segs[0]}/${segs[1].replace(/\.git$/, "")}`;
  }
  return null;
}

// command name -> registry slug (lowercase, strip leading dot + trailing notes)
function toName(rawCmd: string): string {
  let s = (rawCmd || "").trim().replace(/^\./, "");
  s = s.split(/[\s(]/)[0];                 // first token before space / "("
  return s.toLowerCase().replace(/[^a-z0-9._-]/g, "");
}

function toVersion(raw: string): string {
  const v = clean(raw).split(/[\s(]/)[0].replace(/^v/i, "");
  return v || "0";
}

// known-good machine SET from the free-text hardware/comment columns
function machineSet(hw: string, comment: string): string[] {
  // Base the decision on the "Special Hardware required?" column (hw); require an
  // explicit "... only" so package names like "New File Browser for ZX-UNO" don't
  // mis-tag a plain esxDOS tool. Fall back to the comment for clear cases.
  const lc = (hw + " " + comment).toLowerCase();
  if (/zx-?uno only/.test(lc)) return ["zxuno"];
  if (/specnext only|spec next only|next only|requires nextzxos|nextzxos only/.test(lc)) return ["next"];
  return ["48k", "128k"];                  // DEFAULT for plain esxDOS — review!
}
function osSet(machine: string[]): string[] {
  if (machine.includes("next")) return ["nextzxos"];
  return ["esxdos"];
}
// closed needs enum, detected from text
function needsSet(hw: string, comment: string): string[] {
  const lc = (hw + " " + comment).toLowerCase();
  const needs: string[] = [];
  if (/divtiesus/.test(lc)) needs.push("divtiesus");
  if (/divmmc/.test(lc)) needs.push("divmmc");
  if (/divide\b/.test(lc)) needs.push("divide");
  if (/mb03/.test(lc)) needs.push("mb03plus");
  if (/element zx|elemnt zx|\bezx\b|element-zx/.test(lc)) needs.push("ezx");
  if (/\brtc\b|realtime|real-time clock/.test(lc)) needs.push("rtc");
  if (/wifi|esp8266|esp-01|\besp\b/.test(lc)) needs.push("wifi");
  if (/raspberry|\bpi ?0\b|pi zero|\brpi/.test(lc)) needs.push("rpi0");
  if (/accelerator/.test(lc)) needs.push("accelerator");
  if (/\b2 ?mb\b/.test(lc)) needs.push("2mb");
  return [...new Set(needs)];
}
// provenance: "ESXDOS 0.8.6 Final" -> "esxdos 0.8.6 final"; "---"/blank -> null
function bundledIn(raw: string): string | null {
  const s = clean(raw);
  if (!s || s === "---") return null;
  return /esxdos|next/i.test(s) ? s.toLowerCase() : "esxdos " + s.toLowerCase();
}
function redistributable(comment: string, fn: string): boolean {
  const lc = (comment + " " + fn).toLowerCase();
  return !/paid|name your own price|not free|no distribution|don.?t distribute|us dollar|copyleft/.test(lc);
}

// ---- parse + map ----
const rows = parseCsv(readFileSync(IN, "utf8"));
interface Entry {
  name: string; version: string; type: string;
  machine: string[]; os: string[]; needs: string[];
  author: string | null; homepage: string | null; description: string;
  download: string | null; repo: string | null; bundled_in: string | null; redistributable: boolean;
}
const out: Entry[] = [];
const seen = new Set<string>();
let skippedOlder = 0;

for (const r of rows) {
  const col0 = r[0] || "";
  // a data row is a command: starts with "." + non-space (or the lone "loadtap")
  if (!(/^\.\S/.test(col0) || col0.trim() === "loadtap")) continue;
  if (/system-command/i.test(col0)) continue;        // header row
  if (/\(older\)/i.test(col0)) { skippedOlder++; continue; } // latest-per-command

  const [, version, hw, comment, firstIn, author, download, foundOn, , fn] = r;
  const name = toName(col0);
  if (!name || seen.has(name)) continue;             // dedupe (first = newest)
  seen.add(name);

  const machine = machineSet(hw || "", comment || "");
  const home = clean(foundOn) || clean(download) || null;
  // Some sheet rows are column-shifted and dump a note/URL into Author — drop those.
  const auth = clean(author);
  out.push({
    name,
    version: toVersion(version || ""),
    type: "dot",                                     // review: some are game/util/demo
    machine,
    os: osSet(machine),
    needs: needsSet(hw || "", comment || ""),
    author: auth && auth.length <= 48 && !/https?:\/\//.test(auth) ? auth : null,
    homepage: home && /^https?:\/\//.test(home) ? home : null,
    description: (clean(fn) || clean(comment)).slice(0, 240),
    download: clean(download) && /^https?:\/\//.test(clean(download)) ? clean(download) : null,
    repo: toRepo(clean(download), clean(foundOn)),
    bundled_in: bundledIn(firstIn || ""),
    redistributable: redistributable(comment || "", fn || ""),
  });
}

const header =
  "# Light catalog seed derived from portal/seed/dot-commands.csv (esxDOS DOT-commands sheet V025).\n" +
  "# METADATA + LINK-ONLY: each entry is a browsable package with its original download URL\n" +
  "# preserved; NOT signed and NOT in the device index until a binary is uploaded/crawled.\n" +
  "#\n" +
  "# BEST-EFFORT MAPPING — please review/edit:\n" +
  "#  - machine defaults to [48k,128k] for plain esxDOS rows (only next/zxuno are auto-detected)\n" +
  "#  - type defaults to 'dot' (some are game/util/demo)\n" +
  "#  - version/name are sanitized from free-text and may need fixing\n" +
  `# Regenerate: npx tsx src/scripts/catalog-seed.ts   (latest-per-command; ${skippedOlder} older rows skipped)\n`;

writeFileSync(OUT, header + stringify({ packages: out }));
console.log(`wrote ${out.length} packages to ${OUT} (skipped ${skippedOlder} '(Older)' rows)`);
const next = out.filter((e) => e.machine.includes("next")).length;
const uno = out.filter((e) => e.machine.includes("zxuno")).length;
const restricted = out.filter((e) => !e.redistributable).length;
console.log(`  next-only: ${next}  zxuno-only: ${uno}  non-redistributable: ${restricted}`);
