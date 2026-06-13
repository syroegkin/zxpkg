import type { MetadataRoute } from "next";
import { allPackageNames } from "@/lib/queries";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const bp = process.env.NEXT_PUBLIC_BASE_PATH || "";
  const base = `${env.publicBaseUrl}${bp}`;
  let names: string[] = [];
  try {
    names = await allPackageNames();
  } catch {
    names = [];
  }
  return [
    { url: `${base}/`, changeFrequency: "daily", priority: 1 },
    { url: `${base}/docs`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/new`, changeFrequency: "monthly", priority: 0.5 },
    ...names.map((n) => ({ url: `${base}/${n}`, changeFrequency: "weekly" as const, priority: 0.8 })),
  ];
}
