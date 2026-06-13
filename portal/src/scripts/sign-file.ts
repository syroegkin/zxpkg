// sign-file.ts — sign an existing file with the committed TEST key
// (spec/vectors/testkey.json) and write its 130-byte detached .sig.
// Used to stage a signed index.dat for the device `update` test.
// Usage: tsx src/scripts/sign-file.ts <infile> <outsig>
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { sign, encodeSig, type RabinPrivateKey } from "../lib/rabin";

const infile = process.argv[2];
const outsig = process.argv[3];
if (!infile || !outsig) { console.error("usage: sign-file.ts <infile> <outsig>"); process.exit(2); }

const tk = JSON.parse(readFileSync(resolve("../spec/vectors/testkey.json"), "utf8"));
const key: RabinPrivateKey = {
  algo: tk.algo, keyId: tk.key_id,
  n: BigInt("0x" + tk.n), p: BigInt("0x" + tk.p), q: BigInt("0x" + tk.q),
};

writeFileSync(outsig, encodeSig(key.keyId, sign(readFileSync(infile), key)));
console.log(`signed ${infile} -> ${outsig}`);
