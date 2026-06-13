// gen.js — generate an RSA-1024 / e=3 test vector for the Z80 verify PoC.
// No external deps (Node crypto + BigInt). Writes vectors.bin (512 bytes):
//   [ n(128) ][ s(128) ][ exp_s3(128) ][ exp_s2(128) ]  -- all little-endian.
// The Z80 routine must reproduce exp_s3 = s^3 mod n  (and exp_s2 = s^2 mod n).
//
// We build a *real* RSA relation: pick message m < n, sign s = m^d mod n, so that
// s^3 mod n == m (since e=3). Thus exp_s3 == m -> a genuine verify round-trip.

const crypto = require('crypto');

function b64uToBig(s) {
  return BigInt('0x' + Buffer.from(s, 'base64url').toString('hex'));
}
function modpow(base, exp, mod) {
  base %= mod;
  let r = 1n;
  while (exp > 0n) {
    if (exp & 1n) r = (r * base) % mod;
    base = (base * base) % mod;
    exp >>= 1n;
  }
  return r;
}
function toLE128(x) {
  const b = Buffer.alloc(128);
  for (let i = 0; i < 128; i++) { b[i] = Number(x & 0xffn); x >>= 8n; }
  return b;
}

// RSA-1024 with public exponent 3.
const { privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 1024,
  publicExponent: 3,
});
const jwk = privateKey.export({ format: 'jwk' });
const n = b64uToBig(jwk.n);
const d = b64uToBig(jwk.d);
const e = 3n;

// message representative m < n (well below, so it's unambiguous)
const m = (BigInt('0x' + crypto.randomBytes(120).toString('hex')) % n) | 2n;

const s = modpow(m, d, n);          // "signature"
const chk = modpow(s, e, n);        // verify on host
if (chk !== m) { throw new Error('host RSA round-trip failed'); }
const s2 = (s * s) % n;             // intermediate, for debugging the Z80

const out = Buffer.concat([toLE128(n), toLE128(s), toLE128(m), toLE128(s2)]);
const path = require('path').join(__dirname, 'vectors.bin');
require('fs').writeFileSync(path, out);

console.log('wrote', path, out.length, 'bytes');
console.log('n  msB:', toLE128(n)[127].toString(16).padStart(2, '0'));
console.log('s  msB:', toLE128(s)[127].toString(16).padStart(2, '0'));
console.log('exp_s3 (=m) lsB:', toLE128(m)[0].toString(16).padStart(2, '0'));
