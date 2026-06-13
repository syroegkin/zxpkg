import { store } from "@/lib/store";
import { serveFile } from "@/lib/serve";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { file: string } }) {
  if (params.file === "v1.dat") return serveFile(store.indexDat(), "application/octet-stream");
  if (params.file === "v1.dat.sig") return serveFile(store.indexSig(), "application/octet-stream");
  return new Response("Not found", { status: 404 });
}
