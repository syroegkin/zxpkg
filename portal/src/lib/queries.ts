// Read queries shared by the web pages (SSR) and the JSON API.
import { query, one } from "./db";
import { splitCsv } from "./manifest";

export interface PackageListItem {
  name: string;
  description: string | null;
  author: string | null;
  type: string;
  machine_csv: string;
  os_csv: string;
  version: string;
  archive_state: "listed" | "hidden" | "removed";
}

export const PAGE_SIZE = 30;

export interface Paged<T> {
  items: T[];
  total: number;
  page: number; // 1-based, clamped to [1, pages]
  pages: number;
}

export async function searchPackages(opts: { q?: string; type?: string; machine?: string; os?: string; page?: number; includeHidden?: boolean }): Promise<Paged<PackageListItem>> {
  // Public catalog = listed only. Admins (includeHidden) also see hidden entries, badged.
  const where: string[] = ["v.is_latest=1", opts.includeHidden ? "p.archive_state IN ('listed','hidden')" : "p.archive_state='listed'"];
  const params: any[] = [];
  if (opts.q) {
    // match name, effective description, AND author (so authors are findable in search)
    where.push("(p.name LIKE ? OR COALESCE(o.description, p.description) LIKE ? OR COALESCE(o.author, p.author) LIKE ?)");
    params.push(`%${opts.q}%`, `%${opts.q}%`, `%${opts.q}%`);
  }
  if (opts.type) {
    where.push("COALESCE(o.type, v.type)=?");
    params.push(opts.type);
  }
  if (opts.machine) {
    // machine is a known-good SET: a package matches if its set contains the selected model.
    where.push("FIND_IN_SET(?, COALESCE(o.machine_csv, v.machine_csv))");
    params.push(opts.machine);
  }
  if (opts.os) {
    where.push("FIND_IN_SET(?, COALESCE(o.os_csv, v.os_csv))");
    params.push(opts.os);
  }
  const whereSql = where.join(" AND ");
  const from = "FROM packages p JOIN versions v ON v.package_id = p.id LEFT JOIN package_overrides o ON o.package_id = p.id";

  const total = (await one<{ n: number }>(`SELECT COUNT(*) AS n ${from} WHERE ${whereSql}`, params))?.n ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(1, opts.page || 1), pages);
  const offset = (page - 1) * PAGE_SIZE;

  const items = await query<PackageListItem>(
    `SELECT p.name, COALESCE(o.description, p.description) AS description, COALESCE(o.author, p.author) AS author,
            COALESCE(o.type, v.type) AS type, COALESCE(o.machine_csv, v.machine_csv) AS machine_csv,
            COALESCE(o.os_csv, v.os_csv) AS os_csv, v.version, p.archive_state
     ${from} WHERE ${whereSql}
     ORDER BY p.name LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
    params
  );
  return { items, total, page, pages };
}

export interface AdminPackageRow {
  name: string;
  version: string | null;
  type: string | null;
  repo_id: number | null;
  is_manual: number | null;
  is_overridden: number | null;
  has_artifact: number | null; // 1 = has a signed binary (installable); null = metadata/link-only
  archive_state: "listed" | "hidden" | "removed";
}

export const ADMIN_PAGE_SIZE = 50;

export async function adminPackages(opts: { page?: number } = {}): Promise<Paged<AdminPackageRow>> {
  const total = (await one<{ n: number }>("SELECT COUNT(*) AS n FROM packages"))?.n ?? 0;
  const pages = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));
  const page = Math.min(Math.max(1, opts.page || 1), pages);
  const offset = (page - 1) * ADMIN_PAGE_SIZE;
  const items = await query<AdminPackageRow>(
    `SELECT p.name, p.repo_id, p.archive_state,
            COALESCE(o.type, v.type) AS type, v.version,
            (SELECT 1 FROM manual_manifests mm WHERE mm.name = p.name) AS is_manual,
            (o.package_id IS NOT NULL) AS is_overridden,
            (SELECT 1 FROM artifacts a JOIN versions av ON av.id = a.version_id
              WHERE av.package_id = p.id LIMIT 1) AS has_artifact
     FROM packages p
     LEFT JOIN versions v ON v.package_id = p.id AND v.is_latest = 1
     LEFT JOIN package_overrides o ON o.package_id = p.id
     ORDER BY p.name LIMIT ${ADMIN_PAGE_SIZE} OFFSET ${offset}`
  );
  return { items, total, page, pages };
}

// Load a manual manifest (with its repo URL) for editing.
export async function getManualManifest(name: string): Promise<{ repoUrl: string; manifest: any } | null> {
  const row = await one<{ manifest_json: string; source_url: string }>(
    `SELECT mm.manifest_json, r.source_url
     FROM manual_manifests mm JOIN repos r ON r.id = mm.repo_id
     WHERE mm.name = ?`,
    [name]
  );
  if (!row) return null;
  return { repoUrl: row.source_url, manifest: JSON.parse(row.manifest_json) };
}

export async function allTypes(): Promise<string[]> {
  const rows = await query<{ type: string }>(
    `SELECT DISTINCT v.type FROM versions v JOIN packages p ON p.id = v.package_id
     WHERE v.is_latest=1 AND p.archive_state='listed' ORDER BY v.type`
  );
  return rows.map((r) => r.type);
}

export interface PackageRow {
  id: number;
  name: string;
  owner: string;
  preferred: number;
  description: string | null;
  homepage: string | null;
  license: string | null;
  redistributable: number;
  author: string | null;
  category: string | null;
  readme: string | null;
  source_url: string | null;
  is_manual: number | null;
  is_overridden: number | null;
  archive_state: "listed" | "hidden" | "removed";
  archived_at: string | null;
}
export interface VersionRow {
  id: number;
  version: string;
  type: string;
  machine_csv: string;
  os_csv: string;
  needs_csv: string;
  min_core: string | null;
  bundled_in: string | null;
  os_version: string | null;
  commit_sha: string;
  is_latest: number;
  created_at: string;
}
export interface ArtifactRow {
  version_id: number;
  command: string;
  crc32c: number;
  size: number;
}
export interface SourceBundleRow {
  version_id: number;
  label: string | null;
  file_path: string | null;
  original_url: string | null;
  sha256: string | null;
  size: number | null;
}

export async function getPackage(
  name: string
): Promise<{ pkg: PackageRow; versions: VersionRow[]; artifacts: ArtifactRow[]; bundles: SourceBundleRow[] } | null> {
  // Effective view: admin per-field overrides (package_overrides) win over the base
  // package/version data; NULL override columns inherit the base via COALESCE.
  const pkg = await one<PackageRow>(
    `SELECT p.id, p.name, p.owner, p.preferred,
            COALESCE(o.description, p.description) AS description,
            COALESCE(o.homepage, p.homepage) AS homepage,
            COALESCE(o.license, p.license) AS license,
            COALESCE(o.redistributable, p.redistributable) AS redistributable,
            COALESCE(o.author, p.author) AS author,
            COALESCE(o.readme, p.readme) AS readme,
            p.category, p.archive_state, p.archived_at, r.source_url,
            (SELECT 1 FROM manual_manifests mm WHERE mm.name = p.name) AS is_manual,
            (o.package_id IS NOT NULL) AS is_overridden
     FROM packages p
     LEFT JOIN repos r ON r.id = p.repo_id
     LEFT JOIN package_overrides o ON o.package_id = p.id
     WHERE p.name = ?
     ORDER BY p.preferred DESC, p.created_at ASC LIMIT 1`,
    [name]
  );
  if (!pkg) return null;
  // The three are independent of each other — fetch them concurrently.
  const [versions, artifacts, bundles] = await Promise.all([
    query<VersionRow>(
      `SELECT v.id, v.version,
              COALESCE(o.type, v.type) AS type,
              COALESCE(o.machine_csv, v.machine_csv) AS machine_csv,
              COALESCE(o.os_csv, v.os_csv) AS os_csv,
              COALESCE(o.needs_csv, v.needs_csv) AS needs_csv,
              v.min_core, COALESCE(o.bundled_in, v.bundled_in) AS bundled_in,
              COALESCE(o.os_version, v.os_version) AS os_version,
              v.commit_sha, v.is_latest, v.created_at
       FROM versions v LEFT JOIN package_overrides o ON o.package_id = v.package_id
       WHERE v.package_id = ? ORDER BY v.created_at DESC`,
      [pkg.id]
    ),
    query<ArtifactRow>(
      `SELECT a.version_id, a.command, a.crc32c, a.size
       FROM artifacts a JOIN versions v ON v.id = a.version_id
       WHERE v.package_id = ? ORDER BY a.command`,
      [pkg.id]
    ),
    query<SourceBundleRow>(
      `SELECT sb.version_id, sb.label, sb.file_path, sb.original_url, sb.sha256, sb.size
       FROM source_bundles sb JOIN versions v ON v.id = sb.version_id
       WHERE v.package_id = ? ORDER BY sb.id`,
      [pkg.id]
    ),
  ]);
  return { pkg, versions, artifacts, bundles };
}

export async function crcLookup(crc: number): Promise<{ package: string; version: string; command: string } | null> {
  return one(
    `SELECT p.name AS package, v.version, a.command
     FROM artifacts a JOIN versions v ON v.id = a.version_id JOIN packages p ON p.id = v.package_id
     WHERE a.crc32c = ? AND p.archive_state='listed' LIMIT 1`,
    [crc >>> 0]
  );
}

// Same-name packages whose latest machine sets INTERSECT — the true collision case
// (two different packages contend for the same command on the same platform). Disjoint
// same-name packages (cross-platform variants) are fine and are NOT returned here.
export async function machineCollisions(): Promise<{ name: string; entries: { owner: string; machine: string[] }[] }[]> {
  const rows = await query<{ name: string; owner: string; machine_csv: string }>(
    `SELECT p.name, p.owner, v.machine_csv
     FROM packages p JOIN versions v ON v.package_id = p.id AND v.is_latest = 1
     WHERE p.archive_state='listed'
       AND p.name IN (SELECT name FROM packages WHERE archive_state='listed' GROUP BY name HAVING COUNT(*) > 1)
     ORDER BY p.name, p.owner`
  );
  const byName = new Map<string, { owner: string; machine: string[] }[]>();
  for (const r of rows) {
    if (!byName.has(r.name)) byName.set(r.name, []);
    byName.get(r.name)!.push({ owner: r.owner, machine: splitCsv(r.machine_csv) });
  }
  const out: { name: string; entries: { owner: string; machine: string[] }[] }[] = [];
  for (const [name, entries] of byName) {
    const collide = entries.some((a, i) =>
      entries.slice(i + 1).some((b) => a.machine.some((m) => b.machine.includes(m)))
    );
    if (collide) out.push({ name, entries });
  }
  return out;
}

// The list of fields an admin may override (used by the override form + handler).
export const OVERRIDE_FIELDS = [
  "description", "readme", "homepage", "license", "author", "redistributable",
  "type", "machine_csv", "os_csv", "needs_csv", "os_version", "bundled_in",
] as const;
export type OverrideField = (typeof OVERRIDE_FIELDS)[number];

export interface OverrideEditData {
  id: number;
  name: string;
  owner: string;
  version: string; // latest version's version string (for the simple base-edit form)
  versionId: number | null;
  // base = the underlying source value (seed/TOML/upload), before any override
  base: Record<OverrideField, string | null>;
  // override = current per-field overrides; null = no override row yet, field null = inherits
  override: (Record<OverrideField, string | null> & { note: string | null }) | null;
  // link-only source bundles on the latest version (editable in the base-edit form)
  repoUrl: string | null;
  downloadUrl: string | null;
}

// Load a package's BASE values + current OVERRIDE values for the admin override form.
// Resolves the package by name the same way the public page does (preferred first).
export async function getOverrideEditData(name: string): Promise<OverrideEditData | null> {
  const p = await one<any>(
    `SELECT id, name, owner, description, readme, homepage, license, author, redistributable
     FROM packages WHERE name=? ORDER BY preferred DESC, created_at ASC LIMIT 1`,
    [name]
  );
  if (!p) return null;
  const v = await one<any>(
    `SELECT id, version, type, machine_csv, os_csv, needs_csv, os_version, bundled_in FROM versions
     WHERE package_id=? ORDER BY is_latest DESC, created_at DESC LIMIT 1`,
    [p.id]
  );
  const o = await one<any>("SELECT * FROM package_overrides WHERE package_id=?", [p.id]);
  const bundles = v
    ? await query<{ label: string | null; original_url: string | null }>(
        "SELECT label, original_url FROM source_bundles WHERE version_id=?",
        [v.id]
      )
    : [];
  const str = (x: any): string | null => (x == null ? null : String(x));
  const bundleUrl = (label: string) => str(bundles.find((b) => b.label === label)?.original_url);
  return {
    id: p.id,
    name: p.name,
    owner: p.owner,
    version: str(v?.version) ?? "0",
    versionId: v?.id ?? null,
    repoUrl: bundleUrl("source repository"),
    downloadUrl: bundleUrl("original download"),
    base: {
      description: str(p.description), readme: str(p.readme), homepage: str(p.homepage),
      license: str(p.license), author: str(p.author), redistributable: str(p.redistributable),
      type: str(v?.type) ?? "dot", machine_csv: str(v?.machine_csv) ?? "",
      os_csv: str(v?.os_csv) ?? "", needs_csv: str(v?.needs_csv) ?? "",
      os_version: str(v?.os_version), bundled_in: str(v?.bundled_in),
    },
    override: o
      ? {
          description: str(o.description), readme: str(o.readme), homepage: str(o.homepage),
          license: str(o.license), author: str(o.author), redistributable: str(o.redistributable),
          type: str(o.type), machine_csv: str(o.machine_csv), os_csv: str(o.os_csv),
          needs_csv: str(o.needs_csv), os_version: str(o.os_version), bundled_in: str(o.bundled_in), note: str(o.note),
        }
      : null,
  };
}

// All listed packages by a given author (effective author = override-or-base, matched
// case-insensitively). Returns null if the author has no listed packages.
export async function packagesByAuthor(author: string): Promise<{ author: string; items: PackageListItem[] } | null> {
  const items = await query<PackageListItem>(
    `SELECT p.name, COALESCE(o.description, p.description) AS description, COALESCE(o.author, p.author) AS author,
            COALESCE(o.type, v.type) AS type, COALESCE(o.machine_csv, v.machine_csv) AS machine_csv,
            COALESCE(o.os_csv, v.os_csv) AS os_csv, v.version, p.archive_state
     FROM packages p JOIN versions v ON v.package_id = p.id AND v.is_latest = 1
     LEFT JOIN package_overrides o ON o.package_id = p.id
     WHERE p.archive_state='listed' AND LOWER(COALESCE(o.author, p.author)) = LOWER(?)
     ORDER BY p.name`,
    [author]
  );
  if (items.length === 0) return null;
  return { author: items[0].author ?? author, items };
}

export async function allPackageNames(): Promise<string[]> {
  const rows = await query<{ name: string }>("SELECT name FROM packages WHERE archive_state='listed' ORDER BY name");
  return rows.map((r) => r.name);
}
