// scan_verify.js — verify a device scan against the host.
// Reads <root>/SCAN.DAT (records: [u8 namelen][name][u32 crc LE] written by the
// Z80 scan), and for each, recomputes CRC-32C of <root>/DOT/<name> on the host
// and compares.  Exit 0 if every record matches every file in /DOT.
// Usage: node scan_verify.js <esxdos_root_dir>
const fs = require("fs");
const path = require("path");

// CRC-32C (Castagnoli) — same params as portal/src/lib/crc32c.ts.
const POLY = 0x82f63b78;
const table = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? POLY ^ (c >>> 1) : c >>> 1;
  table[n] = c >>> 0;
}
function crc32c(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}
const hex = (n) => (n >>> 0).toString(16).padStart(8, "0");

const root = process.argv[2] || "esxdos_root";
const dat = fs.readFileSync(path.join(root, "SCAN.DAT"));
const dotDir = path.join(root, "DOT");

// parse the device's records
const got = new Map();
let p = 0;
while (p < dat.length) {
  const nlen = dat[p++];
  const name = dat.slice(p, p + nlen).toString("latin1");
  p += nlen;
  const crc = dat.readUInt32LE(p);
  p += 4;
  got.set(name, crc);
}

let ok = true;
console.log(`device scanned ${got.size} file(s) in /DOT:`);
for (const [name, crc] of got) {
  const want = crc32c(fs.readFileSync(path.join(dotDir, name)));
  const match = want === crc;
  if (!match) ok = false;
  console.log(`  ${name.padEnd(12)} device=${hex(crc)} host=${hex(want)} ${match ? "OK" : "MISMATCH"}`);
}

// every regular file in /DOT must have been reported
for (const f of fs.readdirSync(dotDir)) {
  if (fs.statSync(path.join(dotDir, f)).isFile() && !got.has(f)) {
    console.log(`  ${f.padEnd(12)} MISSING from scan`);
    ok = false;
  }
}
console.log(ok ? "scan: PASS" : "scan: FAIL");
process.exit(ok ? 0 : 1);
