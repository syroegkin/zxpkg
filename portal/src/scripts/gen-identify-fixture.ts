// gen-identify-fixture.ts — stage a /DOT + trusted index for the device
// CRC->index identification test.  Writes /DOT files (some listed in the index,
// one not) and a /PKG/INDEX.DAT whose records carry each listed file's real
// CRC-32C.  Usage: tsx src/scripts/gen-identify-fixture.ts <esxdos_root>
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { crc32c } from "../lib/crc32c";
import { encodeIndex, type IndexRow } from "../lib/index-format";

const root = process.argv[2];
if (!root) { console.error("usage: gen-identify-fixture.ts <root>"); process.exit(2); }

const listed = [
  { file: "ABC", content: Buffer.from("abc"), name: "alpha", version: "1.0", command: "ABC" },
  { file: "CHECK", content: Buffer.from("123456789"), name: "checker", version: "2.1", command: "CHECK" },
  // >8 KB: exercises the device's STREAMING CRC (must hash the whole file, not just
  // the first 8 KB buffer-full).
  { file: "BIGGY", content: Buffer.from(Array.from({ length: 20000 }, (_, i) => i & 255)),
    name: "biggy", version: "3.0", command: "BIGGY" },
];
const extra = { file: "EXTRA", content: Buffer.from("manually placed, not in the index") };
// A command living in /BIN (the esxDOS location) — exercises scanning both dirs.
const binListed = [
  { file: "BINTOOL", content: Buffer.from("bin payload"), name: "bintool", version: "1.5", command: "BINTOOL" },
];

const dot = join(root, "DOT");
const bin = join(root, "BIN");
rmSync(dot, { recursive: true, force: true });
rmSync(bin, { recursive: true, force: true });
mkdirSync(dot, { recursive: true });
mkdirSync(bin, { recursive: true });
mkdirSync(join(root, "ZXPKG"), { recursive: true });
for (const x of listed) writeFileSync(join(dot, x.file), x.content);
writeFileSync(join(dot, extra.file), extra.content);
for (const x of binListed) writeFileSync(join(bin, x.file), x.content);

const rows: IndexRow[] = [...listed, ...binListed].map((x) => ({
  name: x.name, version: x.version, type: "dot", description: "",
  machine_csv: "48k", os_csv: "esxdos", needs_csv: "", command: x.command,
  crc32c: crc32c(x.content), size: x.content.length,
}));
writeFileSync(join(root, "ZXPKG", "INDEX.DAT"), encodeIndex(rows, 1));
console.log(`staged ${listed.length} indexed + 1 unindexed file in /DOT, index in /ZXPKG`);
