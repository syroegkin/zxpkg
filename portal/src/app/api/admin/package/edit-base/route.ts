import { env } from "@/lib/env";
import { exec, one } from "@/lib/db";
import { reqIsAdmin } from "@/lib/admin-auth";
import { rebuildIndex } from "@/lib/index-compiler";
import { MACHINES, OSES, FEATURES } from "@/lib/manifest";

export const dynamic = "force-dynamic";

// Simple BASE edit — fixes the package + latest-version rows DIRECTLY (not the override
// layer). Meant for the auto-added, often poorly-parsed metadata/seed packages: edit the
// source values in place. (For repo-crawled packages prefer Override, since the crawler
// rewrites the base on the next sweep.)
export async function POST(req: Request) {
  const f = await req.formData();
  const g = (k: string) => {
    const v = f.get(k);
    return v == null ? undefined : String(v);
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

  await exec(
    "UPDATE packages SET description=?, homepage=?, license=?, author=?, redistributable=? WHERE id=?",
    [text("description"), text("homepage"), text("license"), text("author"), redist, p.id]
  );
  if (v) {
    await exec(
      `UPDATE versions SET version=?, type=?, machine_csv=?, os_csv=?, needs_csv=?, os_version=?, bundled_in=?
       WHERE id=?`,
      [
        (g("version") ?? "0").trim() || "0", typeVal, canon("machine", MACHINES), canon("os", OSES),
        canon("needs", FEATURES), text("os_version"), text("bundled_in"), v.id,
      ]
    );
  }
  await rebuildIndex();
  return back("ok=editbase");
}
