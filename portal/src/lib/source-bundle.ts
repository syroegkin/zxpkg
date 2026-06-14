// Persist a preserved source bundle (the author's original source/binary, e.g. a zip)
// for a version. Mirror-by-default: a given URL is downloaded into the store; if it's
// unfetchable or over the size cap we keep a link-only row (file_path NULL) pointing at
// the upstream. A directly uploaded file over the cap is a hard error.
//
// Bundles are never signed and never enter the device index — see source_bundles in
// db/schema.sql.
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { exec } from "./db";
import { env } from "./env";
import { store } from "./store";
import { isSafePublicUrl } from "./url-guard";

export interface BundleInput {
  url?: string; // upstream source URL to mirror
  file?: { name: string; bytes: Buffer }; // a directly uploaded file
  label?: string;
}

// Reduce to a safe basename matching serve.safeSeg (so it round-trips as a URL segment).
function sanitizeName(raw: string): string {
  const base = (raw.split(/[\\/]/).pop() || "").trim();
  const s = base.replace(/[^A-Za-z0-9._+-]/g, "-").replace(/^[.+-]+/, "").slice(0, 120);
  return s || "source.bin";
}

// First free name in `dir`: foo.zip -> foo-2.zip -> foo-3.zip …
function dedupe(dir: string, name: string): string {
  if (!existsSync(join(dir, name))) return name;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let n = 2;
  while (existsSync(join(dir, `${stem}-${n}${ext}`))) n++;
  return `${stem}-${n}${ext}`;
}

function nameFromUrl(url: string): string {
  try {
    return sanitizeName(decodeURIComponent(new URL(url).pathname));
  } catch {
    return "source.bin";
  }
}

async function tryFetch(url: string): Promise<Buffer | null> {
  if (!isSafePublicUrl(url)) return null;
  try {
    // Don't follow redirects: a 3xx to a loopback/RFC1918/metadata host would bypass the
    // isSafePublicUrl guard (SSRF). A redirect just means we keep the link-only fallback.
    const res = await fetch(url, { redirect: "manual" });
    if (!res.ok) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length === 0 || bytes.length > env.maxSourceBundleBytes) return null;
    return bytes;
  } catch {
    return null;
  }
}

// Store one source bundle for a version. No-op if neither a file nor a URL is given.
export async function addSourceBundle(
  versionId: number,
  pkg: string,
  version: string,
  input: BundleInput
): Promise<void> {
  const label = input.label?.trim() || null;

  let bytes: Buffer | null = null;
  let rawName = "";
  if (input.file && input.file.bytes.length > 0) {
    if (input.file.bytes.length > env.maxSourceBundleBytes) {
      throw new Error(`source bundle exceeds ${env.maxSourceBundleBytes} byte limit`);
    }
    bytes = input.file.bytes;
    rawName = input.file.name;
  } else if (input.url) {
    bytes = await tryFetch(input.url); // best-effort; null -> link-only below
    rawName = nameFromUrl(input.url);
  } else {
    return;
  }

  const originalUrl = input.url || null;

  // Mirror failed / over cap but we have a URL: keep a link-only reference.
  if (!bytes) {
    if (!originalUrl) return;
    await exec(
      "INSERT INTO source_bundles (version_id,label,file_path,original_url,sha256,size) VALUES (?,?,?,?,?,?)",
      [versionId, label, null, originalUrl, null, null]
    );
    return;
  }

  const dir = store.sourceBundleDir(pkg, version);
  mkdirSync(dir, { recursive: true });
  const filename = dedupe(dir, sanitizeName(rawName));
  const filePath = store.sourceBundleFile(pkg, version, filename);
  writeFileSync(filePath, bytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  await exec(
    "INSERT INTO source_bundles (version_id,label,file_path,original_url,sha256,size) VALUES (?,?,?,?,?,?)",
    [versionId, label, filePath, originalUrl, sha256, bytes.length]
  );
}
