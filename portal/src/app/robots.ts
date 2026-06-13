import type { MetadataRoute } from "next";
import { env } from "@/lib/env";

export default function robots(): MetadataRoute.Robots {
  const bp = process.env.NEXT_PUBLIC_BASE_PATH || "";
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/api/"] },
    sitemap: `${env.publicBaseUrl}${bp}/sitemap.xml`,
  };
}
