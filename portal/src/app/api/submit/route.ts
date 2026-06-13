import { env } from "@/lib/env";
import { exec, one } from "@/lib/db";
import { parseRepoUrl } from "@/lib/repo-url";
import { isSafePublicUrl, isAllowedRepoHost } from "@/lib/url-guard";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// PUBLIC endpoint: anyone may submit a git repo to be watched + indexed.
// Restricted to known git hosts and safe (non-internal) URLs to avoid SSRF.
export async function POST(req: Request) {
  const ct = req.headers.get("content-type") || "";
  const isJson = ct.includes("application/json");

  let url = "";
  if (isJson) {
    const b: any = await req.json().catch(() => ({}));
    url = b.url || b.repo_url || "";
  } else {
    const f = await req.formData();
    url = String(f.get("repo_url") || f.get("url") || "");
  }

  const back = (q: string) =>
    isJson ? new Response(q, { status: 400 }) : Response.redirect(new URL(`${env.basePath}/new?${q}`, req.url), 303);

  // Rate limit: 5 submissions per 10 minutes per IP.
  if (!rateLimit(`submit:${clientIp(req)}`, 5, 10 * 60 * 1000)) {
    const msg = "Too+many+submissions,+please+try+again+later";
    return isJson
      ? new Response("rate limited", { status: 429 })
      : Response.redirect(new URL(`${env.basePath}/new?submit_err=${msg}`, req.url), 303);
  }

  if (!url) return back("submit_err=Repository+URL+is+required");
  if (!isSafePublicUrl(url)) return back("submit_err=Must+be+a+public+http(s)+URL");

  let ref;
  try {
    ref = parseRepoUrl(url);
  } catch {
    return back("submit_err=Invalid+repository+URL");
  }
  if (!isAllowedRepoHost(ref.host)) {
    return back("submit_err=Host+not+allowed+(use+GitHub%2C+GitLab%2C+Codeberg%2C+Bitbucket%2C+sr.ht)");
  }

  // Duplicate detection: already known? Re-queue a check and say so.
  const existing = await one<{ id: number }>("SELECT id FROM repos WHERE source_url=?", [ref.cloneUrl]);
  if (existing) {
    await exec("INSERT INTO crawl_queue (repo_id) VALUES (?)", [existing.id]);
    if (isJson) return Response.json({ ok: true, repo: ref.ownerRepo, duplicate: true });
    return Response.redirect(new URL(`${env.basePath}/new?submitted_repo=${encodeURIComponent(ref.ownerRepo)}&dup=1`, req.url), 303);
  }

  await exec("INSERT INTO repos (source_url, host, status) VALUES (?,?, 'pending')", [ref.cloneUrl, ref.host]);
  const repo = await one<{ id: number }>("SELECT id FROM repos WHERE source_url=?", [ref.cloneUrl]);
  if (repo) await exec("INSERT INTO crawl_queue (repo_id) VALUES (?)", [repo.id]);

  if (isJson) return Response.json({ ok: true, repo: ref.ownerRepo });
  return Response.redirect(new URL(`${env.basePath}/new?submitted_repo=${encodeURIComponent(ref.ownerRepo)}`, req.url), 303);
}
