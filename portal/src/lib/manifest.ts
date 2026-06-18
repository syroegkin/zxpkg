// Parse + validate manifests. Two sources share the same validator:
//   - a .zxpkg.toml file in a repo (parseManifest)
//   - an admin-entered object, for repos with no manifest (validateManifest)
// Runs on the portal (Node), never the device.
import { parse as parseToml } from "smol-toml";
import { parseRepoUrl } from "./repo-url";

export type Machine = "16k" | "48k" | "128k" | "next" | "zxuno" | "element";
export type Os = "nextzxos" | "esxdos" | "unodos";

export const MACHINES: Machine[] = ["16k", "48k", "128k", "next", "zxuno", "element"];
export const OSES: Os[] = ["nextzxos", "esxdos", "unodos"];

// `machine` and `os` are KNOWN-GOOD SETS — the models/OSes a package is tested or
// declared to run on (NOT a minimum-model floor). Stored/encoded as bitfields.
export const splitCsv = (s: string): string[] => s.split(",").map((x) => x.trim()).filter(Boolean);
// Publisher slug for the (name, owner) package identity. Lowercase a-z0-9-, else "community".
export const slug = (s: string | undefined | null): string =>
  (s || "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "community";
// Single rule for a package's owner: the repo owner if it came from a repo, else the
// author slug. Shared by the crawler, the uploader, and the catalog seeder.
export function deriveOwner(opts: { repoUrl?: string | null; author?: string | null }): string {
  if (opts.repoUrl) {
    try { return parseRepoUrl(opts.repoUrl).owner; } catch { /* unparseable -> fall back to author */ }
  }
  return slug(opts.author);
}
export const machineLabel = (m: string): string => m;
export const machinesLabel = (csv: string): string => splitCsv(csv).join(", ") || "—";

// Package type/category: a free-form lowercase slug. `dot` (a dot command) is one of
// many — others: game, util, demo, tool, core, … The device maps known types to an
// install location (dot -> /DOT) and treats the rest generically.
export type PkgType = string;
export const SUGGESTED_TYPES = ["dot", "game", "util", "demo", "tool", "core", "other"];

// Closed `compat.needs` enum (hardware/interface). Shown as checkboxes in the UI.
// Only wifi/accelerator/2mb are device-actionable (see index-format FEATURE_BIT);
// the rest are portal-only metadata for search/display.
export const FEATURES = ["wifi", "accelerator", "2mb", "divide", "divmmc", "divtiesus", "mb03plus", "ezx", "ay", "rtc", "rpi0"];
export const FEATURE_LABELS: Record<string, string> = {
  wifi: "WiFi",
  accelerator: "Pi Accelerator",
  "2mb": "2 MB RAM",
  divide: "divIDE",
  divmmc: "divMMC",
  divtiesus: "DivTIESUS",
  mb03plus: "MB03+",
  ezx: "eLeMeNt ZX",
  ay: "AY sound",
  rtc: "RTC clock",
  rpi0: "Raspberry Pi Zero",
};
export const featureLabel = (f: string): string => FEATURE_LABELS[f] || f;

// Known OS releases for the os_version datalist (newest first). The field is free-form
// ("<os> <version>"), but these are the common targets — e.g. "esxdos 0.8.7".
export const ESXDOS_VERSIONS = ["0.8.9", "0.8.8", "0.8.7", "0.8.6", "0.8.5", "0.8.0", "0.7.4", "0.7.3"];
export const NEXTZXOS_VERSIONS = ["2.09", "2.08", "2.07", "2.06", "2.05", "2.04", "2.01", "2.00"];
export const OS_VERSION_OPTIONS = [
  ...ESXDOS_VERSIONS.map((v) => `esxdos ${v}`),
  ...NEXTZXOS_VERSIONS.map((v) => `nextzxos ${v}`),
];

export interface ManifestArtifact {
  src: string; // repo path (build/MORSE) or a release-asset URL
  command: string; // filename written to /DOT (esxDOS 8.3, uppercase)
}

export interface Manifest {
  name: string;
  version: string;
  type: PkgType;
  description?: string;
  author?: string;
  license?: string;
  homepage?: string;
  claim?: string;
  redistributable: boolean; // default true; false ⇒ portal mirrors link-only
  bundledIn?: string; // provenance: OS/distro release it originally shipped in
  osVersion?: string; // specific target OS release, e.g. "esxdos 0.8.7"
  machine: Machine[]; // known-good set
  os: Os[];
  needs: string[];
  minCore?: string;
  artifacts: ManifestArtifact[];
}

// Loose input shape accepted by the validator (from TOML or an admin form).
export interface ManifestInput {
  name?: unknown;
  version?: unknown;
  type?: unknown;
  description?: unknown;
  author?: unknown;
  license?: unknown;
  homepage?: unknown;
  claim?: unknown;
  redistributable?: unknown;
  bundledIn?: unknown;
  osVersion?: unknown;
  machine?: unknown;
  os?: unknown;
  needs?: unknown;
  minCore?: unknown;
  artifacts?: unknown;
}

export interface ParseResult {
  manifest?: Manifest;
  errors: string[];
}

const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const VERSION_RE = /^\d+\.\d+(\.\d+)?([-+][0-9A-Za-z.-]+)?$/;
const COMMAND_RE = /^[A-Z0-9_]{1,8}(\.[A-Z0-9]{1,3})?$/; // esxDOS 8.3, uppercase

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length ? v : undefined;
}
function strArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  return [];
}
// Coerce a set field that may arrive as an array (TOML) or a single string (form).
function setArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof v === "string" && v.length) return splitCsv(v);
  return [];
}
function bool(v: unknown, dflt: boolean): boolean {
  if (v === undefined || v === null || v === "") return dflt;
  if (typeof v === "boolean") return v;
  const s = String(v).toLowerCase();
  return !(s === "false" || s === "0" || s === "no" || s === "off");
}

export function validateManifest(input: ManifestInput): ParseResult {
  const errors: string[] = [];

  const name = str(input.name);
  if (!name) errors.push("name is required");
  else if (!NAME_RE.test(name)) errors.push(`name "${name}" is invalid (lowercase a-z 0-9 . _ -, max 64)`);

  const version = str(input.version);
  if (!version) errors.push("version is required");
  else if (!VERSION_RE.test(version)) errors.push(`version "${version}" is not semver-like`);

  let type = "dot";
  if (input.type !== undefined) {
    const t = str(input.type);
    if (!t || !/^[a-z0-9][a-z0-9-]{0,23}$/.test(t)) errors.push(`type "${String(input.type)}" must be a lowercase slug (e.g. dot, game, util)`);
    else type = t;
  }

  let machine: Machine[] = [];
  if (input.machine === undefined) {
    errors.push('machine is required (e.g. ["48k","128k"])');
  } else {
    machine = setArray(input.machine) as Machine[];
    for (const m of machine) if (!MACHINES.includes(m)) errors.push(`machine has invalid entry "${m}" (allowed: ${MACHINES.join("|")})`);
    if (machine.length === 0) errors.push("machine must list at least one model");
  }

  let os: Os[] = [];
  if (input.os === undefined) {
    errors.push('os is required (e.g. ["esxdos"])');
  } else if (!Array.isArray(input.os)) {
    errors.push("os must be an array");
  } else {
    os = input.os as Os[];
    for (const o of os) if (!OSES.includes(o)) errors.push(`os has invalid entry "${o}" (allowed: ${OSES.join("|")})`);
    if (os.length === 0) errors.push("os must list at least one OS");
  }

  const homepage = str(input.homepage);
  if (homepage && !/^https?:\/\//i.test(homepage)) errors.push("homepage must be an http(s) URL");

  const needs = strArray(input.needs);
  for (const n of needs) if (!FEATURES.includes(n)) errors.push(`needs has invalid entry "${n}" (allowed: ${FEATURES.join("|")})`);

  const artifacts: ManifestArtifact[] = [];
  if (!Array.isArray(input.artifacts) || input.artifacts.length === 0) {
    errors.push("at least one artifact is required");
  } else {
    (input.artifacts as any[]).forEach((a, i) => {
      const src = str(a?.src);
      const command = str(a?.command);
      if (!src) errors.push(`artifact[${i}].src is required`);
      if (!command) errors.push(`artifact[${i}].command is required`);
      else if (!COMMAND_RE.test(command)) errors.push(`artifact[${i}].command "${command}" must be esxDOS 8.3 uppercase (e.g. MORSE)`);
      if (src && command) artifacts.push({ src, command });
    });
  }

  if (errors.length) return { errors };

  return {
    errors: [],
    manifest: {
      name: name!,
      version: version!,
      type,
      description: str(input.description),
      author: str(input.author),
      license: str(input.license),
      homepage,
      claim: str(input.claim),
      redistributable: bool(input.redistributable, true),
      bundledIn: str(input.bundledIn),
      osVersion: str(input.osVersion)?.slice(0, 48),
      machine,
      os,
      needs,
      minCore: str(input.minCore),
      artifacts,
    },
  };
}

export function parseManifest(text: string): ParseResult {
  let root: any;
  try {
    root = parseToml(text);
  } catch (e: any) {
    return { errors: [`TOML parse error: ${e?.message || e}`] };
  }
  const pkg = root?.package ?? {};
  const compat = root?.compat ?? {};
  return validateManifest({
    name: pkg.name,
    version: pkg.version,
    type: pkg.type,
    description: pkg.description,
    author: pkg.author,
    license: pkg.license,
    homepage: pkg.homepage,
    claim: pkg.claim,
    redistributable: pkg.redistributable,
    bundledIn: pkg.bundled_in,
    machine: compat.machine,
    os: compat.os,
    needs: compat.needs,
    minCore: compat.min_core,
    osVersion: compat.os_version,
    artifacts: root?.artifact,
  });
}
