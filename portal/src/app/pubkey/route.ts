// Public key endpoint. Serves the device-format key entry (spec §5.6):
//   [u8 key_id][u8 algo][128 n LE]   — binary by default.
// `?format=hex` returns a human-readable JSON view (key_id, algo, n hex).
import { publicKeyEntry, keyId } from "@/lib/sign";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const entry = publicKeyEntry();
    const format = new URL(req.url).searchParams.get("format");
    if (format === "hex") {
      return Response.json({
        key_id: entry[0],
        algo: entry[1],
        algo_name: entry[1] === 1 ? "rabin-williams-1024" : `unknown(${entry[1]})`,
        n_le_hex: entry.subarray(2).toString("hex"),
      });
    }
    return new Response(new Uint8Array(entry), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": 'attachment; filename="pubkey.bin"',
        "X-Key-Id": String(keyId),
        "X-Algo": "rabin-williams-1024",
      },
    });
  } catch {
    return new Response("signing key not configured", { status: 503 });
  }
}
