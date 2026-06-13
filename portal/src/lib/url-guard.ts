// Guards for URLs we act on server-side, now that the public can submit repos.
// Prevents SSRF (internal/loopback/metadata hosts) and non-http(s) schemes.

// Public repo submissions are restricted to known git hosts (admins may add others).
export const ALLOWED_REPO_HOSTS = ["github.com", "gitlab.com", "codeberg.org", "bitbucket.org", "git.sr.ht"];

export function isAllowedRepoHost(host: string): boolean {
  return ALLOWED_REPO_HOSTS.includes(host.toLowerCase());
}

// True only for http(s) URLs whose host isn't loopback / private / link-local.
export function isSafePublicUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;

  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h === "0.0.0.0" || h.endsWith(".localhost")) return false;
  // IPv6 loopback / unique-local / link-local
  if (h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80")) return false;
  // IPv4 literals in loopback / private / link-local (incl. 169.254.169.254 metadata)
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 0 || a === 127 || a === 10) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 169 && b === 254) return false;
  }
  return true;
}

// Safe to use as an <a href>: http(s)/mailto only (blocks javascript:, data:, etc.).
export function safeHref(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return ["https:", "http:", "mailto:"].includes(u.protocol) ? raw : null;
  } catch {
    return null;
  }
}
