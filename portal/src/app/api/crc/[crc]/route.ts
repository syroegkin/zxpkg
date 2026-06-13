import { crcLookup } from "@/lib/queries";

export const dynamic = "force-dynamic";

// CRC is given as 8 hex digits (as the device computes/prints it), e.g. /api/crc/1a2b3c4d
export async function GET(_req: Request, { params }: { params: { crc: string } }) {
  if (!/^[0-9a-fA-F]{1,8}$/.test(params.crc)) return new Response("bad crc", { status: 400 });
  const hit = await crcLookup(parseInt(params.crc, 16));
  if (!hit) return new Response("Not found", { status: 404 });
  return Response.json(hit);
}
