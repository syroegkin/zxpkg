import { env } from "@/lib/env";
import { exec } from "@/lib/db";
import { reqIsAdmin } from "@/lib/admin-auth";
import { rebuildIndex } from "@/lib/index-compiler";

export const dynamic = "force-dynamic";

// Bulk hide/show ONLY metadata-only packages — those with NO signed binary artifact (the
// seeded/link-only archive entries that can't be `.pkg-inst`alled). Lets an admin declutter
// the public catalog of non-installable entries in one click, without touching proper
// (binary) packages or 'removed' tombstones.
const NO_ARTIFACT =
  "NOT EXISTS (SELECT 1 FROM artifacts a JOIN versions v ON v.id = a.version_id WHERE v.package_id = packages.id)";

export async function POST(req: Request) {
  const form = await req.formData();
  const state = String(form.get("state") || "");
  if (!reqIsAdmin(req, String(form.get("token") || "") || undefined)) {
    return new Response("Unauthorized", { status: 401 });
  }

  let affected = 0;
  let ok = "";
  if (state === "hidden") {
    const r: any = await exec(
      `UPDATE packages SET archive_state='hidden', archived_at=NOW()
       WHERE archive_state='listed' AND ${NO_ARTIFACT}`
    );
    affected = r?.affectedRows ?? 0;
    ok = "metahidden";
  } else if (state === "listed") {
    const r: any = await exec(
      `UPDATE packages SET archive_state='listed', archived_at=NULL
       WHERE archive_state='hidden' AND ${NO_ARTIFACT}`
    );
    affected = r?.affectedRows ?? 0;
    ok = "metalisted";
  } else {
    return new Response("bad state", { status: 400 });
  }

  await rebuildIndex();
  return Response.redirect(new URL(`${env.basePath}/admin?ok=${ok}&n=${affected}`, env.publicBaseUrl), 303);
}
