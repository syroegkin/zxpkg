// One-shot migration step: apply schema.sql (CREATE IF NOT EXISTS + idempotent ALTERs).
// Run as its own container before web/worker start.
import { bootstrap } from "../lib/db";
import { ensureKeys } from "../lib/sign";

async function main(): Promise<void> {
  console.log("[migrate] ensuring signing keypair…");
  ensureKeys();
  console.log("[migrate] applying schema…");
  await bootstrap();
  console.log("[migrate] done.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[migrate] failed:", e);
    process.exit(1);
  });
