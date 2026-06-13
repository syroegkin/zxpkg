// Crypto-parity GATE: assert the committed spec/vectors/ agree across BOTH the
// Node reference (portal libs) AND the Z80 reference (dot harnesses).
// Exits non-zero on any mismatch — wire into CI.
//
// Coverage today:
//   CRC-32C : Node + Z80 (crc_runner).
//   SHA-256 : Node + Z80 (sha_full_runner).
//   Rabin   : Node + Z80 (rabin_runner) for non-empty blobs; empty blob Node-only.
// Usage: npm run vectors:check
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { crc32c } from "../lib/crc32c";
import { verifyBlob, fromLE } from "../lib/rabin";
import { encodeIndex, type IndexRow } from "../lib/index-format";

const VEC = resolve(process.cwd(), process.argv[2] || "../spec/vectors");
const DEV = resolve(process.cwd(), "../dot");
const load = (f: string) => JSON.parse(readFileSync(resolve(VEC, f), "utf8"));

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean): void {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}`);
  }
}

// ---- Node side ----
console.log("[node] CRC-32C");
for (const c of load("crc32c.json").cases) {
  const got = "0x" + (crc32c(Buffer.from(c.input_hex, "hex")) >>> 0).toString(16).padStart(8, "0");
  check(`crc ${c.name}`, got === c.crc32c);
}
console.log("[node] SHA-256");
for (const c of load("sha256.json").cases) {
  const got = createHash("sha256").update(Buffer.from(c.input_hex, "hex")).digest("hex");
  check(`sha ${c.name}`, got === c.sha256);
}
console.log("[node] Rabin-Williams verify");
interface RabinCase { name: string; blob_hex: string; sig_hex: string; expect: string; e?: number; f?: number; }
const rabin = load("rabin.json") as { key_id: number; n_le_hex: string; cases: RabinCase[] };
const nBig = fromLE(Buffer.from(rabin.n_le_hex, "hex"));
for (const c of rabin.cases) {
  const ok = verifyBlob(Buffer.from(c.blob_hex, "hex"), Buffer.from(c.sig_hex, "hex"), nBig);
  check(`rabin ${c.name}`, ok === (c.expect === "valid"));
}

console.log("[node] index.dat v1 encode");
{
  const idxMeta = load("index.json") as { key_id: number; rows: IndexRow[] };
  const reEncoded = encodeIndex(idxMeta.rows, idxMeta.key_id);
  const committed = readFileSync(resolve(VEC, "index.dat"));
  check("index.dat encode matches committed", reEncoded.equals(committed));
}

// ---- Z80 side (build harnesses, then drive them) ----
console.log("[z80] building harnesses...");
execFileSync(
  "make",
  ["-C", DEV, "rabin_verify.bin", "rabin_runner", "sha_full_test.bin", "sha_full_runner",
   "verify_sig.bin", "verify_sig_runner", "index_demo.bin", "index_runner",
   "crc_demo.bin", "crc_runner"],
  { stdio: "ignore" }
);

console.log("[z80] CRC-32C (crc_runner)");
for (const c of load("crc32c.json").cases) {
  try {
    execFileSync("./crc_runner", ["crc_demo.bin", c.input_hex, c.crc32c], { cwd: DEV, stdio: "pipe" });
    check(`z80 crc ${c.name}`, true);
  } catch {
    check(`z80 crc ${c.name}`, false);
  }
}

console.log("[z80] SHA-256 (sha_full_runner)");
for (const c of load("sha256.json").cases) {
  const msg = Buffer.from(c.input_hex, "hex").toString("latin1"); // all KAT inputs are <0x80
  try {
    const out = execFileSync("./sha_full_runner", ["sha_full_test.bin", msg, c.sha256], { cwd: DEV }).toString();
    check(`z80 sha ${c.name}`, /PASS/.test(out) && !/FAIL/.test(out));
  } catch {
    check(`z80 sha ${c.name}`, false);
  }
}

console.log("[z80] Rabin (rabin_runner, 1 vector/case)");
const nLE = Buffer.from(rabin.n_le_hex, "hex");
for (const c of rabin.cases.filter((c) => c.expect === "valid")) {
  const blob = Buffer.from(c.blob_hex, "hex");
  if (blob.length === 0) {
    console.log(`  skip z80 rabin ${c.name} (empty blob: harness tamper test needs >0 bytes; Node-checked)`);
    continue;
  }
  const sig = Buffer.from(c.sig_hex, "hex"); // [key_id][tweak][128 s LE]
  const sLE = sig.subarray(2);
  const e = sig[1] & 1 ? 2 : 1;
  const f = sig[1] & 2 ? 0xff : 0x01;
  const digest = createHash("sha256").update(blob).digest();
  const header = Buffer.alloc(3 + 32);
  header[0] = 1;
  header.writeUInt16LE(blob.length, 1);
  digest.copy(header, 3);
  const record = Buffer.concat([nLE, sLE, Buffer.from([e, f])]);
  const binPath = resolve(tmpdir(), `zxk-vec-${c.name}.bin`);
  writeFileSync(binPath, Buffer.concat([header, blob, record]));
  try {
    const out = execFileSync("./rabin_runner", ["rabin_verify.bin", binPath], { cwd: DEV }).toString();
    check(`z80 rabin ${c.name}`, /RESULT: PASS/.test(out)); // includes its own tamper-reject test
  } catch {
    check(`z80 rabin ${c.name}`, false);
  }
}

console.log("[z80] verify_sig (wire-format: blob + 130B .sig + 130B pubkey)");
// pubkey entry = [key_id][algo=1][n LE]
const pkHex = rabin.key_id.toString(16).padStart(2, "0") + "01" + rabin.n_le_hex;
function runVS(blobHex: string, sigHex: string): number {
  try {
    execFileSync("./verify_sig_runner", ["verify_sig.bin", blobHex, sigHex, pkHex], { cwd: DEV, stdio: "pipe" });
    return 0; // exit 0 = valid
  } catch (e) {
    return (e as { status?: number }).status ?? 2; // 1 = invalid, 2 = harness error
  }
}
for (const c of rabin.cases.filter((c) => c.expect === "valid")) {
  if (Buffer.from(c.blob_hex, "hex").length === 0) continue; // empty blob: Node-checked only
  check(`z80 verify_sig ${c.name} valid`, runVS(c.blob_hex, c.sig_hex) === 0);
  const t = Buffer.from(c.blob_hex, "hex");
  t[0] ^= 0x01;
  check(`z80 verify_sig ${c.name} tampered->reject`, runVS(t.toString("hex"), c.sig_hex) === 1);
}
// key_id mismatch must reject (use a valid case with a bumped pubkey key_id)
{
  const c = rabin.cases.find((c) => c.expect === "valid" && Buffer.from(c.blob_hex, "hex").length > 0);
  if (!c) throw new Error("no non-empty valid rabin case for key_id-mismatch test");
  const badPk = "ff01" + rabin.n_le_hex; // key_id 0xff != 1
  let code = 2;
  try {
    execFileSync("./verify_sig_runner", ["verify_sig.bin", c.blob_hex, c.sig_hex, badPk], { cwd: DEV, stdio: "pipe" });
    code = 0;
  } catch (e) {
    code = (e as { status?: number }).status ?? 2;
  }
  check("z80 verify_sig key_id-mismatch->reject", code === 1);
}

console.log("[z80] index.dat v1 decode (round-trip + reject unknown schema)");
try {
  const out = execFileSync("./index_runner", ["index_demo.bin", resolve(VEC, "index.dat")], { cwd: DEV }).toString();
  check("z80 index decode round-trips + rejects bad schema", /RESULT: PASS/.test(out));
} catch {
  check("z80 index decode round-trips + rejects bad schema", false);
}

console.log(`\nparity gate: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
