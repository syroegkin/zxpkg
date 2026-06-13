import { store } from "@/lib/store";
import { serveFile, safeSeg } from "@/lib/serve";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { name: string; version: string; command: string } }
) {
  const { name, version } = params;
  let command = params.command;
  const isSig = command.endsWith(".sig");
  if (isSig) command = command.slice(0, -4);

  if (![name, version, command].every(safeSeg)) {
    return new Response("Bad request", { status: 400 });
  }

  const path = isSig ? store.sigFile(name, version, command) : store.artifactFile(name, version, command);
  return serveFile(path, "application/octet-stream", isSig ? `${command}.sig` : command);
}
