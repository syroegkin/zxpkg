// Rabin-Williams-1024 signatures — the ZXPkg authenticity scheme (spec §5).
// Pure crypto (no fs/env): keypair gen, message representative, sign, verify,
// and the on-wire byte encoders.  This is the portal-side counterpart of the
// hardware-validated device verifier (dot/) and a TS port of the PoC
// signer dot/vectors/rabin_sign.js.
//
// Scheme: n = p*q (1024-bit), p ≡ 3 (mod 8), q ≡ 7 (mod 8).  The signed
// representative is  M = 6A | BC*94 | SHA-256(blob)[32] | CC  (big-endian, 128
// bytes).  Signing finds tweaks e∈{1,2}, f∈{+1,-1} so that f*e*M mod n is a
// quadratic residue, then s = sqrt(...) mod n.  Verify squares s, undoes the
// tweaks, and checks the rebuilt M.  See plans/01-spec.md §5.
import { createHash, randomBytes } from "node:crypto";

export const NLEN = 128; // modulus / signature width in bytes (1024 bits)
export const ALGO_RABIN_WILLIAMS_1024 = 1;

export interface RabinPrivateKey {
  algo: number; // 1
  keyId: number;
  n: bigint;
  p: bigint;
  q: bigint;
}
export interface RabinPublicKey {
  algo: number; // 1
  keyId: number;
  n: bigint;
}
export interface Signature {
  s: bigint;
  e: 1 | 2;
  f: 1 | -1;
}

// ---- bigint helpers ----
function modpow(base: bigint, exp: bigint, mod: bigint): bigint {
  base %= mod;
  let r = 1n;
  while (exp > 0n) {
    if (exp & 1n) r = (r * base) % mod;
    base = (base * base) % mod;
    exp >>= 1n;
  }
  return r;
}
function egcd(a: bigint, b: bigint): [bigint, bigint, bigint] {
  if (b === 0n) return [a, 1n, 0n];
  const [g, x, y] = egcd(b, a % b);
  return [g, y, x - (a / b) * y];
}
function modInverse(a: bigint, m: bigint): bigint {
  const [g, x] = egcd(((a % m) + m) % m, m);
  if (g !== 1n) throw new Error("no modular inverse");
  return ((x % m) + m) % m;
}
function jacobi(a: bigint, n: bigint): number {
  a = ((a % n) + n) % n;
  let result = 1;
  while (a !== 0n) {
    while (a % 2n === 0n) {
      a /= 2n;
      const r = n % 8n;
      if (r === 3n || r === 5n) result = -result; // (2/n) = -1 for n≡3,5 mod 8
    }
    [a, n] = [n, a]; // reciprocity
    if (a % 4n === 3n && n % 4n === 3n) result = -result;
    a %= n;
  }
  return n === 1n ? result : 0;
}

// ---- Miller-Rabin (test keys; not constant-time, but these are signing keys) ----
function isProbablePrime(n: bigint, rounds = 24): boolean {
  if (n < 2n) return false;
  for (const p of [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n]) {
    if (n % p === 0n) return n === p;
  }
  let d = n - 1n;
  let r = 0n;
  while (d % 2n === 0n) {
    d /= 2n;
    r++;
  }
  for (let i = 0; i < rounds; i++) {
    const a = 2n + (BigInt("0x" + randomBytes(64).toString("hex")) % (n - 3n));
    let x = modpow(a, d, n);
    if (x === 1n || x === n - 1n) continue;
    let composite = true;
    for (let j = 0n; j < r - 1n; j++) {
      x = (x * x) % n;
      if (x === n - 1n) {
        composite = false;
        break;
      }
    }
    if (composite) return false;
  }
  return true;
}
function randomBits(bits: number): bigint {
  const x = BigInt("0x" + randomBytes(bits / 8).toString("hex"));
  return x | (1n << BigInt(bits - 1)); // force the top bit set
}
// generate a `bits`-bit prime ≡ residue (mod 8)
function genPrime(bits: number, residue: number): bigint {
  for (;;) {
    let p = (randomBits(bits) & ~7n) | BigInt(residue);
    for (let i = 0; i < 8192; i++) {
      if (isProbablePrime(p)) return p;
      p += 8n; // preserve residue mod 8
    }
  }
}

// ---- little-endian byte <-> bigint ----
export function toLE(x: bigint, len = NLEN): Buffer {
  const b = Buffer.alloc(len);
  for (let i = 0; i < len; i++) {
    b[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return b;
}
export function fromLE(buf: Buffer): bigint {
  let x = 0n;
  for (let i = buf.length - 1; i >= 0; i--) x = (x << 8n) | BigInt(buf[i]);
  return x;
}

// ---- message representative: M = 6A | BC*94 | SHA-256(blob) | CC (big-endian) ----
export function buildEM(blob: Buffer): { M: bigint; digest: Buffer } {
  const digest = createHash("sha256").update(blob).digest(); // 32 bytes, big-endian
  const em = Buffer.alloc(NLEN);
  em[0] = 0x6a; // header (< 0x80 => M < n)
  em.fill(0xbc, 1, 95); // 94 filler bytes [1..94]
  digest.copy(em, 95); // hash at [95..126]
  em[127] = 0xcc; // trailer
  return { M: BigInt("0x" + em.toString("hex")), digest };
}

// ---- keypair ----
export function generateKeypair(keyId: number): RabinPrivateKey {
  for (;;) {
    const p = genPrime(512, 3); // p ≡ 3 (mod 8)
    const q = genPrime(512, 7); // q ≡ 7 (mod 8)
    const n = p * q;
    if (n >> 1023n !== 1n) continue; // ensure exactly 1024 bits
    return { algo: ALGO_RABIN_WILLIAMS_1024, keyId, n, p, q };
  }
}

// ---- sign ----
export function sign(blob: Buffer, key: RabinPrivateKey): Signature {
  const { n, p, q } = key;
  const { M } = buildEM(blob);
  if (M >= n) throw new Error("M >= n (header byte too large?)");
  const j = jacobi(M, n);
  if (j === 0) throw new Error("gcd(M,n) != 1 (astronomically unlikely)");

  const e: 1 | 2 = j === 1 ? 1 : 2; // fix Jacobi (·/n) to +1
  const Me = (BigInt(e) * M) % n;
  // Me has (Me/n)=+1, so it is a QR mod both primes or NQR mod both.
  const f: 1 | -1 = modpow(Me, (p - 1n) / 2n, p) === 1n ? 1 : -1;
  const Mqr = f === 1 ? Me : (n - Me) % n;

  // sqrt via CRT (p,q ≡ 3 mod 4); Garner combination
  const rp = modpow(Mqr % p, (p + 1n) / 4n, p);
  const rq = modpow(Mqr % q, (q + 1n) / 4n, q);
  const qInvP = modInverse(q, p);
  const k = ((((rp - rq) % p) * qInvP) % p + p) % p;
  const s = (rq + q * k) % n;

  // self-check: square + untweak must recover M
  let t = (s * s) % n;
  if (f === -1) t = (n - t) % n;
  if (e === 2) t = t % 2n === 0n ? t / 2n : (t + n) / 2n;
  if (t !== M) throw new Error("signer self-check failed");

  return { s, e, f };
}

// ---- verify (mirrors the device) ----
export function verifyRaw(blob: Buffer, sig: Signature, n: bigint): boolean {
  let t = (sig.s * sig.s) % n;
  if (sig.f === -1) t = (n - t) % n;
  if (sig.e === 2) t = t % 2n === 0n ? t / 2n : (t + n) / 2n;
  const { M } = buildEM(blob);
  return t === M;
}

// ---- on-wire encoders (spec §5.4 / §5.6) ----
// Detached signature: [u8 key_id][u8 tweak][128 s LE]   (130 bytes)
//   tweak bit0: e (0=>e1, 1=>e2) ; bit1: f (0=>+1, 1=>-1)
export function encodeSig(keyId: number, sig: Signature): Buffer {
  const tweak = (sig.e === 2 ? 1 : 0) | (sig.f === -1 ? 2 : 0);
  return Buffer.concat([Buffer.from([keyId & 0xff, tweak & 0xff]), toLE(sig.s)]);
}
export function decodeSig(buf: Buffer): { keyId: number; sig: Signature } {
  if (buf.length !== 2 + NLEN) throw new Error(`bad .sig length ${buf.length}`);
  const keyId = buf[0];
  const tweak = buf[1];
  const e: 1 | 2 = tweak & 1 ? 2 : 1;
  const f: 1 | -1 = tweak & 2 ? -1 : 1;
  return { keyId, sig: { s: fromLE(buf.subarray(2)), e, f } };
}
// Public key entry: [u8 key_id][u8 algo][128 n LE]   (130 bytes)
export function encodePubKey(pub: RabinPublicKey): Buffer {
  return Buffer.concat([Buffer.from([pub.keyId & 0xff, pub.algo & 0xff]), toLE(pub.n)]);
}

// Convenience: verify a detached .sig buffer against a blob and modulus.
export function verifyBlob(blob: Buffer, sigBuf: Buffer, n: bigint): boolean {
  return verifyRaw(blob, decodeSig(sigBuf).sig, n);
}
