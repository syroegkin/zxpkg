// gen-install-artifact.ts — stage a (large) signed artifact for the device
// `install` test.  Signs a deterministic artifact with the committed TEST key
// (spec/vectors/testkey.json) and writes <root>/CACHE/ART + /CACHE/ART.SIG.
// The matching pubkey.bin (from the same key's modulus) is embedded in the .pkg.
// Usage: tsx src/scripts/gen-install-artifact.ts <esxdos_root> [size]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { sign, encodeSig, type RabinPrivateKey } from "../lib/rabin";

const root = process.argv[2];
if (!root) { console.error("usage: gen-install-artifact.ts <root> [size]"); process.exit(2); }
const size = Number(process.argv[3] || 1234);

const tk = JSON.parse(readFileSync(resolve("../spec/vectors/testkey.json"), "utf8"));
const key: RabinPrivateKey = {
  algo: tk.algo, keyId: tk.key_id,
  n: BigInt("0x" + tk.n), p: BigInt("0x" + tk.p), q: BigInt("0x" + tk.q),
};

const art = Buffer.alloc(size);
for (let i = 0; i < size; i++) art[i] = (i * 31 + 7) & 0xff; // deterministic
const sigBytes = encodeSig(key.keyId, sign(art, key));

mkdirSync(join(root, "ZXPKG", "CACHE"), { recursive: true });
writeFileSync(join(root, "ZXPKG", "CACHE", "ART"), art);
writeFileSync(join(root, "ZXPKG", "CACHE", "ART.SIG"), sigBytes);
console.log(`staged ${size}-byte artifact + 130-byte .sig in ${root}/ZXPKG/CACHE`);
