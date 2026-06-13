// Self-test for the Rabin-Williams signer (spec §5), plus emit a device-format
// vector so the SAME signature can be checked by the hardware-validated Z80
// verifier (dot/rabin_runner) — end-to-end portal<->device parity.
//
// Usage: tsx src/scripts/sign-selftest.ts [deviceVectorOut]
//   default deviceVectorOut = ../dot/vectors/portal_vector.bin
import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  generateKeypair,
  sign,
  verifyRaw,
  verifyBlob,
  encodeSig,
  decodeSig,
  toLE,
} from "../lib/rabin";

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("ok:", msg);
}

const blob = Buffer.from(
  "ZXPkg portal<->device parity test: the quick brown fox. 0123456789",
  "ascii"
);

console.log("generating a fresh Rabin-Williams-1024 test key (key_id=1)...");
const key = generateKeypair(1);
assert(key.n >> 1023n === 1n, "n is exactly 1024 bits");
assert(key.p % 8n === 3n, "p ≡ 3 (mod 8)");
assert(key.q % 8n === 7n, "q ≡ 7 (mod 8)");

const sig = sign(blob, key);
assert(verifyRaw(blob, sig, key.n), "raw sign/verify round-trips");

const sigBytes = encodeSig(1, sig);
assert(sigBytes.length === 130, ".sig is 130 bytes");
const dec = decodeSig(sigBytes);
assert(dec.keyId === 1 && dec.sig.e === sig.e && dec.sig.f === sig.f, ".sig encode/decode round-trips");
assert(verifyBlob(blob, sigBytes, key.n), "verify via decoded .sig bytes");

const tampered = Buffer.from(blob);
tampered[0] ^= 0x01;
assert(!verifyBlob(tampered, sigBytes, key.n), "tampered blob is REJECTED");

// --- emit a device-format vector (matches dot/vectors/rabin_sign.js) ---
//   [u8 NVEC][u16 artLen LE][32 digest BE][artifact]
//   then NVEC records: [128 n LE][128 s LE][u8 e][u8 f(0x01=+1,0xFF=-1)]
const digest = createHash("sha256").update(blob).digest();
const header = Buffer.alloc(3 + 32);
header[0] = 1; // NVEC
header.writeUInt16LE(blob.length, 1);
digest.copy(header, 3);
const record = Buffer.concat([
  toLE(key.n),
  toLE(sig.s),
  Buffer.from([sig.e, sig.f === 1 ? 0x01 : 0xff]),
]);
const out = Buffer.concat([header, blob, record]);
const outPath = process.argv[2] || "../dot/vectors/portal_vector.bin";
writeFileSync(outPath, out);
console.log(`wrote device vector ${outPath} (${out.length} bytes)`);
console.log("PORTAL SELF-TEST: PASS");
