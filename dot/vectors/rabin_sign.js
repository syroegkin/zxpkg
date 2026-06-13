// rabin_sign.js — Rabin-Williams-1024 signer; emits a verify vector for the Z80
// full-verify PoC.  No external deps (Node crypto + BigInt).
//
// Scheme (see README §): keypair n = p*q with p≡3, q≡7 (mod 8).  The signed
// message representative is the 128-byte redundant block
//     M = 6A || BC*94 || SHA256(artifact)[32] || CC      (big-endian)
// Signing finds tweaks e∈{1,2}, f∈{+1,-1} so that Mqr = f*e*M mod n is a QR,
// then s = sqrt(Mqr) mod n.  The device squares s, undoes the tweaks, and
// memcmp's against its own rebuilt M.
//
// One vector per (e,f) tweak combination (4 total) so the device's untweak
// branches all get exercised — same artifact/M, different keypairs.
//
// Output rabin_vectors.bin:
//   [0]        NVEC
//   [1..2]     artifact length (LE u16)
//   [3..34]    expected SHA-256 digest (big-endian, harness cross-check)
//   [35..]     artifact bytes (len)
//   then NVEC records, 258 bytes each:
//     n (LE 128) || s (LE 128) || e (1: 1|2) || f (1: 0x01=+1, 0xFF=-1)

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ---- big-int helpers ----
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
function egcd(a, b) {              // returns [g, x, y] with a*x + b*y = g
  if (b === 0n) return [a, 1n, 0n];
  const [g, x, y] = egcd(b, a % b);
  return [g, y, x - (a / b) * y];
}
function modInverse(a, m) {
  const [g, x] = egcd(((a % m) + m) % m, m);
  if (g !== 1n) throw new Error('no inverse');
  return ((x % m) + m) % m;
}
function jacobi(a, n) {            // Jacobi symbol (a/n), n odd > 0
  a = ((a % n) + n) % n;
  let result = 1;
  while (a !== 0n) {
    while (a % 2n === 0n) {
      a /= 2n;
      const r = n % 8n;
      if (r === 3n || r === 5n) result = -result;   // (2/n) = -1 for n≡3,5 mod 8
    }
    [a, n] = [n, a];                                 // reciprocity
    if (a % 4n === 3n && n % 4n === 3n) result = -result;
    a %= n;
  }
  return n === 1n ? result : 0;
}

// ---- Miller-Rabin (these are test keys, not production) ----
function isProbablePrime(n, rounds = 24) {
  if (n < 2n) return false;
  for (const p of [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n]) {
    if (n % p === 0n) return n === p;
  }
  let d = n - 1n, r = 0n;
  while (d % 2n === 0n) { d /= 2n; r++; }
  for (let i = 0; i < rounds; i++) {
    const a = 2n + (BigInt('0x' + crypto.randomBytes(64).toString('hex')) % (n - 3n));
    let x = modpow(a, d, n);
    if (x === 1n || x === n - 1n) continue;
    let composite = true;
    for (let j = 0n; j < r - 1n; j++) {
      x = (x * x) % n;
      if (x === n - 1n) { composite = false; break; }
    }
    if (composite) return false;
  }
  return true;
}
function randomBits(bits) {
  const x = BigInt('0x' + crypto.randomBytes(bits / 8).toString('hex'));
  return x | (1n << BigInt(bits - 1));          // force top bit set
}
// generate a `bits`-bit prime with prime ≡ residue (mod 8)
function genPrime(bits, residue) {
  while (true) {
    let p = (randomBits(bits) & ~7n) | BigInt(residue);
    for (let i = 0; i < 4096; i++) {
      if (isProbablePrime(p)) return p;
      p += 8n;                                    // keep residue mod 8
    }
  }
}

function toLE128(x) {
  const b = Buffer.alloc(128);
  for (let i = 0; i < 128; i++) { b[i] = Number(x & 0xffn); x >>= 8n; }
  return b;
}
function toBE(x, len) {
  const b = Buffer.alloc(len);
  for (let i = len - 1; i >= 0; i--) { b[i] = Number(x & 0xffn); x >>= 8n; }
  return b;
}

// ---- build the message representative from the artifact ----
function buildEM(artifact) {
  const digest = crypto.createHash('sha256').update(artifact).digest();   // 32B BE
  const em = Buffer.alloc(128);
  em[0] = 0x6a;
  em.fill(0xbc, 1, 95);                 // 94 filler bytes [1..94]
  digest.copy(em, 95);                  // hash at [95..126]
  em[127] = 0xcc;
  return { M: BigInt('0x' + em.toString('hex')), digest };
}

// ---- sign ----
function sign(M, n, p, q) {
  if (M >= n) throw new Error('M >= n (header byte too large?)');
  if (jacobi(M, n) === 0) throw new Error('gcd(M,n) != 1 (astronomically unlikely)');

  const e = jacobi(M, n) === 1 ? 1n : 2n;        // fix (·/n) to +1
  const Me = (e * M) % n;
  // is Me a QR mod p?  (it has (Me/n)=+1, so QR mod both or NQR mod both)
  const f = modpow(Me, (p - 1n) / 2n, p) === 1n ? 1n : -1n;
  const Mqr = f === 1n ? Me : (n - Me) % n;       // f=-1  <=>  *(-1) mod n

  // sqrt via CRT (p,q ≡ 3 mod 4)
  const rp = modpow(Mqr % p, (p + 1n) / 4n, p);
  const rq = modpow(Mqr % q, (q + 1n) / 4n, q);
  const qInvP = modInverse(q, p);                 // Garner CRT
  const k = ((((rp - rq) % p) * qInvP) % p + p) % p;
  const s = (rq + q * k) % n;

  // self-check: square + untweak must recover M
  let t = (s * s) % n;
  if (f === -1n) t = (n - t) % n;
  if (e === 2n) t = (t % 2n === 0n) ? t / 2n : (t + n) / 2n;   // /2 mod n
  if (t !== M) throw new Error('signer self-check failed');

  return { s, e: Number(e), f: f === 1n ? 0x01 : 0xff };
}

// ---- main ----
const ARTIFACT = Buffer.from(
  'ZXPkg test artifact: the quick brown fox jumps over the lazy dog. 0123456789',
  'ascii');

const { M, digest } = buildEM(ARTIFACT);

// Collect one vector per (e,f) combo by trying fresh keypairs.
const want = { '1,1': null, '1,255': null, '2,1': null, '2,255': null };
let tries = 0;
while (Object.values(want).some(v => v === null)) {
  tries++;
  const p = genPrime(512, 3);
  const q = genPrime(512, 7);
  const n = p * q;
  if ((n >> 1023n) !== 1n) continue;
  const { s, e, f } = sign(M, n, p, q);
  const key = `${e},${f}`;
  if (want[key] === null) {
    want[key] = { n, s, e, f };
    console.log(`  got (e=${e}, f=${f === 1 ? '+1' : '-1'}) after ${tries} keypair(s)`);
  }
}

const order = ['1,1', '1,255', '2,1', '2,255'];
const header = Buffer.alloc(35);
header[0] = order.length;
header.writeUInt16LE(ARTIFACT.length, 1);
digest.copy(header, 3);

const records = order.map(k => {
  const { n, s, e, f } = want[k];
  return Buffer.concat([toLE128(n), toLE128(s), Buffer.from([e, f])]);
});

const out = Buffer.concat([header, ARTIFACT, ...records]);
const outPath = path.join(__dirname, 'rabin_vectors.bin');
fs.writeFileSync(outPath, out);

// Also emit an sjasmplus include so the on-device tap can embed the vectors.
function dbLines(buf) {
  const lines = [];
  for (let i = 0; i < buf.length; i += 16) {
    const row = [...buf.slice(i, i + 16)].map(b => '$' + b.toString(16).padStart(2, '0'));
    lines.push('        db ' + row.join(','));
  }
  return lines.join('\n');
}
const inc = [
  '; rabin_vectors.inc.asm — GENERATED by vectors/rabin_sign.js. Do not edit by hand.',
  '; One verify vector per (e,f) tweak combo; same artifact/digest for all.',
  `RV_NVEC   equ ${order.length}`,
  `RV_ARTLEN equ ${ARTIFACT.length}`,
  `RV_RECSZ  equ 258              ; n(128) + s(128) + e(1) + f(1)`,
  '',
  'rv_artifact:',
  dbLines(ARTIFACT),
  '',
  'rv_digest:                     ; expected SHA-256 (big-endian), for display',
  dbLines(digest),
  '',
  'rv_vectors:                    ; RV_NVEC records of RV_RECSZ bytes',
  ...order.map((k, i) => {
    const { n, s, e, f } = want[k];
    return [
      `; --- vector ${i}: e=${e}, f=${f === 1 ? '+1' : '-1'} ---`,
      dbLines(toLE128(n)),       // n  (LE 128)
      dbLines(toLE128(s)),       // s  (LE 128)
      `        db $${e.toString(16).padStart(2, '0')},$${(f === 1 ? 1 : 0xff).toString(16).padStart(2, '0')}   ; e, f`,
    ].join('\n');
  }),
  '',
].join('\n');
const incPath = path.join(__dirname, 'rabin_vectors.inc.asm');
fs.writeFileSync(incPath, inc);

console.log('wrote', outPath, out.length, 'bytes');
console.log('wrote', incPath);
console.log('  vectors    :', order.length, '(e,f combos: 1+1, 1-1, 2+1, 2-1)');
console.log('  artifact   :', ARTIFACT.length, 'bytes ->',
            Math.ceil((ARTIFACT.length + 9) / 64), 'SHA blocks');
console.log('  digest     :', digest.toString('hex'));
