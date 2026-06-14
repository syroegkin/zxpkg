// Read queries shared by the web pages (SSR) and the JSON API.
import { query, one } from "./db";

export interface PackageListItem {
  name: string;
  description: string | null;
  author: string | null;
  type: string;
  machine: string;
  os_csv: string;
  version: string;
}

export async function searchPackages(opts: { q?: string; type?: string; machine?: string; os?: string }): Promise<PackageListItem[]> {
  const where: string[] = ["v.is_latest=1", "p.archive_state='listed'"];
  const params: any[] = [];
  if (opts.q) {
    where.push("(p.name LIKE ? OR p.description LIKE ?)");
    params.push(`%${opts.q}%`, `%${opts.q}%`);
  }
  if (opts.type) {
    where.push("v.type=?");
    params.push(opts.type);
  }
  if (opts.machine) {
    // A package runs on the selected machine if its minimum is the same or lower.
    where.push("FIELD(v.machine,'16k','48k','128k','next') <= FIELD(?,'16k','48k','128k','next')");
    params.push(opts.machine);
  }
  if (opts.os) {
    where.push("FIND_IN_SET(?, v.os_csv)");
    params.push(opts.os);
  }
  return query<PackageListItem>(
    `SELECT p.name, p.description, p.author, v.type, v.machine, v.os_csv, v.version
     FROM packages p JOIN versions v ON v.package_id = p.id
     WHERE ${where.join(" AND ")}
     ORDER BY p.name LIMIT 200`,
    params
  );
}

export interface AdminPackageRow {
  name: string;
  version: string | null;
  type: string | null;
  repo_id: number | null;
  is_manual: number | null;
  archive_state: "listed" | "hidden" | "removed";
}

export async function adminPackages(): Promise<AdminPackageRow[]> {
  return query<AdminPackageRow>(
    `SELECT p.name, p.repo_id, p.archive_state, v.version, v.type,
            (SELECT 1 FROM manual_manifests mm WHERE mm.name = p.name) AS is_manual
     FROM packages p
     LEFT JOIN versions v ON v.package_id = p.id AND v.is_latest = 1
     ORDER BY p.name`
  );
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
  description: string | null;
  homepage: string | null;
  license: string | null;
  author: string | null;
  category: string | null;
  source_url: string | null;
  is_manual: number | null;
  archive_state: "listed" | "hidden" | "removed";
  archived_at: string | null;
}
export interface VersionRow {
  id: number;
  version: string;
  type: string;
  machine: string;
  os_csv: string;
  needs_csv: string;
  min_core: string | null;
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
  const pkg = await one<PackageRow>(
    `SELECT p.*, r.source_url,
            (SELECT 1 FROM manual_manifests mm WHERE mm.name = p.name) AS is_manual
     FROM packages p LEFT JOIN repos r ON r.id = p.repo_id WHERE p.name = ?`,
    [name]
  );
  if (!pkg) return null;
  // The three are independent of each other — fetch them concurrently.
  const [versions, artifacts, bundles] = await Promise.all([
    query<VersionRow>("SELECT * FROM versions WHERE package_id = ? ORDER BY created_at DESC", [pkg.id]),
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

export async function allPackageNames(): Promise<string[]> {
  const rows = await query<{ name: string }>("SELECT name FROM packages WHERE archive_state='listed' ORDER BY name");
  return rows.map((r) => r.name);
}
