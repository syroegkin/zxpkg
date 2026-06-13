// Redirect back to /admin after a failed submit, carrying an error message and the
// submitted values so the form can be re-populated (SSR-friendly, no client JS).
import { env } from "./env";

export function adminBack(
  basePath: string,
  activeForm: string,
  err: string,
  values: Record<string, string | string[] | undefined>
): Response {
  const u = new URL(`${basePath}/admin`, env.publicBaseUrl);
  u.searchParams.set("af", activeForm);
  u.searchParams.set("err", err);
  for (const [k, val] of Object.entries(values)) {
    if (val == null) continue;
    if (Array.isArray(val)) val.forEach((x) => u.searchParams.append(k, x));
    else if (val !== "") u.searchParams.set(k, val);
  }
  return new Response(null, { status: 303, headers: { Location: u.toString() } });
}
