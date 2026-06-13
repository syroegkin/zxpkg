import { env } from "@/lib/env";
import { reqIsAdmin } from "@/lib/admin-auth";
import { validateManifest, type ManifestInput } from "@/lib/manifest";
import { publishUpload } from "@/lib/publish";
import { adminBack } from "@/lib/form-redirect";
import { isSafePublicUrl } from "@/lib/url-guard";

export const dynamic = "force-dynamic";

// Register a repo-less package from an uploaded binary (no git, no manifest file).
export async function POST(req: Request) {
  const form = await req.formData();
  const g = (k: string): string | undefined => {
    const v = form.get(k);
    return typeof v === "string" ? v : undefined;
  };

  if (!reqIsAdmin(req, g("token"))) return new Response("Unauthorized", { status: 401 });

  // Re-populate the upload form on failure (the file input can't be restored by browsers).
  const values: Record<string, string | string[] | undefined> = {
    binary_url: g("binary_url"), name: g("name"), version: g("version"), type: g("type"),
    machine: g("machine"), os: form.getAll("os").map(String), needs: form.getAll("needs").map(String),
    command: g("command"), description: g("description"), license: g("license"), author: g("author"),
  };
  const fail = (msg: string) => adminBack(req.url, env.basePath, "upload", msg, values);

  const input: ManifestInput = {
    name: g("name"),
    version: g("version"),
    type: g("type"),
    description: g("description"),
    author: g("author"),
    license: g("license"),
    homepage: g("homepage"),
    machine: g("machine"),
    os: form.getAll("os").map(String),
    needs: form.getAll("needs").map(String),
    minCore: g("min_core"),
    artifacts: [{ src: g("binary_url") || "upload", command: g("command") }],
  };

  const { manifest, errors } = validateManifest(input);
  if (!manifest) return fail(errors.join("; "));

  // Bytes come from a physical upload, or — if none — by downloading a binary URL.
  let bytes: Buffer | null = null;
  const file = form.get("file");
  if (file && typeof file !== "string" && typeof (file as File).arrayBuffer === "function" && (file as File).size > 0) {
    bytes = Buffer.from(await (file as File).arrayBuffer());
  } else {
    const url = g("binary_url");
    if (url) {
      if (!isSafePublicUrl(url)) return fail("binary URL must be a public http(s) URL");
      try {
        const res = await fetch(url);
        if (!res.ok) return fail(`download ${url} -> HTTP ${res.status}`);
        bytes = Buffer.from(await res.arrayBuffer());
      } catch (e: any) {
        return fail(`download failed: ${e.message}`);
      }
    }
  }
  if (!bytes || bytes.length === 0) return fail("Provide a file or a binary URL");

  try {
    await publishUpload(manifest, { [manifest.artifacts[0].command]: bytes });
  } catch (e: any) {
    return fail(`publish failed: ${e.message}`);
  }

  return Response.redirect(new URL(`${env.basePath}/admin?ok=upload`, req.url), 303);
}
