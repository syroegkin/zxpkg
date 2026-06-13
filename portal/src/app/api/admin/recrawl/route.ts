import { env } from "@/lib/env";
import { exec } from "@/lib/db";
import { reqIsAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

// Force a re-crawl of a repo: clear last_commit_sha (so change-detection won't skip it)
// and queue a crawl for the worker to pick up.
export async function POST(req: Request) {
  const form = await req.formData();
  const id = String(form.get("id") || "");
  if (!reqIsAdmin(req, String(form.get("token") || "") || undefined)) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!id) return new Response("missing id", { status: 400 });

  await exec("UPDATE repos SET last_commit_sha=NULL WHERE id=?", [id]);
  await exec("INSERT INTO crawl_queue (repo_id) VALUES (?)", [id]);
  return Response.redirect(new URL(`${env.basePath}/admin?ok=recrawl`, req.url), 303);
}
