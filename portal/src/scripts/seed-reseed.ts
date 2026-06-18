// Manual maintenance job — `npm run seed:reseed`.
// Re-applies the catalog from seed/catalog.yaml: deletes the old seeded metadata packages
// (preserving any promoted-with-binary or admin-overridden ones), re-runs the seeder, then
// rebuilds the device index.dat + gopher. Run this after editing seed/catalog.yaml to push
// the changes into a live DB (boot-time seeding only ADDS new entries, never updates them).
// NEVER runs automatically.
import { bootstrap } from "../lib/db";
import { resetSeededCatalog, seedCatalog } from "../lib/seed-catalog";
import { rebuildIndex } from "../lib/index-compiler";

async function main(): Promise<void> {
  console.log("[seed:reseed] ensuring schema…");
  await bootstrap();
  const { deleted } = await resetSeededCatalog();
  console.log(`[seed:reseed] cleared ${deleted} old seeded package(s).`);
  const { added, skipped } = await seedCatalog();
  console.log(`[seed:reseed] seeded +${added} added, ${skipped} skipped.`);
  await rebuildIndex();
  console.log("[seed:reseed] index.dat + gopher rebuilt. done.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[seed:reseed] failed:", e);
    process.exit(1);
  });
