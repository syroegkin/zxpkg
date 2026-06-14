import { store } from "@/lib/store";
import { serveFile, safeSeg } from "@/lib/serve";

export const dynamic = "force-dynamic";

// Serve a preserved source bundle (the author's original source/binary), mirrored under
// the version's src/ subfolder. Distinct from /source/<name>/<version> which makes a git
// tarball from the mirror — these have no git.
export async function GET(
  _req: Request,
  { params }: { params: { name: string; version: string; file: string } }
) {
  const { name, version, file } = params;
  if (![name, version, file].every(safeSeg)) {
    return new Response("Bad request", { status: 400 });
  }
  return serveFile(store.sourceBundleFile(name, version, file), "application/octet-stream", file);
}
