// The archiver: clone/mirror a repo, validate its manifest, archive a new version's
// artifacts (CRC + sign), and recompile the device index. Used by the worker.
import { writeFileSync, mkdirSync } from "node:fs";
import { exec, one, query } from "./db";
import { parseManifest, deriveOwner, type Manifest } from "./manifest";
import { parseRepoUrl, type RepoRef } from "./repo-url";
import { store } from "./store";
import { crc32c } from "./crc32c";
import { signBlob } from "./sign";
import { rebuildIndex } from "./index-compiler";
import { detectRepoLicense } from "./license";
import { detectRepoDescription } from "./readme";
import { isSafePublicUrl } from "./url-guard";
import * as git from "./git";

export interface RepoRow {
  id: number;
  source_url: string;
  last_commit_sha: string | null;
}

export type CrawlStatus = "unchanged" | "indexed" | "errored" | "watching";
export interface CrawlResult {
  repo: string;
  status: CrawlStatus;
  version?: string;
  message?: string;
}

async function setError(id: number, msg: string): Promise<void> {
  await exec("UPDATE repos SET status='errored', error_message=?, last_crawled_at=NOW() WHERE id=?", [msg, id]);
}

async function fetchArtifactBytes(mirrorDir: string, src: string): Promise<Buffer> {
  if (/^https?:\/\//i.test(src)) {
    if (!isSafePublicUrl(src)) throw new Error(`refusing unsafe artifact URL: ${src}`);
    const res = await fetch(src);
    if (!res.ok) throw new Error(`download ${src} -> HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  const buf = await git.readFileAtHead(mirrorDir, src);
  if (!buf) throw new Error(`artifact src not found at HEAD: ${src}`);
  return buf;
}

async function indexVersion(repo: RepoRow, head: string, m: Manifest, mirrorDir: string): Promise<void> {
  // Identity is (name, owner): owner = the repo's owner, so two different repos may both
  // publish a same-named package (cross-platform variants). Refuse only a (name,owner) clash
  // that points at a different source.
  const owner = deriveOwner({ repoUrl: repo.source_url });
  let pkg = await one<{ id: number; repo_id: number | null }>("SELECT id, repo_id FROM packages WHERE name=? AND owner=?", [m.name, owner]);
  if (pkg && (pkg.repo_id ?? null) !== repo.id) {
    throw new Error(`package "${owner}/${m.name}" already belongs to another source`);
  }
  if (!pkg) {
    const r = await exec(
      "INSERT INTO packages (repo_id,name,owner,description,homepage,license,redistributable,author) VALUES (?,?,?,?,?,?,?,?)",
      [repo.id, m.name, owner, m.description || null, m.homepage || null, m.license || null, m.redistributable ? 1 : 0, m.author || null]
    );
    pkg = { id: r.insertId, repo_id: repo.id };
  } else {
    await exec(
      "UPDATE packages SET description=?, homepage=?, license=?, redistributable=?, author=? WHERE id=?",
      [m.description || null, m.homepage || null, m.license || null, m.redistributable ? 1 : 0, m.author || null, pkg.id]
    );
  }

  // Already archived this exact version? Nothing to do.
  const existing = await one<{ id: number }>("SELECT id FROM versions WHERE package_id=? AND version=?", [pkg.id, m.version]);
  if (existing) return;

  // New version becomes the latest.
  await exec("UPDATE versions SET is_latest=0 WHERE package_id=?", [pkg.id]);
  const vr = await exec(
    `INSERT INTO versions (package_id,version,type,machine_csv,os_csv,needs_csv,min_core,bundled_in,commit_sha,manifest_json,is_latest)
     VALUES (?,?,?,?,?,?,?,?,?,?,1)`,
    [pkg.id, m.version, m.type, m.machine.join(","), m.os.join(","), m.needs.join(","), m.minCore || null, m.bundledIn || null, head, JSON.stringify(m)]
  );

  mkdirSync(store.artifactDir(m.name, m.version), { recursive: true });
  for (const a of m.artifacts) {
    const bytes = await fetchArtifactBytes(mirrorDir, a.src);
    const filePath = store.artifactFile(m.name, m.version, a.command);
    const sigPath = store.sigFile(m.name, m.version, a.command);
    writeFileSync(filePath, bytes);
    writeFileSync(sigPath, signBlob(bytes));
    await exec(
      "INSERT INTO artifacts (version_id,command,file_path,sig_path,crc32c,size) VALUES (?,?,?,?,?,?)",
      [vr.insertId, a.command, filePath, sigPath, crc32c(bytes), bytes.length]
    );
  }
}

async function markActive(id: number, head: string | null): Promise<void> {
  await exec(
    "UPDATE repos SET status='active', error_message=NULL, last_commit_sha=?, last_crawled_at=NOW() WHERE id=?",
    [head, id]
  );
}

export async function crawlRepo(repo: RepoRow): Promise<CrawlResult> {
  const ref: RepoRef = parseRepoUrl(repo.source_url);
  const mirrorDir = store.mirrorDir(ref.host, ref.ownerRepo);

  // Admin-entered manifests (fallback for repos that lack a .zxpkg.toml).
  const manuals = await query<{ manifest_json: string }>(
    "SELECT manifest_json FROM manual_manifests WHERE repo_id=?",
    [repo.id]
  );

  // Remote HEAD (best-effort — the remote may be gone).
  let head: string | null = null;
  try {
    head = await git.lsRemoteHead(ref.cloneUrl);
  } catch {
    head = null;
  }
  if (head && head === repo.last_commit_sha) {
    await exec("UPDATE repos SET last_crawled_at=NOW() WHERE id=?", [repo.id]);
    return { repo: ref.ownerRepo, status: "unchanged" };
  }

  // Mirror is best-effort (needed for the .toml + repo-path artifacts).
  let mirrorOk = true;
  try {
    await git.ensureMirror(ref.cloneUrl, mirrorDir);
  } catch {
    mirrorOk = false;
  }
  if (mirrorOk && !head) head = await git.localHead(mirrorDir);

  // A repo may ship several packages — read every *.zxpkg.toml at HEAD.
  const tomlManifests: Manifest[] = [];
  const tomlErrors: string[] = [];
  if (mirrorOk) {
    for (const path of await git.listManifests(mirrorDir)) {
      const buf = await git.readFileAtHead(mirrorDir, path);
      if (!buf) continue;
      const parsed = parseManifest(buf.toString("utf8"));
      if (parsed.manifest) tomlManifests.push(parsed.manifest);
      else tomlErrors.push(`${path}: ${parsed.errors.join("; ")}`);
    }
  }

  // Merge by name: manual entries are the base; repo manifests override (and supersede
  // a manual stopgap of the same name).
  const byName = new Map<string, Manifest>();
  for (const r of manuals) {
    const m = JSON.parse(r.manifest_json) as Manifest;
    byName.set(m.name, m);
  }
  for (const tm of tomlManifests) {
    byName.set(tm.name, tm);
    await exec("DELETE FROM manual_manifests WHERE repo_id=? AND name=?", [repo.id, tm.name]);
  }
  const manifests = [...byName.values()];

  if (manifests.length === 0) {
    if (!mirrorOk) {
      await setError(repo.id, "remote unreachable and no manual manifest");
      return { repo: ref.ownerRepo, status: "errored", message: "unreachable" };
    }
    if (tomlErrors.length) {
      const msg = `manifest invalid: ${tomlErrors.join("; ")}`;
      await setError(repo.id, msg);
      return { repo: ref.ownerRepo, status: "errored", message: msg };
    }
    // Reachable, but no manifest yet — keep watching; index when one is pushed.
    await exec(
      "UPDATE repos SET status='pending', error_message=?, last_commit_sha=?, last_crawled_at=NOW() WHERE id=?",
      ["watching — no .zxpkg.toml yet; will index when one is pushed", head, repo.id]
    );
    return { repo: ref.ownerRepo, status: "watching", message: "no manifest yet" };
  }

  // Without a mirror we can only fetch URL artifacts.
  if (!mirrorOk) {
    const allUrls = manifests.every((m) => m.artifacts.every((a) => /^https?:\/\//i.test(a.src)));
    if (!allUrls) {
      await setError(repo.id, "repo unreachable and some artifacts are repo paths");
      return { repo: ref.ownerRepo, status: "errored", message: "repo unreachable" };
    }
  }

  // Auto-detect the license from the repo's LICENSE/COPYING when not stated.
  if (mirrorOk && manifests.some((m) => !m.license)) {
    const lic = await detectRepoLicense(mirrorDir);
    if (lic) for (const m of manifests) if (!m.license) m.license = lic;
  }

  // Auto-fill the description from the repo's README when not stated.
  if (mirrorOk && manifests.some((m) => !m.description)) {
    const desc = await detectRepoDescription(mirrorDir);
    if (desc) for (const m of manifests) if (!m.description) m.description = desc;
  }

  const commitSha = head || "0".repeat(40);
  try {
    for (const m of manifests) await indexVersion(repo, commitSha, m, mirrorDir);
  } catch (e: any) {
    await setError(repo.id, `indexing failed: ${e.message}`);
    return { repo: ref.ownerRepo, status: "errored", message: e.message };
  }
  await markActive(repo.id, head);
  await rebuildIndex();
  return { repo: ref.ownerRepo, status: "indexed", version: manifests.map((m) => `${m.name}@${m.version}`).join(", ") };
}
