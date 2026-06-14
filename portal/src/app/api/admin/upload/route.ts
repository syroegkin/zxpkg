import { env } from "@/lib/env";
import { reqIsAdmin } from "@/lib/admin-auth";
import { validateManifest, type ManifestInput } from "@/lib/manifest";
import { publishUpload } from "@/lib/publish";
import { addSourceBundle } from "@/lib/source-bundle";
import { adminBack } from "@/lib/form-redirect";
import { isSafePublicUrl } from "@/lib/url-guard";

export const dynamic = "force-dynamic";

// Pull a non-empty uploaded file out of a FormData value (null if absent/empty/text).
async function fileFrom(value: FormDataEntryValue | null): Promise<{ name: string; bytes: Buffer } | null> {
  if (!value || typeof value === "string" || typeof (value as File).arrayBuffer !== "function" || (value as File).size === 0) {
    return null;
  }
  const f = value as File;
  return { name: f.name || "", bytes: Buffer.from(await f.arrayBuffer()) };
}

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
    homepage: g("homepage"), source_url: g("source_url"), source_label: g("source_label"),
  };
  const fail = (msg: string) => adminBack(env.basePath, "upload", msg, values);

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
  const uploaded = await fileFrom(form.get("file"));
  if (uploaded) {
    bytes = uploaded.bytes;
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

  // Optionally preserve the author's original source (a file and/or an upstream URL).
  // Read + cap-check the source file up front so a too-big bundle fails before publishing.
  const srcUrl = g("source_url");
  let bundleFile: { name: string; bytes: Buffer } | undefined;
  const srcUpload = await fileFrom(form.get("source_file"));
  if (srcUpload) {
    if (srcUpload.bytes.length > env.maxSourceBundleBytes) {
      return fail(`source bundle exceeds ${env.maxSourceBundleBytes} byte limit`);
    }
    bundleFile = { name: srcUpload.name || "source.bin", bytes: srcUpload.bytes };
  }

  let versionId: number;
  try {
    versionId = await publishUpload(manifest, { [manifest.artifacts[0].command]: bytes });
  } catch (e: any) {
    return fail(`publish failed: ${e.message}`);
  }

  if (bundleFile || srcUrl) {
    // URL fetch is best-effort (falls back to link-only); the file was already cap-checked.
    await addSourceBundle(versionId, manifest.name, manifest.version, {
      file: bundleFile,
      url: srcUrl,
      label: g("source_label"),
    });
  }

  return Response.redirect(new URL(`${env.basePath}/admin?ok=upload`, env.publicBaseUrl), 303);
}
