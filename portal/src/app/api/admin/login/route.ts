import { env } from "@/lib/env";
import { ADMIN_COOKIE, tokenIsValid, cookieIsSecure } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const form = await req.formData();
  const token = String(form.get("token") || "");
  const base = env.basePath;

  if (!tokenIsValid(token)) {
    return Response.redirect(new URL(`${base}/admin?bad=1`, req.url), 303);
  }

  const secure = cookieIsSecure() ? "; Secure" : "";
  const cookie = `${ADMIN_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800${secure}`;
  return new Response(null, {
    status: 303,
    headers: { Location: new URL(`${base}/admin`, req.url).toString(), "Set-Cookie": cookie },
  });
}
