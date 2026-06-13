import { env } from "@/lib/env";
import { exec, one } from "@/lib/db";
import { parseRepoUrl } from "@/lib/repo-url";
import { reqIsAdmin } from "@/lib/admin-auth";
import { adminBack } from "@/lib/form-redirect";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const ct = req.headers.get("content-type") || "";
  const isJson = ct.includes("application/json");

  let url = "";
  let token: string | undefined;
  if (isJson) {
    const body: any = await req.json().catch(() => ({}));
    url = body.url || "";
    token = body.token;
  } else {
    const form = await req.formData();
    url = String(form.get("url") || "");
    const t = form.get("token");
    token = t == null ? undefined : String(t);
  }

  const fail = (msg: string) =>
    isJson ? new Response(msg, { status: 400 }) : adminBack(env.basePath, "crawl", msg, { url });

  if (!reqIsAdmin(req, token)) return new Response("Unauthorized", { status: 401 });
  if (!url) return fail("Repository URL is required");

  let ref;
  try {
    ref = parseRepoUrl(url);
  } catch {
    return fail("Invalid repository URL");
  }

  await exec("INSERT IGNORE INTO repos (source_url, host) VALUES (?,?)", [ref.cloneUrl, ref.host]);
  const repo = await one<{ id: number }>("SELECT id FROM repos WHERE source_url=?", [ref.cloneUrl]);
  if (repo) await exec("INSERT INTO crawl_queue (repo_id) VALUES (?)", [repo.id]);

  if (!isJson) {
    // No-JS admin form: redirect back with a success flag.
    return Response.redirect(new URL(`${env.basePath}/admin?ok=1`, env.publicBaseUrl), 303);
  }
  return Response.json({ ok: true, repo: ref.ownerRepo, queued: !!repo });
}
