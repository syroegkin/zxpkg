import { env } from "@/lib/env";
import { exec, one } from "@/lib/db";
import { reqIsAdmin } from "@/lib/admin-auth";
import { rebuildIndex } from "@/lib/index-compiler";
import { OVERRIDE_FIELDS } from "@/lib/queries";

export const dynamic = "force-dynamic";

// Drop admin overrides so the underlying source (seed / crawled TOML / upload) re-surfaces.
//   no `field`        -> delete the whole override row (revert every field to base)
//   field=<col>       -> clear just that one field (the rest stay overridden); if that
//                        leaves nothing overridden, the row is removed.
export async function POST(req: Request) {
  const form = await req.formData();
  const name = String(form.get("name") || "");
  const field = String(form.get("field") || "");
  if (!reqIsAdmin(req, String(form.get("token") || "") || undefined)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const back = (qs: string) => Response.redirect(new URL(`${env.basePath}/admin?${qs}`, env.publicBaseUrl), 303);
  if (!name) return back("err=" + encodeURIComponent("package name is required"));

  const pkg = await one<{ id: number }>(
    "SELECT id FROM packages WHERE name=? ORDER BY preferred DESC, created_at ASC LIMIT 1",
    [name]
  );
  if (pkg) {
    if (field && (OVERRIDE_FIELDS as readonly string[]).includes(field)) {
      // clear one column (field name is whitelisted against OVERRIDE_FIELDS, so safe to inline)
      await exec(`UPDATE package_overrides SET \`${field}\`=NULL, updated_at=NOW() WHERE package_id=?`, [pkg.id]);
      // if no fields remain overridden, drop the now-empty row
      const cols = OVERRIDE_FIELDS.map((c) => `\`${c}\` IS NULL`).join(" AND ");
      await exec(`DELETE FROM package_overrides WHERE package_id=? AND ${cols}`, [pkg.id]);
    } else {
      await exec("DELETE FROM package_overrides WHERE package_id=?", [pkg.id]);
    }
    await rebuildIndex(); // index.dat + gopher revert to the base values
  }
  return back("ok=overridedrop");
}
