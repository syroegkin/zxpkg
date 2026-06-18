import { mkdirSync, writeFileSync } from "node:fs";
import { env } from "@/lib/env";
import { exec, one } from "@/lib/db";
import { reqIsAdmin } from "@/lib/admin-auth";
import { rebuildIndex } from "@/lib/index-compiler";
import { MACHINES, OSES, FEATURES } from "@/lib/manifest";
import { store } from "@/lib/store";
import { crc32c } from "@/lib/crc32c";
import { signBlob } from "@/lib/sign";
import { isSafePublicUrl } from "@/lib/url-guard";

export const dynamic = "force-dynamic";

const COMMAND_RE = /^[A-Z0-9_]{1,8}(\.[A-Z0-9]{1,3})?$/; // esxDOS 8.3, uppercase

// Full BASE edit for the auto-added / poorly-parsed metadata packages: writes the
// packages + latest-version rows DIRECTLY (short `description` AND long `readme`), edits
// the link-only repo/download bundles, and — if given a binary (file or URL) + command —
// signs + stores it so the package becomes installable (promotes metadata -> binary).
// (For repo-crawled packages prefer Override; a re-crawl rewrites the base.)
export async function POST(req: Request) {
  const f = await req.formData();
  const g = (k: string) => {
    const v = f.get(k);
    return v == null || typeof v !== "string" ? undefined : v;
  };
  const token = g("token");
  const name = g("name") || "";
  const back = (qs: string) => Response.redirect(new URL(`${env.basePath}/admin?${qs}`, env.publicBaseUrl), 303);
  const fail = (msg: string) => back(`editbase=${encodeURIComponent(name)}&err=${encodeURIComponent(msg)}`);
  if (!reqIsAdmin(req, token)) return new Response("Unauthorized", { status: 401 });
  if (!name) return fail("package name is required");

  const p = await one<{ id: number }>(
    "SELECT id FROM packages WHERE name=? ORDER BY preferred DESC, created_at ASC LIMIT 1",
    [name]
  );
  if (!p) return fail(`package "${name}" not found`);
  const v = await one<{ id: number }>(
    "SELECT id FROM versions WHERE package_id=? ORDER BY is_latest DESC, created_at DESC LIMIT 1",
    [p.id]
  );

  const text = (k: string) => (g(k) ?? "").trim() || null;
  const canon = (field: string, allowed: readonly string[]) =>
    allowed.filter((x) => f.getAll(field).map(String).includes(x)).join(",");
  const typeVal = (g("type") ?? "").trim() || "dot";
  const redist = g("redistributable") === "false" ? 0 : 1;
  const version = (g("version") ?? "0").trim() || "0";

  // --- optional binary (promote to installable): file upload OR URL fetch ---
  const command = (g("command") ?? "").trim().toUpperCase();
  let bytes: Buffer | null = null;
  if (command) {
    if (!COMMAND_RE.test(command)) return fail(`command "${command}" must be esxDOS 8.3 uppercase (e.g. MORSE)`);
    if (!v) return fail("no version row to attach a binary to");
    const file = f.get("binary_file");
    const binUrl = (g("binary_url") ?? "").trim();
    if (file && typeof file !== "string" && file.size > 0) {
      bytes = Buffer.from(await file.arrayBuffer());
    } else if (binUrl) {
      if (!/^https?:\/\//i.test(binUrl) || !isSafePublicUrl(binUrl)) return fail("binary URL must be a safe http(s) URL");
      const res = await fetch(binUrl).catch(() => null);
      if (!res || !res.ok) return fail(`binary download failed${res ? ` (HTTP ${res.status})` : ""}`);
      bytes = Buffer.from(await res.arrayBuffer());
    } else {
      return fail("a command was given but no binary file or URL");
    }
  }

  // --- write base metadata ---
  await exec(
    "UPDATE packages SET description=?, readme=?, homepage=?, license=?, author=?, redistributable=? WHERE id=?",
    [text("description"), text("readme"), text("homepage"), text("license"), text("author"), redist, p.id]
  );
  if (v) {
    await exec(
      `UPDATE versions SET version=?, type=?, machine_csv=?, os_csv=?, needs_csv=?, os_version=?, bundled_in=?
       WHERE id=?`,
      [version, typeVal, canon("machine", MACHINES), canon("os", OSES), canon("needs", FEATURES),
       text("os_version"), text("bundled_in"), v.id]
    );

    // --- link-only source bundles (repo + original download) ---
    const setBundle = async (label: string, url: string | null) => {
      await exec("DELETE FROM source_bundles WHERE version_id=? AND label=?", [v.id, label]);
      if (url) {
        await exec(
          "INSERT INTO source_bundles (version_id,label,file_path,original_url,sha256,size) VALUES (?,?,?,?,?,?)",
          [v.id, label, null, url, null, null]
        );
      }
    };
    await setBundle("source repository", text("repo_url"));
    await setBundle("original download", text("download_url"));

    // --- binary artifact (sign + store), replacing any existing one for this command ---
    if (bytes && command) {
      mkdirSync(store.artifactDir(name, version), { recursive: true });
      const filePath = store.artifactFile(name, version, command);
      const sigPath = store.sigFile(name, version, command);
      writeFileSync(filePath, bytes);
      writeFileSync(sigPath, signBlob(bytes));
      await exec("DELETE FROM artifacts WHERE version_id=? AND command=?", [v.id, command]);
      await exec(
        "INSERT INTO artifacts (version_id,command,file_path,sig_path,crc32c,size) VALUES (?,?,?,?,?,?)",
        [v.id, command, filePath, sigPath, crc32c(bytes), bytes.length]
      );
    }
  }

  await rebuildIndex();
  return back("ok=editbase");
}
