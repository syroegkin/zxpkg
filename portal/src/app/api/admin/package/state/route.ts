import { rm } from "node:fs/promises";
import { env } from "@/lib/env";
import { exec, one } from "@/lib/db";
import { reqIsAdmin } from "@/lib/admin-auth";
import { store } from "@/lib/store";
import { rebuildIndex } from "@/lib/index-compiler";

export const dynamic = "force-dynamic";

const STATES = ["listed", "hidden", "removed"] as const;

// Change a package's archive state.
//   listed  -> public again
//   hidden  -> unlisted (kept; pulled from catalog + device index)
//   removed -> tombstone: delete versions/artifacts/bundles + stored files, keep the
//              package row so it can't be silently re-archived.
export async function POST(req: Request) {
  const form = await req.formData();
  const name = String(form.get("name") || "");
  const state = String(form.get("state") || "");
  if (!reqIsAdmin(req, String(form.get("token") || "") || undefined)) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!name || !STATES.includes(state as any)) return new Response("bad request", { status: 400 });

  const pkg = await one<{ id: number }>("SELECT id FROM packages WHERE name=?", [name]);
  if (pkg) {
    if (state === "removed") {
      await exec("DELETE FROM versions WHERE package_id=?", [pkg.id]); // cascades artifacts + bundles
      await rm(store.packageDir(name), { recursive: true, force: true });
      await exec("UPDATE packages SET archive_state='removed', archived_at=NOW() WHERE id=?", [pkg.id]);
    } else if (state === "hidden") {
      await exec("UPDATE packages SET archive_state='hidden', archived_at=NOW() WHERE id=?", [pkg.id]);
    } else {
      await exec("UPDATE packages SET archive_state='listed', archived_at=NULL WHERE id=?", [pkg.id]);
    }
    await rebuildIndex();
  }
  return Response.redirect(new URL(`${env.basePath}/admin?ok=state`, env.publicBaseUrl), 303);
}
