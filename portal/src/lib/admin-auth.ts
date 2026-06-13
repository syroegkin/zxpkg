// Admin authentication: a single shared token, carried in an httpOnly cookie for the
// web UI (or an x-admin-token header for CLI/JSON). The /admin page is hidden unless
// the cookie is valid.
import { env } from "./env";

export const ADMIN_COOKIE = "zxpkg_admin";

export function tokenIsValid(token: string | undefined | null): boolean {
  return !!env.adminToken && token === env.adminToken;
}

// Read the admin cookie from a raw Request (route handlers).
export function cookieToken(req: Request): string | undefined {
  const raw = req.headers.get("cookie") || "";
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    if (k === ADMIN_COOKIE) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

// A request is admin if the cookie, header, or an explicit form token is valid.
export function reqIsAdmin(req: Request, formToken?: string): boolean {
  return tokenIsValid(cookieToken(req)) || tokenIsValid(req.headers.get("x-admin-token")) || tokenIsValid(formToken);
}

export function cookieIsSecure(): boolean {
  return env.publicBaseUrl.startsWith("https://");
}
