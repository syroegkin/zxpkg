// Generate the committed shared crypto-parity vectors in spec/vectors/ (the gate
// described in 00-overview.md "Verification" and plans/01-spec.md §8).
//
// Everything is DETERMINISTIC: signing has no randomness, so a single committed
// TEST keypair (spec/vectors/testkey.json — generated once, then reused) yields
// reproducible Rabin vectors.  CRC-32C and SHA-256 are deterministic by nature.
//
// Outputs (JSON, committed): testkey.json, crc32c.json, sha256.json, rabin.json
// Usage: npm run vectors:gen   (writes ../spec/vectors relative to portal/)
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { crc32c } from "../lib/crc32c";
import {
  generateKeypair,
  sign,
  encodeSig,
  toLE,
  type RabinPrivateKey,
} from "../lib/rabin";
import { encodeIndex, type IndexRow } from "../lib/index-format";

const OUT = resolve(process.cwd(), process.argv[2] || "../spec/vectors");
mkdirSync(OUT, { recursive: true });

function sha256hex(b: Buffer): string {
  return createHash("sha256").update(b).digest("hex");
}
const hx = (s: string) => Buffer.from(s, "ascii");

// ---- fixed TEST keypair (generate once, then committed & reused) ----
const keyPath = resolve(OUT, "testkey.json");
let key: RabinPrivateKey;
if (existsSync(keyPath)) {
  const s = JSON.parse(readFileSync(keyPath, "utf8"));
  key = { algo: s.algo, keyId: s.key_id, n: BigInt("0x" + s.n), p: BigInt("0x" + s.p), q: BigInt("0x" + s.q) };
  console.log("reusing committed testkey.json");
} else {
  key = generateKeypair(1);
  writeFileSync(
    keyPath,
    JSON.stringify(
      {
        _comment: "TEST-ONLY Rabin-Williams-1024 key for shared parity vectors. NEVER used to sign real artifacts.",
        algo: key.algo,
        key_id: key.keyId,
        n: key.n.toString(16),
        p: key.p.toString(16),
        q: key.q.toString(16),
      },
      null,
      2
    ) + "\n"
  );
  console.log("generated new testkey.json");
}

// ---- CRC-32C vectors (Node has an impl; Z80 impl is future work) ----
const crcInputs = ["", "abc", "123456789", "The quick brown fox jumps over the lazy dog"];
const crcVec = {
  params: { poly_reflected: "0x82F63B78", init: "0xFFFFFFFF", reflect_in_out: true, xorout: "0xFFFFFFFF" },
  cases: crcInputs.map((s) => ({
    name: s === "" ? "(empty)" : s.slice(0, 16),
    input_hex: hx(s).toString("hex"),
    crc32c: "0x" + (crc32c(hx(s)) >>> 0).toString(16).padStart(8, "0"),
  })),
};
writeFileSync(resolve(OUT, "crc32c.json"), JSON.stringify(crcVec, null, 2) + "\n");

// ---- SHA-256 KATs (same set as `make sha-kat`) ----
const shaInputs: [string, Buffer][] = [
  ["(empty)", hx("")],
  ["abc", hx("abc")],
  ["56-byte", hx("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")],
  ["64xa", Buffer.alloc(64, 0x61)],
  ["120xa", Buffer.alloc(120, 0x61)],
];
const shaVec = {
  cases: shaInputs.map(([name, b]) => ({ name, input_hex: b.toString("hex"), sha256: sha256hex(b) })),
};
writeFileSync(resolve(OUT, "sha256.json"), JSON.stringify(shaVec, null, 2) + "\n");

// ---- Rabin-Williams signed/tampered vectors (deterministic for the test key) ----
const blobs: [string, Buffer][] = [
  ["abc", hx("abc")],
  ["artifact-66", hx("ZXPkg parity vector artifact: brown fox 0123456789 ABCDEFGHIJ xx")],
  ["empty", hx("")],
  ["block-boundary-64", Buffer.alloc(64, 0x5a)],
];
const cases: Array<Record<string, unknown>> = [];
for (const [name, blob] of blobs) {
  const sig = sign(blob, key);
  const sigHex = encodeSig(key.keyId, sig).toString("hex");
  cases.push({ name, blob_hex: blob.toString("hex"), sig_hex: sigHex, e: sig.e, f: sig.f, expect: "valid" });
  // tampered twin: flip the first byte (or use a 1-byte blob for the empty case)
  const t = blob.length ? Buffer.from(blob) : Buffer.from([0x00]);
  if (blob.length) t[0] ^= 0x01;
  cases.push({ name: `${name}-tampered`, blob_hex: t.toString("hex"), sig_hex: sigHex, expect: "invalid" });
}
const rabinVec = {
  algo: "rabin-williams-1024",
  key_id: key.keyId,
  n_le_hex: toLE(key.n).toString("hex"),
  sig_format: "[u8 key_id][u8 tweak: bit0=e(0:1,1:2), bit1=f(0:+1,1:-1)][128 s LE]",
  em_format: "M = 6A | BC*94 | SHA-256(blob)[32] | CC (big-endian, 128 bytes)",
  cases,
};
writeFileSync(resolve(OUT, "rabin.json"), JSON.stringify(rabinVec, null, 2) + "\n");

// ---- index.dat v1 fixture (spec §6) — encoded with the SAME encoder the portal ships ----
const indexRows: IndexRow[] = [
  { name: "morse", version: "1.2.0", type: "dot", description: "Morse code for the ZX Spectrum", machine: "48k", os_csv: "nextzxos,esxdos", needs_csv: "", command: "MORSE", crc32c: 0x1234abcd, size: 512 },
  { name: "nxtel", version: "0.9", type: "dot", description: "Viewdata / teletext client", machine: "next", os_csv: "nextzxos", needs_csv: "wifi", command: "NXTEL", crc32c: 0xdeadbeef, size: 4096 },
  { name: "snake", version: "2.0.1", type: "game", description: "", machine: "128k", os_csv: "esxdos", needs_csv: "", command: "SNAKE", crc32c: 0x00ff00ff, size: 16384 },
];
const indexKeyId = 1;
const indexBuf = encodeIndex(indexRows, indexKeyId);
writeFileSync(resolve(OUT, "index.dat"), indexBuf);
writeFileSync(
  resolve(OUT, "index.json"),
  JSON.stringify({ schema_ver: 1, key_id: indexKeyId, record_count: indexRows.length, total_bytes: indexBuf.length, rows: indexRows }, null, 2) + "\n"
);

console.log(`wrote vectors to ${OUT}`);
console.log(`  crc32c: ${crcVec.cases.length}  sha256: ${shaVec.cases.length}  rabin: ${cases.length} (valid+tampered)  index.dat: ${indexBuf.length}B / ${indexRows.length} records`);
