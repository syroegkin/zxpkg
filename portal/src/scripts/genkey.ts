// Generate the Rabin-Williams-1024 signing keypair used to sign artifacts and
// index.dat (spec §5).  Refuses to overwrite an existing private key.
// Usage:
//   npm run genkey                 # -> env paths (default ./keys/{private,public}.json)
//   npm run genkey -- /data/keys   # -> <dir>/{private,public}.json  (e.g. Docker volume)
import { existsSync } from "node:fs";
import { join } from "node:path";
import { env } from "../lib/env";
import { writeKeypair } from "../lib/sign";

const dir = process.argv[2];
const privPath = dir ? join(dir, "private.json") : env.sign.privateKeyPath;
const pubPath = dir ? join(dir, "public.json") : env.sign.publicKeyPath;

if (existsSync(privPath)) {
  console.error(`Refusing to overwrite existing key: ${privPath}`);
  process.exit(1);
}
writeKeypair(privPath, pubPath);
console.log(`Wrote ${privPath} and ${pubPath} (Rabin-Williams-1024, key_id=${env.sign.keyId}).`);
