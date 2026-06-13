import { rm } from "node:fs/promises";
import { env } from "@/lib/env";
import { exec, one } from "@/lib/db";
import { reqIsAdmin } from "@/lib/admin-auth";
import { store } from "@/lib/store";
import { rebuildIndex } from "@/lib/index-compiler";

export const dynamic = "force-dynamic";

// Delete a package entirely: DB rows (cascade versions/artifacts), any manual manifest,
// and its stored files; then recompile the index.
export async function POST(req: Request) {
  const form = await req.formData();
  const name = String(form.get("name") || "");
  if (!reqIsAdmin(req, String(form.get("token") || "") || undefined)) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!name) return new Response("missing name", { status: 400 });

  const pkg = await one<{ id: number }>("SELECT id FROM packages WHERE name=?", [name]);
  if (pkg) {
    await exec("DELETE FROM manual_manifests WHERE name=?", [name]);
    await exec("DELETE FROM packages WHERE id=?", [pkg.id]); // cascades versions + artifacts
    await rm(store.packageDir(name), { recursive: true, force: true });
    await rebuildIndex();
  }
  return Response.redirect(new URL(`${env.basePath}/admin?ok=del`, env.publicBaseUrl), 303);
}
