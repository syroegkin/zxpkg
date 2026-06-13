// Parse + validate manifests. Two sources share the same validator:
//   - a .zxpkg.toml file in a repo (parseManifest)
//   - an admin-entered object, for repos with no manifest (validateManifest)
// Runs on the portal (Node), never the device.
import { parse as parseToml } from "smol-toml";

export type Machine = "16k" | "48k" | "128k" | "next";
export type Os = "nextzxos" | "esxdos";

export const MACHINES: Machine[] = ["16k", "48k", "128k", "next"];
export const OSES: Os[] = ["nextzxos", "esxdos"];

// `machine` is the MINIMUM model; ZX software is upward-compatible, so a package also
// runs on every higher tier. These derive the full supported set from the minimum.
export const MACHINE_RANK: Record<string, number> = { "16k": 0, "48k": 1, "128k": 2, next: 3 };
export function supportedMachines(min: string): Machine[] {
  const r = MACHINE_RANK[min] ?? 0;
  return MACHINES.filter((m) => MACHINE_RANK[m] >= r);
}
export function machineLabel(min: string): string {
  return min === "next" ? "next" : `${min}+`;
}

// Package type/category: a free-form lowercase slug. `dot` (a dot command) is one of
// many — others: game, util, demo, tool, core, … The device maps known types to an
// install location (dot -> /DOT) and treats the rest generically.
export type PkgType = string;
export const SUGGESTED_TYPES = ["dot", "game", "util", "demo", "tool", "core", "other"];

// Known hardware/feature requirements (compat.needs). Shown as checkboxes in the UI.
export const FEATURES = ["wifi", "accelerator", "2mb"];
export const FEATURE_LABELS: Record<string, string> = {
  wifi: "WiFi",
  accelerator: "Pi Accelerator",
  "2mb": "2 MB RAM",
};
export const featureLabel = (f: string): string => FEATURE_LABELS[f] || f;

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
  machine: Machine;
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

  const machine = str(input.machine) as Machine | undefined;
  if (!machine) errors.push("machine is required");
  else if (!MACHINES.includes(machine)) errors.push(`machine "${machine}" must be one of ${MACHINES.join("|")}`);

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
      machine: machine!,
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
    machine: compat.machine,
    os: compat.os,
    needs: compat.needs,
    minCore: compat.min_core,
    artifacts: root?.artifact,
  });
}
