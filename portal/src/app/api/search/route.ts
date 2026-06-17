import { searchPackages } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const { items, total, page, pages } = await searchPackages({
    q: url.searchParams.get("q") || undefined,
    type: url.searchParams.get("type") || undefined,
    machine: url.searchParams.get("machine") || undefined,
    os: url.searchParams.get("os") || undefined,
    page: parseInt(url.searchParams.get("page") || "1", 10) || 1,
  });
  return Response.json({ results: items, total, page, pages });
}
