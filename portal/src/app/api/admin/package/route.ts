import { env } from "@/lib/env";
import { exec, one } from "@/lib/db";
import { parseRepoUrl } from "@/lib/repo-url";
import { validateManifest, type ManifestInput } from "@/lib/manifest";
import { reqIsAdmin } from "@/lib/admin-auth";
import { adminBack } from "@/lib/form-redirect";

export const dynamic = "force-dynamic";

function csv(v: unknown): string[] {
  return String(v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Register one package manually for a repo that has no .zxpkg.toml.
// Multiple calls with different names attach multiple packages to one repo.
export async function POST(req: Request) {
  const ct = req.headers.get("content-type") || "";
  const isJson = ct.includes("application/json");

  let token: string | undefined;
  let repoUrl = "";
  let input: ManifestInput;
  let values: Record<string, string | string[] | undefined> = {};

  if (isJson) {
    const b: any = await req.json().catch(() => ({}));
    token = b.token;
    repoUrl = b.repo_url || b.repoUrl || "";
    input = {
      name: b.name,
      version: b.version,
      type: b.type,
      description: b.description,
      author: b.author,
      license: b.license,
      homepage: b.homepage,
      machine: b.machine,
      os: Array.isArray(b.os) ? b.os : csv(b.os),
      needs: Array.isArray(b.needs) ? b.needs : csv(b.needs),
      minCore: b.min_core || b.minCore,
      artifacts: Array.isArray(b.artifacts) ? b.artifacts : [{ src: b.src, command: b.command }],
    };
  } else {
    const f = await req.formData();
    const g = (k: string) => {
      const v = f.get(k);
      return v == null ? undefined : String(v);
    };
    token = g("token");
    repoUrl = g("repo_url") || "";
    input = {
      name: g("name"),
      version: g("version"),
      type: g("type"),
      description: g("description"),
      author: g("author"),
      license: g("license"),
      homepage: g("homepage"),
      machine: g("machine"),
      os: f.getAll("os").map(String),
      needs: f.getAll("needs").map(String),
      minCore: g("min_core"),
      artifacts: [{ src: g("src"), command: g("command") }],
    };
    values = {
      repo_url: repoUrl, name: g("name"), version: g("version"), type: g("type"),
      machine: g("machine"), os: f.getAll("os").map(String), needs: f.getAll("needs").map(String),
      command: g("command"), src: g("src"), description: g("description"),
      license: g("license"), author: g("author"), homepage: g("homepage"),
    };
  }

  // On a form submit, send failures back to /admin with the values so nothing is lost.
  const fail = (status: number, msg: string) =>
    isJson ? new Response(msg, { status }) : adminBack(req.url, env.basePath, "pkg", msg, values);

  if (!reqIsAdmin(req, token)) return new Response("Unauthorized", { status: 401 });
  if (!repoUrl) return fail(400, "Repository URL is required");

  const { manifest, errors } = validateManifest(input);
  if (!manifest) return fail(400, errors.join("; "));

  let ref;
  try {
    ref = parseRepoUrl(repoUrl);
  } catch {
    return fail(400, "Invalid repository URL");
  }

  await exec("INSERT IGNORE INTO repos (source_url, host) VALUES (?,?)", [ref.cloneUrl, ref.host]);
  const repo = await one<{ id: number }>("SELECT id FROM repos WHERE source_url=?", [ref.cloneUrl]);
  if (!repo) return new Response("repo insert failed", { status: 500 });

  // Conflict: is this package name already owned by a different source?
  const pc = await one<{ repo_id: number | null }>("SELECT repo_id FROM packages WHERE name=?", [manifest.name]);
  if (pc && (pc.repo_id ?? null) !== repo.id) return fail(400, `package "${manifest.name}" already exists`);
  const mc = await one<{ repo_id: number }>("SELECT repo_id FROM manual_manifests WHERE name=?", [manifest.name]);
  if (mc && mc.repo_id !== repo.id) return fail(400, `"${manifest.name}" is already registered by another repo`);

  await exec(
    `INSERT INTO manual_manifests (repo_id, name, manifest_json) VALUES (?,?,?)
     ON DUPLICATE KEY UPDATE repo_id=VALUES(repo_id), manifest_json=VALUES(manifest_json), updated_at=NOW()`,
    [repo.id, manifest.name, JSON.stringify(manifest)]
  );
  // Force a re-index on the next crawl and queue one now.
  await exec("UPDATE repos SET last_commit_sha=NULL WHERE id=?", [repo.id]);
  await exec("INSERT INTO crawl_queue (repo_id) VALUES (?)", [repo.id]);

  if (!isJson) return Response.redirect(new URL(`${env.basePath}/admin?ok=pkg`, req.url), 303);
  return Response.json({ ok: true, package: manifest.name, repo: ref.ownerRepo });
}
