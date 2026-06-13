import { rm } from "node:fs/promises";
import { env } from "@/lib/env";
import { exec, one, query } from "@/lib/db";
import { reqIsAdmin } from "@/lib/admin-auth";
import { parseRepoUrl } from "@/lib/repo-url";
import { store } from "@/lib/store";
import { rebuildIndex } from "@/lib/index-compiler";

export const dynamic = "force-dynamic";

// Delete a repo and everything under it: packages/versions/artifacts (cascade),
// manual manifests, the git mirror, and stored artifact files; then recompile.
export async function POST(req: Request) {
  const form = await req.formData();
  const id = String(form.get("id") || "");
  if (!reqIsAdmin(req, String(form.get("token") || "") || undefined)) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!id) return new Response("missing id", { status: 400 });

  const repo = await one<{ source_url: string }>("SELECT source_url FROM repos WHERE id=?", [id]);
  if (repo) {
    const pkgs = await query<{ name: string }>("SELECT name FROM packages WHERE repo_id=?", [id]);
    await exec("DELETE FROM repos WHERE id=?", [id]); // cascades packages/versions/artifacts/manual/queue
    try {
      const ref = parseRepoUrl(repo.source_url);
      await rm(store.mirrorDir(ref.host, ref.ownerRepo), { recursive: true, force: true });
    } catch {
      /* ignore mirror cleanup errors */
    }
    for (const p of pkgs) await rm(store.packageDir(p.name), { recursive: true, force: true });
    await rebuildIndex();
  }
  return Response.redirect(new URL(`${env.basePath}/admin?ok=repodel`, env.publicBaseUrl), 303);
}
