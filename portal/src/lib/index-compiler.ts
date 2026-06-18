// Compile the device-facing binary index.dat from the registry, and sign it.
// Byte layout lives in ./index-format (shared with the spec-vector fixture so
// they can't diverge); device fetch path = /artifact/<name>/<version>/<cmd>.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { query } from "./db";
import { store } from "./store";
import { signBlob, keyId } from "./sign";
import { encodeIndex, type IndexRow } from "./index-format";
import { rebuildGopher } from "./gopher-compiler";
import { splitCsv } from "./manifest";

async function indexRows(): Promise<IndexRow[]> {
  // All versions (not just is_latest) so the device can install/list specific versions.
  // Latest-first per package so a no-version `install <name>` resolves to the newest
  // (idx_find takes the first name match) and `list` can show the newest first.
  // COALESCE admin overrides (package_overrides) over the base so the device index and
  // gopher reflect admin edits/censorship; redistributable is also override-aware.
  return query<IndexRow>(
    `SELECT p.name, v.version, COALESCE(o.type, v.type) AS type,
            COALESCE(o.description, p.description) AS description,
            COALESCE(o.machine_csv, v.machine_csv) AS machine_csv,
            COALESCE(o.os_csv, v.os_csv) AS os_csv,
            COALESCE(o.needs_csv, v.needs_csv) AS needs_csv,
            a.command, a.crc32c, a.size
     FROM versions v
     JOIN packages p ON p.id = v.package_id
     JOIN artifacts a ON a.version_id = v.id
     LEFT JOIN package_overrides o ON o.package_id = p.id
     WHERE p.archive_state = 'listed' AND COALESCE(o.redistributable, p.redistributable) = 1
     ORDER BY p.name, p.preferred DESC, v.is_latest DESC, v.created_at DESC, a.command`
  );
}

export async function compileIndex(): Promise<Buffer> {
  return encodeIndex(await indexRows(), keyId);
}

// Human-readable mirror of index.dat (same records, flags decoded) for debugging:
// open store/index/v1.json or GET /index/v1.json in any text editor/browser.
function humanIndex(rows: IndexRow[]): string {
  return JSON.stringify(
    {
      schema_ver: 1,
      key_id: keyId,
      generated_at: new Date().toISOString(),
      record_count: rows.length,
      records: rows.map((r) => ({
        name: r.name,
        version: r.version,
        type: r.type,
        command: r.command,
        machine: splitCsv(r.machine_csv),
        os: splitCsv(r.os_csv),
        needs: splitCsv(r.needs_csv),
        crc32c: "0x" + (r.crc32c >>> 0).toString(16).padStart(8, "0"),
        size: r.size,
        description: r.description,
      })),
    },
    null,
    2
  );
}

export async function rebuildIndex(): Promise<void> {
  const rows = await indexRows();
  const buf = encodeIndex(rows, keyId);
  mkdirSync(dirname(store.indexDat()), { recursive: true });
  writeFileSync(store.indexDat(), buf);
  writeFileSync(store.indexSig(), signBlob(buf));
  writeFileSync(store.indexJson(), humanIndex(rows));   // human-readable companion
  await rebuildGopher();   // keep the gopher human face in sync with the registry
}
