// index.dat v1 byte layout (spec §6) — the pure encoder, shared by the live
// compiler (index-compiler.ts) and the spec-vector fixture generator so they
// can never diverge.  Little-endian, byte-aligned, length-prefixed strings.
//
//   [u8 schema_ver=1][u8 key_id][u16 record_count]
//   record*: [u32 crc32c][u8 machine][u8 os_flags][u8 feature_flags][u24 size]
//            [u8 type_len][type][u8 cmd_len][cmd][u8 name_len][name]
//            [u8 ver_len][ver][u8 desc_len][desc]
export const SCHEMA_VER = 1;
export const MACHINE_CODE: Record<string, number> = { "16k": 0, "48k": 1, "128k": 2, next: 3 };
export const OS_BIT: Record<string, number> = { nextzxos: 1, esxdos: 2 };
export const FEATURE_BIT: Record<string, number> = { wifi: 1, accelerator: 2, "2mb": 4 };

export interface IndexRow {
  name: string;
  version: string;
  type: string;
  description: string | null;
  machine: string;
  os_csv: string;
  needs_csv: string;
  command: string;
  crc32c: number;
  size: number;
}

export function flags(csv: string, map: Record<string, number>): number {
  let f = 0;
  for (const t of csv.split(",").map((s) => s.trim()).filter(Boolean)) f |= map[t] || 0;
  return f;
}

function strField(s: string): Buffer {
  const b = Buffer.from(s, "latin1").subarray(0, 255);
  return Buffer.concat([Buffer.from([b.length]), b]);
}

export function encodeIndex(rows: IndexRow[], keyId: number): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt8(SCHEMA_VER, 0);
  header.writeUInt8(keyId & 0xff, 1);
  header.writeUInt16LE(rows.length & 0xffff, 2);

  const chunks: Buffer[] = [header];
  for (const r of rows) {
    const fixed = Buffer.alloc(10);
    fixed.writeUInt32LE(r.crc32c >>> 0, 0);
    fixed.writeUInt8(MACHINE_CODE[r.machine] ?? 1, 4);
    fixed.writeUInt8(flags(r.os_csv, OS_BIT), 5);
    fixed.writeUInt8(flags(r.needs_csv, FEATURE_BIT), 6);
    fixed.writeUIntLE(Math.min(r.size, 0xffffff), 7, 3);
    chunks.push(
      fixed,
      strField(r.type),
      strField(r.command),
      strField(r.name),
      strField(r.version),
      strField(r.description || "")
    );
  }
  return Buffer.concat(chunks);
}
