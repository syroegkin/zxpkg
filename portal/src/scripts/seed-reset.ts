// Manual maintenance job — `npm run seed:reset`.
// Deletes the seeded metadata catalog (entries from seed/catalog.yaml) so it can be
// re-applied fresh. NEVER runs automatically. Preserves any seeded package that was
// promoted with an uploaded binary or hand-edited via an admin override. Rebuilds the
// device index + gopher afterwards so the registry and the index stay consistent.
import { bootstrap } from "../lib/db";
import { resetSeededCatalog } from "../lib/seed-catalog";
import { rebuildIndex } from "../lib/index-compiler";

async function main(): Promise<void> {
  console.log("[seed:reset] ensuring schema…");
  await bootstrap();
  console.log("[seed:reset] deleting seeded metadata packages (skipping ones with a binary or an override)…");
  const { deleted } = await resetSeededCatalog();
  console.log(`[seed:reset] deleted ${deleted} seeded package(s).`);
  await rebuildIndex();
  console.log("[seed:reset] index.dat + gopher rebuilt. done.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[seed:reset] failed:", e);
    process.exit(1);
  });
