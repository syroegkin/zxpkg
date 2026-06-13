// Compile the device-facing binary index.dat from the registry, and sign it.
// Byte layout lives in ./index-format (shared with the spec-vector fixture so
// they can't diverge); device fetch path = /artifact/<name>/<version>/<cmd>.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { query } from "./db";
import { store } from "./store";
import { signBlob, keyId } from "./sign";
import { encodeIndex, type IndexRow } from "./index-format";

export async function compileIndex(): Promise<Buffer> {
  const rows = await query<IndexRow>(
    `SELECT p.name, v.version, v.type, p.description, v.machine, v.os_csv, v.needs_csv,
            a.command, a.crc32c, a.size
     FROM versions v
     JOIN packages p ON p.id = v.package_id
     JOIN artifacts a ON a.version_id = v.id
     WHERE v.is_latest = 1
     ORDER BY p.name, a.command`
  );
  return encodeIndex(rows, keyId);
}

export async function rebuildIndex(): Promise<void> {
  const buf = await compileIndex();
  mkdirSync(dirname(store.indexDat()), { recursive: true });
  writeFileSync(store.indexDat(), buf);
  writeFileSync(store.indexSig(), signBlob(buf));
}
