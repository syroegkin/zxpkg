// SEO: serve under a subdirectory (e.g. /pkg on zx.in.net) to consolidate domain
// authority. Set BASE_PATH="/pkg" in production; leave empty for local dev.
const basePath = process.env.BASE_PATH || "";

/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath,
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  // The archiver/worker uses git + the filesystem; keep server-only deps external.
  experimental: {
    serverComponentsExternalPackages: ["mysql2"],
  },
};

export default nextConfig;
