import { basename } from "node:path";
import { getPackage } from "@/lib/queries";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { name: string } }) {
  const data = await getPackage(params.name);
  if (!data || data.pkg.archive_state !== "listed") return new Response("Not found", { status: 404 });

  const verById = new Map(data.versions.map((v) => [v.id, v.version]));
  // Public shape: never expose the internal file_path; give a download URL instead.
  const bundles = data.bundles.map((b) => ({
    version: verById.get(b.version_id) ?? null,
    label: b.label,
    original_url: b.original_url,
    sha256: b.sha256,
    size: b.size,
    download:
      b.file_path && verById.has(b.version_id)
        ? `${env.basePath}/source/${data.pkg.name}/${verById.get(b.version_id)}/${basename(b.file_path)}`
        : null,
  }));

  return Response.json({ pkg: data.pkg, versions: data.versions, artifacts: data.artifacts, bundles });
}
