// Central runtime configuration, read from environment variables.
// Server-only — never import this from a client component.

export const env = {
  db: {
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "zxpkg",
    password: process.env.DB_PASSWORD || "zxpkg",
    database: process.env.DB_NAME || "zxpkg",
  },
  adminToken: process.env.ADMIN_TOKEN || "",
  storeDir: process.env.STORE_DIR || "./store",
  sign: {
    keyId: Number(process.env.SIGN_KEY_ID || 1),
    privateKeyPath: process.env.SIGN_PRIVATE_KEY || "./keys/private.json",
    publicKeyPath: process.env.SIGN_PUBLIC_KEY || "./keys/public.json",
  },
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS || 6 * 60 * 60 * 1000),
  seedFile: process.env.SEED_FILE || "./repos.yaml",
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || "http://localhost:3000").replace(/\/$/, ""),
  basePath: process.env.BASE_PATH || "",
};
