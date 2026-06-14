// Index a repo-less package whose artifact bytes are uploaded directly (no git).
// CRC + sign + store + DB rows + rebuild the signed index — no crawler involved.
import { mkdirSync, writeFileSync } from "node:fs";
import { exec, one } from "./db";
import { store } from "./store";
import { crc32c } from "./crc32c";
import { signBlob } from "./sign";
import { rebuildIndex } from "./index-compiler";
import type { Manifest } from "./manifest";

const UPLOAD_SHA = "0".repeat(40); // sentinel commit for uploaded packages

export async function publishUpload(manifest: Manifest, files: Record<string, Buffer>): Promise<number> {
  // Upsert the (repo-less) package — refuse if the name is owned by a repo.
  let pkg = await one<{ id: number; repo_id: number | null }>("SELECT id, repo_id FROM packages WHERE name=?", [manifest.name]);
  if (pkg && pkg.repo_id !== null) {
    throw new Error(`package name "${manifest.name}" already belongs to a repo`);
  }
  if (!pkg) {
    const r = await exec(
      "INSERT INTO packages (repo_id,name,description,homepage,license,author) VALUES (NULL,?,?,?,?,?)",
      [manifest.name, manifest.description || null, manifest.homepage || null, manifest.license || null, manifest.author || null]
    );
    pkg = { id: r.insertId, repo_id: null };
  } else {
    await exec(
      "UPDATE packages SET description=?, homepage=?, license=?, author=? WHERE id=?",
      [manifest.description || null, manifest.homepage || null, manifest.license || null, manifest.author || null, pkg.id]
    );
  }

  const existing = await one<{ id: number }>("SELECT id FROM versions WHERE package_id=? AND version=?", [pkg.id, manifest.version]);
  if (existing) throw new Error(`version ${manifest.version} already exists for ${manifest.name}`);

  await exec("UPDATE versions SET is_latest=0 WHERE package_id=?", [pkg.id]);
  const vr = await exec(
    `INSERT INTO versions (package_id,version,type,machine,os_csv,needs_csv,min_core,commit_sha,manifest_json,is_latest)
     VALUES (?,?,?,?,?,?,?,?,?,1)`,
    [pkg.id, manifest.version, manifest.type, manifest.machine, manifest.os.join(","), manifest.needs.join(","), manifest.minCore || null, UPLOAD_SHA, JSON.stringify(manifest)]
  );

  mkdirSync(store.artifactDir(manifest.name, manifest.version), { recursive: true });
  for (const a of manifest.artifacts) {
    const bytes = files[a.command];
    if (!bytes) throw new Error(`no uploaded file for command ${a.command}`);
    const filePath = store.artifactFile(manifest.name, manifest.version, a.command);
    const sigPath = store.sigFile(manifest.name, manifest.version, a.command);
    writeFileSync(filePath, bytes);
    writeFileSync(sigPath, signBlob(bytes));
    await exec(
      "INSERT INTO artifacts (version_id,command,file_path,sig_path,crc32c,size) VALUES (?,?,?,?,?,?)",
      [vr.insertId, a.command, filePath, sigPath, crc32c(bytes), bytes.length]
    );
  }

  await rebuildIndex();
  return vr.insertId;
}
