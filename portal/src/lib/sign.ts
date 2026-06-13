// Detached signatures over artifacts and index.dat.
// Rabin-Williams-1024 over SHA-256 (spec §5) — one modular squaring to verify on
// a plain Z80.  Crypto lives in ./rabin; this file only persists/loads the key
// and exposes the byte blobs the rest of the portal writes.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { env } from "./env";
import {
  generateKeypair,
  sign,
  encodeSig,
  encodePubKey,
  ALGO_RABIN_WILLIAMS_1024,
  type RabinPrivateKey,
} from "./rabin";

interface StoredPrivateKey {
  algo: number;
  keyId: number;
  n: string; // hex
  p: string; // hex
  q: string; // hex
}

let privateKey: RabinPrivateKey | null = null;

// Generate a keypair and write it to the given paths (used by ensureKeys + genkey).
export function writeKeypair(privPath: string, pubPath: string): void {
  const key = generateKeypair(env.sign.keyId);
  const stored: StoredPrivateKey = {
    algo: key.algo,
    keyId: key.keyId,
    n: key.n.toString(16),
    p: key.p.toString(16),
    q: key.q.toString(16),
  };
  const pub = { algo: key.algo, keyId: key.keyId, n: key.n.toString(16) };
  mkdirSync(dirname(privPath), { recursive: true });
  mkdirSync(dirname(pubPath), { recursive: true });
  writeFileSync(privPath, JSON.stringify(stored, null, 2), { mode: 0o600 });
  writeFileSync(pubPath, JSON.stringify(pub, null, 2));
}

// Generate the signing keypair on first use if it doesn't exist yet (no manual step).
export function ensureKeys(): void {
  if (existsSync(env.sign.privateKeyPath)) return;
  writeKeypair(env.sign.privateKeyPath, env.sign.publicKeyPath);
}

function getPrivateKey(): RabinPrivateKey {
  if (!privateKey) {
    ensureKeys();
    const s = JSON.parse(readFileSync(env.sign.privateKeyPath, "utf8")) as StoredPrivateKey;
    privateKey = { algo: s.algo, keyId: s.keyId, n: BigInt("0x" + s.n), p: BigInt("0x" + s.p), q: BigInt("0x" + s.q) };
  }
  return privateKey;
}

// Detached signature for `data`: 130 bytes [key_id][tweak][128 s LE]  (spec §5.4).
export function signBlob(data: Buffer): Buffer {
  const key = getPrivateKey();
  return encodeSig(key.keyId, sign(data, key));
}

// Public key entry for the device / /pubkey: 130 bytes [key_id][algo][128 n LE] (spec §5.6).
export function publicKeyEntry(): Buffer {
  const key = getPrivateKey();
  return encodePubKey({ algo: ALGO_RABIN_WILLIAMS_1024, keyId: key.keyId, n: key.n });
}

export const keyId = env.sign.keyId;
