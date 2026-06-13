// make-pubkey.js <public-key.json> — write pubkey.bin, the device's embedded trust
// anchor: [u8 key_id][u8 algo=1][128-byte modulus n, little-endian].
//
// Accepts either:
//   - the test vector  ({ key_id, n_le_hex })           — n already little-endian
//   - the production public.json ({ keyId, n })          — n is big-endian hex
//     (sign.ts writes n = key.n.toString(16), big-endian, unpadded)
//
// Build the device against the LIVE registry key with:
//   rm -f dot/pubkey.bin && make -C dot pkg-inst PUBKEY_SRC=/path/to/data/keys/public.json
const fs = require("fs");

const src = process.argv[2] || "../spec/vectors/rabin.json";
const v = JSON.parse(fs.readFileSync(src, "utf8"));

const kid = v.key_id ?? v.keyId;
if (kid == null) throw new Error(`${src}: no key_id / keyId`);

let le;
if (v.n_le_hex) {
  le = Buffer.from(v.n_le_hex, "hex"); // already little-endian
} else if (v.n) {
  const be = BigInt("0x" + v.n).toString(16).padStart(256, "0"); // 128 bytes, big-endian
  le = Buffer.from(be, "hex").reverse(); // -> little-endian
} else {
  throw new Error(`${src}: no n_le_hex / n modulus field`);
}
if (le.length !== 128) throw new Error(`${src}: modulus is ${le.length} bytes, expected 128`);

fs.writeFileSync("pubkey.bin", Buffer.concat([Buffer.from([kid, 1]), le]));
console.error(`pubkey.bin <- ${src} (key_id=${kid})`);
