// The one-line installer: a TOKENIZED NextBASIC program (with +3DOS header, so
// LOAD "install.bas" works directly) that bootstraps the on-device client.
//   .http get -h <host> -u /install.bas -f install.bas
//   LOAD "install.bas": RUN
// Listing source: src/lib/install-bas.ts.  Tokenized with remysharp's txt2bas —
// the same author's .http is what fetches it.  Plain-HTTP device endpoint (the
// bootstrap set; see DEPLOY.md).
import { file2bas } from "txt2bas";
import { env } from "@/lib/env";
import { installBasSource } from "@/lib/install-bas";

export const dynamic = "force-dynamic";

export async function GET() {
  // Bake the portal's own host into the .http lines (its args must be literals).
  const url = new URL(env.publicBaseUrl);
  const port = url.port ? Number(url.port) : 80; // device fetches are plain HTTP
  const bin = file2bas(installBasSource(url.hostname, port));
  return new Response(new Uint8Array(bin), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(bin.length),
      "Content-Disposition": 'attachment; filename="install.bas"',
    },
  });
}
