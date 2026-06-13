// Stable bootstrap URLs for the on-device client, used by the BASIC installer
// (/install.bas) so it never needs version-specific paths:
//   /dist/PKG, /dist/PKG-INST (+ .sig)
// Plain-HTTP / gopher device endpoint (integrity via signatures, like the rest).
import { store } from "@/lib/store";
import { serveFile } from "@/lib/serve";

export const dynamic = "force-dynamic";

const ALLOWED = new Set(["PKG", "PKG.sig", "PKG-INST", "PKG-INST.sig"]);

export async function GET(_req: Request, { params }: { params: { file: string } }) {
  if (!ALLOWED.has(params.file)) return new Response("Not found", { status: 404 });
  return serveFile(store.distFile(params.file), "application/octet-stream", params.file);
}
