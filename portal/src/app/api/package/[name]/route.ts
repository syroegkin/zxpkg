import { getPackage } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { name: string } }) {
  const data = await getPackage(params.name);
  if (!data) return new Response("Not found", { status: 404 });
  return Response.json(data);
}
