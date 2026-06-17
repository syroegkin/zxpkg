// decode-index.ts — pretty-print a binary index.dat (the device registry index)
// as human-readable text. Use on a v1.dat pulled off the Next, or the portal's.
//   npx tsx src/scripts/decode-index.ts <path/to/index.dat>
import { readFileSync } from "node:fs";
import { MACHINE_BIT, OS_BIT, FEATURE_BIT } from "../lib/index-format";

const path = process.argv[2];
if (!path) { console.error("usage: tsx src/scripts/decode-index.ts <index.dat>"); process.exit(2); }
const b = readFileSync(path);

const names = (flags: number, map: Record<string, number>) =>
  Object.entries(map).filter(([, bit]) => flags & bit).map(([k]) => k).join(",") || "-";

let p = 0;
const u8 = () => b[p++];
const u16 = () => { const v = b.readUInt16LE(p); p += 2; return v; };
const u24 = () => { const v = b.readUIntLE(p, 3); p += 3; return v; };
const u32 = () => { const v = b.readUInt32LE(p); p += 4; return v; };
const str = () => { const n = b[p++]; const s = b.toString("latin1", p, p + n); p += n; return s; };

const schema = u8();
const keyId = u8();
const count = u16();
console.log(`index.dat  schema_ver=${schema}  key_id=${keyId}  records=${count}  bytes=${b.length}`);
if (schema !== 1) { console.error(`! unknown schema_ver ${schema} — refusing to parse further`); process.exit(1); }
console.log("-".repeat(72));

for (let i = 0; i < count && p < b.length; i++) {
  const crc = u32();
  const machine = u8();
  const os = u8();
  const feat = u8();
  const size = u24();
  const type = str(), cmd = str(), name = str(), ver = str(), desc = str();
  console.log(
    `#${String(i).padStart(3)}  ${name}@${ver}  [${type}]  cmd=${cmd}\n` +
    `      machine=${names(machine, MACHINE_BIT)}  os=${names(os, OS_BIT)}  needs=${names(feat, FEATURE_BIT)}\n` +
    `      crc32c=0x${(crc >>> 0).toString(16).padStart(8, "0")}  size=${size}\n` +
    (desc ? `      ${desc}\n` : "")
  );
}
console.log(`done — parsed ${count} records, ${p}/${b.length} bytes consumed`);
