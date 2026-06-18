import { env } from "@/lib/env";
import { exec } from "@/lib/db";
import { reqIsAdmin } from "@/lib/admin-auth";
import { rebuildIndex } from "@/lib/index-compiler";
import { getOverrideEditData } from "@/lib/queries";
import { MACHINES, OSES, FEATURES } from "@/lib/manifest";

export const dynamic = "force-dynamic";

// Write per-field admin overrides for a package. Overrides are a layer ON TOP of the
// package's base data (seed / crawled TOML / upload): a non-null column wins at read
// time, a null column inherits the base. We diff each submitted field against the base
// — equal (or its `inherit_<field>` box ticked) => store NULL (inherit); different =>
// store the value (empty string is a valid override, e.g. censoring a description).
// If nothing ends up overridden, the row is deleted entirely.
export async function POST(req: Request) {
  const f = await req.formData();
  const g = (k: string) => {
    const v = f.get(k);
    return v == null ? undefined : String(v);
  };
  const inherit = (field: string) => f.get(`inherit_${field}`) != null;
  const token = g("token");
  const name = g("name") || "";

  const back = (qs: string) =>
    Response.redirect(new URL(`${env.basePath}/admin?${qs}`, env.publicBaseUrl), 303);
  const fail = (msg: string) => back(`override=${encodeURIComponent(name)}&err=${encodeURIComponent(msg)}`);

  if (!reqIsAdmin(req, token)) return new Response("Unauthorized", { status: 401 });
  if (!name) return fail("package name is required");

  const data = await getOverrideEditData(name);
  if (!data) return fail(`package "${name}" not found`);

  // --- compute each override column (null = inherit base) ---
  const sameSet = (a: string, b: string) => {
    const sa = new Set(a.split(",").filter(Boolean));
    const sb = new Set(b.split(",").filter(Boolean));
    return sa.size === sb.size && [...sa].every((x) => sb.has(x));
  };
  // free text: empty-string IS a meaningful override (censor), so only base-equality or
  // an explicit inherit tick clears it.
  const textCol = (field: keyof typeof data.base): string | null => {
    if (inherit(field as string)) return null;
    const submitted = (g(field as string) ?? "").trim();
    const base = data.base[field] ?? "";
    return submitted === base ? null : submitted;
  };
  // type must be non-empty; empty => inherit.
  const typeCol = (): string | null => {
    if (inherit("type")) return null;
    const submitted = (g("type") ?? "").trim();
    return submitted && submitted !== (data.base.type ?? "") ? submitted : null;
  };
  const csvCol = (field: "machine" | "os" | "needs", allowed: readonly string[]): string | null => {
    if (inherit(field)) return null;
    const picked = f.getAll(field).map(String);
    const sub = allowed.filter((x) => picked.includes(x)).join(","); // validate + canonicalize order
    const base = data.base[`${field === "machine" ? "machine" : field}_csv` as keyof typeof data.base] ?? "";
    return sameSet(sub, base) ? null : sub;
  };
  const redisCol = (): string | null => {
    if (inherit("redistributable")) return null;
    const sub = g("redistributable") === "false" ? "0" : "1";
    return sub === (data.base.redistributable ?? "1") ? null : sub;
  };

  const cols = {
    description: textCol("description"),
    readme: textCol("readme"),
    homepage: textCol("homepage"),
    license: textCol("license"),
    author: textCol("author"),
    redistributable: redisCol(),
    type: typeCol(),
    machine_csv: csvCol("machine", MACHINES),
    os_csv: csvCol("os", OSES),
    needs_csv: csvCol("needs", FEATURES),
    bundled_in: textCol("bundled_in"),
  };
  const note = (g("note") ?? "").trim() || null;

  const anyOverride = Object.values(cols).some((v) => v !== null);
  if (!anyOverride) {
    // nothing left to override — clear the row so the base source fully re-surfaces
    await exec("DELETE FROM package_overrides WHERE package_id=?", [data.id]);
  } else {
    await exec(
      `INSERT INTO package_overrides
         (package_id, description, readme, homepage, license, author, redistributable,
          type, machine_csv, os_csv, needs_csv, bundled_in, note, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())
       ON DUPLICATE KEY UPDATE
         description=VALUES(description), readme=VALUES(readme), homepage=VALUES(homepage),
         license=VALUES(license), author=VALUES(author), redistributable=VALUES(redistributable),
         type=VALUES(type), machine_csv=VALUES(machine_csv), os_csv=VALUES(os_csv),
         needs_csv=VALUES(needs_csv), bundled_in=VALUES(bundled_in), note=VALUES(note), updated_at=NOW()`,
      [
        data.id, cols.description, cols.readme, cols.homepage, cols.license, cols.author,
        cols.redistributable, cols.type, cols.machine_csv, cols.os_csv, cols.needs_csv,
        cols.bundled_in, note,
      ]
    );
  }

  await rebuildIndex(); // index.dat + gopher reflect the new effective values
  return back("ok=override");
}
