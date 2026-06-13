import { env } from "@/lib/env";
import { ADMIN_COOKIE } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const cookie = `${ADMIN_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  return new Response(null, {
    status: 303,
    headers: { Location: new URL(`${env.basePath}/admin`, env.publicBaseUrl).toString(), "Set-Cookie": cookie },
  });
}
