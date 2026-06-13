# ZXPkg device-crypto proof of concept (`dot/`)

This directory de-risks the hardest unknown in the ZXPkg device step (Step 3a, the
"crypto-parity gate"): **can a stock ZX Spectrum verify a portal signature in a usable
time?** It contains working, measured Z80 implementations of the three primitives a device
needs, plus a cycle-accurate test harness and an on-Spectrum timing demo.

Everything here is a **proof of concept / benchmark**, written for correctness and clarity
first. It is the reference the real `dot/` implementation will be built from. The asm is
heavily commented; this README is the companion that explains the *why* and the non-obvious
tricks so the code can be reviewed line by line.

---

## Table of contents
1. [Results (validated)](#1-results-validated)
2. [Crypto design & rationale](#2-crypto-design--rationale)
3. [Build & run (Makefile)](#3-build--run-makefile)
4. [Files](#4-files)
5. [Conventions used throughout the asm](#5-conventions-used-throughout-the-asm)
6. [`rsa_verify.asm` walkthrough](#6-rsa_verifyasm-walkthrough)
7. [`sha256.asm` / `sha_zx.asm` walkthrough](#7-sha256asm--sha_zxasm-walkthrough)
8. [Full Rabin-Williams verify pipeline](#8-full-rabin-williams-verify-pipeline)
9. [The test harness](#9-the-test-harness)
10. [Real-hardware validation](#10-real-hardware-validation)
11. [Optimization headroom](#11-optimization-headroom)
12. [References](#12-references)

---

## 1. Results (validated)

All times are for a **stock Z80 @ 3.5 MHz** (the gating baseline) and the **Next @ 28 MHz**.
T-states measured in a cycle-accurate emulator; cross-checked against real 48K hardware
(§9, within ~3%).

**Signature verify (modular exponentiation), the optimization journey:**

| Stage | T-states | stock @3.5 MHz | Next @28 MHz |
|---|---|---|---|
| RSA-1024 e=3, naïve (schoolbook × shift-subtract) | 46.0M | 13.2 s | 1.65 s |
| + Comba / quarter-square multiply | 36.9M | 10.5 s | 1.32 s |
| → **Rabin** (`s² mod n`, same security as RSA-1024) | 18.5M | 5.3 s | 0.66 s |
| + **Knuth Algorithm D** reduction | **13.6M** | **3.9 s** | **0.49 s** |

Net **3.4×**. Correct across 8/8 fresh random keys (both Rabin `s²` and RSA `s³`).

**SHA-256** (`sha_core.inc.asm`; verified against official vectors — `make sha-kat`):

| | per 64-byte block | @3.5 MHz | @28 MHz |
|---|---|---|---|
| naïve (first cut) | ~828K T | 0.237 s/block | 0.0296 s/block |
| **optimised** | **~593K T** | **0.169 s/block** | **0.0212 s/block** |

Optimisation (**1.40×**, see §7): shortest-direction rotations, `DE`/`HL`-pointer word ops,
and inlined rotate/shift (no `call`/`ret`). Correctness held across all known-answer tests.

**Full verify = `SHA-256(artifact)` + the 13.6M modmul** (a signature signs the hash, so the
device must hash the whole artifact), with the optimised SHA. The complete Rabin-Williams
pipeline (hash → `s²` → untweak → redundancy check) is **implemented and validated end-to-end** —
all four `(e,f)` tweak combos verify and a tampered artifact is rejected (§8, `make rabin`):

| Artifact | SHA blocks | Stock @3.5 MHz | Next @28 MHz |
|---|---|---|---|
| 512 B | 9 | ~5.4 s | ~0.7 s |
| 1 KB | 17 | ~6.8 s | ~0.9 s |
| 2 KB | 33 | ~9.5 s | ~1.2 s |
| 4 KB | 65 | ~14.9 s | ~1.9 s |
| 8 KB | 129 | ~25.7 s | ~3.2 s |

> **Key finding.** On stock hardware **SHA-256 of the artifact dominates** — past ~1 KB the
> modmul is the minority cost. The spec's verify budget should be stated **per-KB**. Further
> SHA gains (a→h unroll) are possible but hurt readability; the Next is comfortable as-is.

---

## 2. Crypto design & rationale

The device only ever **verifies**; the portal signs. So the cost is whatever the verify
primitive costs on a Z80.

- **Identity / integrity = CRC-32C** (fast, not a trust anchor) — see overview §2a.
- **Authenticity = a public-key signature over `SHA-256(blob)`.** Two choices were measured:
  - **RSA-1024, e=3:** verify is `s³ mod n` = two modular multiplications.
  - **Rabin:** verify is `s² mod n` = **one** modmul — *half the work, identical
    factoring-based security* to RSA-1024. **Chosen.** The device side is square-and-compare;
    the portal uses the non-standard Rabin-**Williams** signer (2 tweak bits) with a redundant,
    non-PKCS#1 padding. The full scheme and the on-device pipeline are walked through in **§8**.
  - **Hash-based (Lamport/Merkle) was rejected:** despite "no bignum", verify needs *hundreds*
    of SHA-256 invocations (each ~0.24 s here) plus multi-KB signatures and a stateful signer —
    on a Z80 that is **not** faster than Rabin.
- **Reduction = Knuth Algorithm D (base-256 long division), not Barrett.** Barrett needs a
  near-full multiply for `q1·μ` (~9M T for our sizes); Algorithm D is a byte-wise divide
  (~7–8M T) with no precomputed constant. The RSA modulus is always exactly 1024 bits, so its
  top byte ≥ 0x80 — i.e. **already normalized**, which is exactly the precondition Algorithm D
  needs for an accurate quotient estimate. No pre-scaling required.
- **Multiply = Comba (product scanning) + quarter-square 8×8 table.** See §6.

The numbers (§1) are what drive the architecture: stock machines can verify small dot
commands (a few KB) in seconds; large artifacts are SHA-bound and better suited to the Next or
a PC-assisted install.

---

## 3. Build & run (Makefile)

The toolchain lives in the repo at `../../.toolchain/` (git-ignored; built from source):
`sjasmplus`, `ZEsarUX` (headless), and the genuine 48K ROM at `.toolchain/roms/48.rom`.

| Command | Effect |
|---|---|
| `make rsa` | assemble `rsa_verify.asm`, run it in the cycle-accurate harness, check vs host vectors |
| `make sha` | assemble `sha256.asm`, run it, check `SHA-256("abc")` |
| `make bench` | SHA-256 marginal per-block timing (nrep=10) |
| `make sha-kat` | **SHA-256 known-answer tests** in the sim (empty/abc/56/64/120-byte; expected from python hashlib) |
| `make rabin` | **full Rabin-Williams verify**: 4 `(e,f)` vectors + tamper test, cycle-accurate |
| `make rabin-vec` | (re)generate the Rabin verify vectors (`.bin` + `.inc.asm`) via the Node signer |
| `make tap` | build `sha_zx.tap` (timing demo) |
| `make test-tap` | build `sha_test.tap` (**on-device known-answer test**) |
| `make rabin-tap` | build `rabin_zx.tap` (**on-device full verify**: OK/BAD + timing) |
| `make fuse` | build + launch `sha_zx.tap` (timing) in Fuse (`--machine 48 --rom-48 …/48.rom --auto-load`) |
| `make fuse-test` | build + launch `sha_test.tap` (correctness) in Fuse |
| `make fuse-rabin` | build + launch `rabin_zx.tap` (full verify) in Fuse |
| `make zesarux` | same in ZEsarUX with our ROM (best-effort; no-SDL build) |
| `make clean` / `make help` | — |

`z80.h` (floooh's emulator) and `vectors/vectors.bin` are fetched/generated automatically.
Requires `gcc` and `node` on the host.

---

## 4. Files

| File | Role |
|---|---|
| **`bn_core.inc.asm`** | **Shared bignum core**: `mul_bn` (Comba + quarter-square) + `mod_bn` (Knuth Alg. D) + the `qsq` table. Buffer addresses supplied by the includer |
| `rsa_verify.asm` | Modmul benchmark front-end: `s² mod n` (Rabin) and `s³ mod n` (RSA) via `bn_core.inc.asm` |
| **`rabin_core.inc.asm`** | **Full verify** `rabin_verify` (SHA + `s²` + untweak + redundancy check) + helpers + the shared buffer/scalar EQUs |
| `rabin_verify.asm` | Raw front-end for the cycle-accurate harness (→ `rabin_verify.bin`) |
| `rabin_zx.asm` | On-device front-end → `rabin_zx.tap` (per-vector OK/BAD, self-timed, tamper test) |
| `rabin_runner.c` | Cycle-accurate full-verify harness (4 `(e,f)` vectors + tamper) |
| `vectors/rabin_sign.js` | Rabin-Williams signer (Node BigInt): emits `vectors/rabin_vectors.{bin,inc.asm}`, self-checking |
| **`sha_core.inc.asm`** | **Shared SHA-256 core** (macros, `sha_block`, `sha_full` pad+multiblock, `sha_digest`) — included by all SHA builds |
| `sha256.asm` | Per-block benchmark front-end (→ `sha256.bin`, harness-driven) |
| `sha_zx.asm` | Timing demo front-end → `sha_zx.tap` (prints digest, self-times) |
| `sha_test.asm` | **Known-answer test** front-end → `sha_test.tap` (prints OK/BAD per vector) |
| `sha_full_test.asm` | Raw `sha_full` harness for sim KAT validation (→ `sha_full_test.bin`) |
| `sha_test_vectors.inc.asm` | Generated embedded vectors (name, message, expected digest) |
| `runner.c` / `sha_runner.c` / `sha_full_runner.c` | Cycle-accurate harnesses (T-states + result checks) |
| `vectors/gen.js` | Generates RSA-1024/e=3 test vectors (Node, no deps) |
| `z80.h` | floooh's cycle-stepped Z80 emulator (fetched; git-ignored) |
| `Makefile`, `build.sh` | Build/run drivers |

All SHA front-ends share `sha_core.inc.asm` (one core to review). Generated artifacts (`*.bin`,
`*.tap`, compiled `*_runner`, `vectors/vectors.bin`) are git-ignored; the tracked sources are
the `.asm`/`.inc.asm`, `.c`, `Makefile`, `gen.js`, and this README.

---

## 5. Conventions used throughout the asm

- **Big integers are little-endian byte arrays** (least-significant byte first). This matches
  the Z80's natural add/subtract direction (process from the LSB with the carry flag) and the
  `index.dat` format's little-endian fields.
- **32-bit words (SHA-256) are also stored little-endian** (4 bytes, LSB first). SHA's spec is
  big-endian, so input/output are byte-reversed at the boundaries only.
- **No `ADD A,(nnnn)` exists on the Z80** — only `ADD A,(HL)` / `(IX+d)` / `r` / `n`. So 32-bit
  memory-to-memory ops load the source byte via a register first (`ld a,(src); ld c,a; ld
  a,(dst); adc a,c; ld (dst),a`). This pattern recurs in the SHA macros.
- **`INC rr` / `DEC rr` (16-bit) and `DJNZ` do not affect flags** — used deliberately to keep a
  carry alive across a multi-byte add/subtract loop (see `add32p`, `addback`).
- **`IY` is never used** by the bignum/SHA cores — it must stay `$5C3A` for the 48K ROM's
  interrupt handler and `RST $10` (and for esxDOS). Where a second array pointer is needed
  alongside `IX`, it lives in the **shadow `HL`** register, accessed via `EXX`. `EXX` swaps only
  `BC/DE/HL` (not `AF`) and does not affect flags, so a byte read `exx : ld a,(hl) : … : exx`
  carries both the value (in `A`) and the flags back out. This makes the cores interrupt-safe
  (the ROM ISR preserves the active main bank and never touches `IX` or the inactive bank). See §8.
- The harness loads code at **`$8000`** and runs it via a `JP $8000` placed at the reset
  vector; buffers live at `$9000`/`$A000` (plain RAM, supplied/read by the harness).

---

## 6. `rsa_verify.asm` walkthrough

### Memory map
```
$9000 n[128]       modulus (LE)         $A000 res_s3[128]  output s^3 mod n
$9080 s[128]       signature (LE)       $A080 res_s2[128]  output s^2 mod n
$9100 exp_s3[128]  host s^3 mod n       $A100 P[257]       product / dividend (P[256]=virtual 0)
$9180 exp_s2[128]  host s^2 mod n       $A210 rmd[128]     remainder
                                        $A300 t_buf[128]   s^2 held for the s^3 step
$A400.. scalar working variables (mul_a, mul_b, qhat, vtop, counters, borrow/carry flags)
```

### `main`
Computes `s² mod n → res_s2` (this *is* the Rabin verify core), copies it to `t_buf`, then
`t_buf·s mod n → res_s3` (the second half of an RSA e=3 verify). Computing both exercises the
reduction on two different inputs. For Rabin only the first half is needed.

### `mul_bn` — 128×128→256 multiply, Comba (product scanning)
Instead of operand-scanning (which re-reads/writes each `P[i+j]`), Comba walks **output
columns** `k = 0..255` and, for each, sums every `a[i]·b[j]` with `i+j=k` into a 24-bit
accumulator, then emits one product byte and shifts the accumulator down 8 bits.

- Accumulator is **`acc2(mem) : B : C`** (24 bits). A column sum of ≤128 partial products of
  ≤65025 fits in 24 bits.
- `pa = IX` walks `a` upward; `pb` walks `b` downward along the diagonal and lives in the
  **shadow `HL`** register (reached via `EXX`), so `IY` is left free for the ROM (see §8). Each
  `b` access is `exx : … (hl) … : exx` — the byte goes into `A`, which `EXX` does not swap.
- The per-column run length is computed without min/max branches: for `k ≤ 127` it is `k+1`
  (start `a[0]·b[k]`); for `k ≥ 128` it is `255-k` (start `a[k-127]·b[127]`).

**The 8×8 multiply uses the quarter-square identity:**
```
a·b = floor((a+b)²/4) − floor((a−b)²/4) = qsq[a+b] − qsq[|a−b|]
```
This is exact for integers because `a+b` and `a−b` have the same parity, so the two floors
differ by exactly `a·b`. `qsq[x] = floor(x²/4)` for `x = 0..510` is a 1022-byte table of 16-bit
LE entries, **generated at assembly time** with `DUP/EDUP`. Each lookup is `qsq + 2·index`
(the `add hl,hl` doubles the index because entries are 2 bytes).

### `mod_bn` — reduction, Knuth Algorithm D (base 256)
Reduces `P` (256 bytes, plus a virtual zero digit `P[256]`) modulo `n` (128 bytes). Because the
modulus is normalized (top byte ≥ 0x80), the classic schoolbook long division applies with the
simple 2-digit quotient estimate. For each quotient position `j = 128 … 0`:

1. **Estimate** `q̂ = min( (U[j+128]·256 + U[j+127]) / n[127], 255 )` — `div16_8`.
2. **Multiply-subtract** the 129-digit window: `U[j..j+128] -= q̂ · n` — `mulsub`.
3. **Correct**: if that underflowed (borrow out of the top), `addback` adds `n` until it no
   longer does. Knuth's bound guarantees `q ≤ q̂ ≤ q+2` for a normalized divisor, so at most
   two add-backs. We discard `q̂` (we only want the remainder).

After all positions, `U[0..127]` is the remainder; it is copied to `rmd`.

The **virtual top digit** `P[256]=0` (zeroed at entry) is why `P` is 257 bytes: the window for
`j=128` reaches `U[256]`. `$A200` is aliased with the start of `rmd`, which is fine because
`rmd` is only written at the very end.

#### `div16_8` — 16/8 quotient estimate
Returns `min(HL / C, 255)`. First caps: if `H ≥ C` the quotient is ≥ 256 → return 255 (covers
Knuth's "`U[j+L] == n[127]`" case). Otherwise an 8-iteration restoring division, handling the
9th remainder bit via the carry flag.

#### `mulsub` — window `-= q̂ · n`
The hot loop (`128 × 129 ≈ 16.5K` iterations per s²). Per digit it computes `q̂·n[i]`
(quarter-square again, inlined), adds the running multiply-carry, then subtracts the low byte and
the incoming subtract-borrow from the window digit. The `n` pointer walks up in **shadow `HL`**
(`EXX`), so `IX` is free for the window and `IY` is untouched (see §8). The multiply-carry `mc`
and subtract-borrow `bw` live in memory (`ms_mc`/`ms_bw`) so `BC` stays free; `C` holds
`low(product)+mc` for the iteration.

> **Subtle bit (was the first bug):** a digit must subtract *two* things — the partial-product
> low byte and the incoming borrow — but produce *one* outgoing borrow. Chaining `sub` then
> `sbc a,…` would subtract the first borrow twice. The fix folds the incoming borrow into the
> carry flag with `ld a,(ms_bw) : rrca` (puts bit0 → carry) and then a single `sbc a,c`. The same
> pattern handles the final top digit (`- mc - bw`).

#### `addback` — window `+= n` (correction)
Adds `n` to the window with a carry chain (`adc a,(hl)` looped with `djnz`, both `inc rr` and
`djnz` preserving the carry), then `U[j+128] += carry`. The `n` pointer is in shadow `HL`
(`EXX`), `IX` is the window, `B` is the `djnz` counter — so the shadow pointer is only touched
inside balanced `EXX` pairs. The carry out of the top digit signals that the over-subtraction is
now corrected; `mod_bn` loops add-back while it is not.

---

## 7. SHA-256 walkthrough (`sha_core.inc.asm` + front-ends)

The SHA-256 core lives once in **`sha_core.inc.asm`** and is `INCLUDE`d by every SHA build
(`sha256.asm` benchmark, `sha_zx.asm` timing, `sha_test.asm` KAT, `sha_full_test.asm` sim
harness). One core to review; the front-ends are thin.

### 32-bit word macros (pointer-based)
`MOV32/XOR32/AND32/ADD32 dst,src` operate on 4-byte LE words via incrementing pointers:
`ld de,dst : ld hl,src`, then `ld a,(de) : xor (hl) : ld (de),a : inc de : inc hl` per byte
(7T accesses, `xor (hl)`/`adc a,(hl)` directly). `MOV32` uses four `ldi`s. `ADD32` keeps the
carry across bytes because `inc de`/`inc hl` don't touch flags. (This replaced an earlier
constant-address "load-through-C" form — ~20% faster per op.)

### Rotations — byte-aligned + shortest-direction residual (inlined)
A 32-bit `ROTR n` is split at assembly time into a **byte rotation to the nearest multiple of
8** (`round(n/8)`, free — read the bytes in rotated order) plus a small **signed** residual.
Since `ROTR n == ROTL (32−n)`, the residual is rotated in whichever direction is shorter, so
`|residual| ≤ 4` instead of up to 7 — e.g. `ROTR22` → `ROTR24`(reindex)+`ROTL2`. That cuts
Σ0+Σ1 from 23 single-bit steps per round to 13. The single-bit rotates are **inlined**
(`rr (hl)`/`rl (hl)` chains, no `call`/`ret`); `SHRC` is the logical-shift analogue (`srl`).

`SUM0/SUM1` are Σ0/Σ1; `SIG0/SIG1` are σ0/σ1 — each two `ROTRC`s and a third `ROTRC`/`SHRC`
XOR-folded together, using a dedicated scratch word `sgt`. Together these three changes
(direction, pointers, inlining) make the block **1.40×** faster (828K→593K T) with identical
output.

### `sha_block` — one 64-byte block
1. **Load `W[0..15]`**: the block's 16 big-endian words, byte-reversed into LE storage.
2. **Expand `W[16..63]`**: `W[t] = σ1(W[t-2]) + W[t-7] + σ0(W[t-15]) + W[t-16]`. The σ
   functions need runtime-addressed inputs, so each input word is copied to `xbuf` and the
   constant-address σ macro runs on it; results are folded in with the pointer ops
   `mov32p`/`add32p` (`(DE) op= (HL)`).
3. **64 rounds**: `a..h` live at fixed addresses, so Σ/Ch/Σ0/Maj all use the constant-address
   macros; only `K[t]` and `W[t]` are runtime (added with `add32p`). `Ch` and `Maj` use the
   cheap forms `Ch = g ^ (e & (f^g))`, `Maj = (a&b) ^ (c & (a^b))`.
4. `H[0..7] += a..h`.

`K[64]` and the IV are emitted as `dd` (32-bit LE) constants, matching the LE storage.

> **Assembler note:** the macro-expanded `sch_lp`/`rnd_lp` bodies exceed 127 bytes, so the
> loop-back branches are `jp`, not `jr` (sjasmplus errors "JR target out of range" otherwise).

### `sha_full` — padding + multi-block
`sha_full` hashes `msgbuf[0..msglen-1]` (≤180 B): it copies the message to `padbuf`, appends
the `0x80` bit, zero-fills, writes the 64-bit big-endian bit-length into the last 8 bytes,
then runs `sha_block` over each 64-byte block (`blkptr` stepping by 64). `nblocks =
(len+72)>>6`. This is what the known-answer tests drive.

### Correctness testing
Three layers, all green:
- `make sha-kat` — runs `sha_full` in the cycle-accurate sim over **empty, "abc", 56-byte,
  64×'a', 120×'a'** (1-block, 2-block, block-boundary, and padding edges), comparing to digests
  computed by python `hashlib`.
- `sha_test.tap` (`make fuse-test`) — the **same vectors embedded**, run on real hardware /
  Fuse, printing `name: OK/BAD` per vector. Slow but thorough; this is the on-device proof.
- `sha_zx.tap` — prints `SHA-256("abc")` for a quick visual check during the timing demo.

### `sha_zx.asm` front-end (→ `sha_zx.tap`)
On top of the core: open channel 2 (`ld a,2 : call $1601`), print via `RST $10`, build the
padded `"abc"` block, hash one block and print the digest (`abc:`, verify against
`ba7816bf…f20015ad`), then **self-time** `NBLK=64` blocks (~4 KB; expect **~542 frames ≈
10.8 s** with the optimised core) and print both the timing and the **resulting digest of the
timed run** (`res:`, cross-checkable via `./sha_runner sha256.bin 64`).
Decimal output suppresses leading zeros. Timing reads the 50 Hz **FRAMES**
system variable (`23672`) before/after; `div50` converts frames→seconds with a tenths digit.
Because FRAMES advances on the emulated 50 Hz interrupt, the seconds shown are **true Spectrum
time even if Fuse runs faster than real-time**.

The tape is built with an explicit `EMPTYTAP` + two `SAVETAP` blocks: a tiny BASIC autoloader
(`10 CLEAR VAL "32767": LOAD ""CODE: RANDOMIZE USR VAL "32768"`) and a single **CODE block that
loads directly at `$8000`**. This keeps all code and hot buffers (`$8000`–`$A2xx`) in
**uncontended ("fast") RAM** — `$4000`–`$7FFF` is ULA-contended and slower. (The simpler
`SAVETAP "file",start` form instead emits a 3-stage loader whose stub lands at `$5E00` in
contended RAM and a full 32 KB memory image — avoid it for timing demos.)

---

## 8. Full Rabin-Williams verify pipeline

This is the actual device operation: given a downloaded artifact and a signature, decide
**genuine vs forged** using only the public modulus `n`. It composes the two validated cores —
SHA-256 (`sha_core.inc.asm`) and the bignum modmul (`bn_core.inc.asm`) — behind one callable
`rabin_verify` subroutine (`rabin_core.inc.asm`), plus a little tweak/padding glue.

### Why Rabin-*Williams* (not plain Rabin, not PKCS#1)

Plain Rabin signing must take a *square root* mod `n`, but only ~¼ of values are quadratic
residues mod `n = pq`, so an arbitrary padded hash usually has no root. **Williams' variant**
fixes this with a keypair where `p ≡ 3 (mod 8)` and `q ≡ 7 (mod 8)`. Then for any message
representative `M`, exactly one of `{M, 2M, −M, −2M} (mod n)` is a quadratic residue, picked by
two tiny tweaks the signer emits alongside `s`:

- `e ∈ {1, 2}` — multiply by 2 if needed to fix the Jacobi symbol `(·/n)` to +1
  (works because `(2/n) = −1` for these primes);
- `f ∈ {+1, −1}` — multiply by −1 if needed to flip a "non-residue mod both primes" into a
  residue (works because `(−1/n) = +1`).

PKCS#1 v1.5 padding is **RSA-specific** — it relies on every value having a unique `e`-th root —
and does **not** apply to Rabin. Instead the representative is a fixed redundant block (an
ISO-9796-2-flavoured layout; we own both ends, so no ASN.1):

```
M = 6A | BC×94 | SHA-256(artifact)[32] | CC      (big-endian, 128 bytes)
    └hdr┘ └redundancy┘  └─── binding ───┘  └trl┘
```

The header `0x6A < 0x80` guarantees `M < n` (a 1024-bit modulus' top byte is ≥ 0x80). The 94
fixed filler bytes + fixed trailer **are** the security: a forged `s` squares to some unrelated
residue whose bytes won't be `6A … CC`, so it's rejected.

### Device verify — the forward direction is one squaring

`rabin_verify` runs five steps (all registers scratch; inputs pre-loaded — see the header of
`rabin_core.inc.asm`):

1. `digest = SHA-256(artifact)` — `sha_full` + `sha_digest`.
2. `t = s² mod n` — `mul_bn` (both operands = `s`) then `mod_bn`. The single Rabin squaring.
3. **Undo `f`:** if `f = −1`, `t ← n − t` (`sub_n_mbuf`; `−x mod n = n−x`, valid since `0 < t < n`).
4. **Undo `e`:** if `e = 2`, `t ← t/2 mod n` (`halve_mbuf`). Modular halving for odd `n`:
   `t` even → `t >> 1`; `t` odd → `(t + n) >> 1` (the sum is even and may carry into a 129th
   bit, which becomes the shifted-in MSB — handled by chaining the add's carry-out into the
   top of the right-shift).
5. **Rebuild & compare:** `build_em` reconstructs the expected block from *our* freshly computed
   digest; a full 128-byte compare yields the verdict (`1` = valid at `result`).

All four helpers (`sub_n_mbuf`, `add_n_mbuf`, `halve_mbuf`, `build_em`) are single linear passes
that exploit "`inc rr`/`djnz` don't touch carry" to chain a borrow/carry across 128 bytes (§5).

### Endianness gotcha in `build_em`

`digest` is big-endian (SHA's natural output), but the bignum `M` is little-endian, so big-endian
byte `k` lands at LE index `127−k`: `embuf[0]=CC`, `embuf[1..32]=digest reversed`,
`embuf[33..126]=BC`, `embuf[127]=6A`. Getting this reversal wrong is the easiest mistake here —
the harness's on-device digest cross-check (§9) catches it.

### Memory map

To run both cores back-to-back without aliasing, the bignum buffers live at **`$C000`** (a clean
4 KB window): the tap embeds ~1 KB of vectors, pushing code to ~`$95FF`, so the original `$9000`
buffers would have collided with the program image. SHA keeps `$A000`/`$B000`; the artifact hash
sits safely in `digest` (`$A400`) while step 5 rebuilds the expected block. (The harness binary,
with no embedded vectors, fits under `$9000` either way; the `$C000` choice keeps one map for both
front-ends.)

### Results

`make rabin` runs all four `(e,f)` tweak combinations **plus a tamper test**, cycle-accurately:

| | full verify (76-byte / 2-block artifact) |
|---|---|
| stock @ 3.5 MHz | **~4.2–4.6 s** |
| Next @ 28 MHz | **~0.52 s** |

All four combos PASS (on-device digest matches host), and a 1-bit artifact flip is correctly
**rejected**. The signer is `vectors/rabin_sign.js` — it generates the keypairs (with the
`p≡3, q≡7 mod 8` constraint via its own Miller-Rabin), computes the Jacobi/tweak selection and
the CRT square root in Node `BigInt`, and **self-checks** each vector by squaring and untweaking
back to `M` before emitting it. `make rabin-tap` builds `rabin_zx.tap` for on-device OK/BAD +
self-timing.

> **`IY` is sacred — the cores are `IY`-free (interrupt-safe).** The first hardware run hung
> (~5 s, then a black screen): `bn_core` originally used `IY` as a bignum pointer, but the 48K
> ROM's 50 Hz interrupt handler **and** `RST $10` require `IY = $5C3A` (the system-variable base),
> so every interrupt during the ~4 s modmul ran the ROM handler with a bogus `IY` and scribbled
> over memory. The fix was **not** `DI` (which would freeze `FRAMES` and is illegal for an esxDOS
> dot command anyway) but to make the cores **never touch `IY`**: where a second array pointer is
> needed alongside `IX`, it lives in the **shadow `HL`** register (`EXX`). The ROM ISR preserves
> the active main bank (push/pop) and never touches `IX` or the inactive shadow bank, so an
> interrupt may fire on any instruction without corruption — as long as `IY` stays `$5C3A`, which
> it now always does. `sha_digest` (the only `IY` user in `sha_core`) was likewise switched to
> `HL`. Bonus: replacing `(iy+d)` (19T) reads with `(hl)` (7T) via cheap `exx` made the modmul
> **~2% faster**, not slower. The tap therefore runs with **interrupts on** and self-times.
>
> **Second gotcha — preserve the shadow set across the USR boundary.** `RANDOMIZE USR` runs
> *inside* the ROM floating-point calculator (RST $28), which keeps its own state in the
> alternate registers (`HL'` etc.). Since `bn_core` now uses `EXX`, a naïve return left the
> calculator's shadow state clobbered → BASIC jumped off and **reset the machine right after the
> results printed**. Fix: `rabin_verify` brackets its body with `exx : push bc/de/hl : exx` … `exx
> : pop hl/de/bc : exx`, handing the calculator its alternate registers back intact. (A free-
> standing esxDOS dot command will want the same courtesy if its caller uses the calculator.)

---

## 9. The test harness

`runner.c` / `sha_runner.c` / `rabin_runner.c` embed floooh's **`z80.h`**, a cycle-stepped Z80 core, and:
1. load the raw assembled binary at `$8000` and place `JP $8000` at the reset vector,
2. load test vectors / build the `"abc"` block into RAM,
3. tick the CPU one T-state at a time, servicing memory reads/writes on the `MREQ` pin, counting
   ticks until the program executes `HALT`,
4. compare the result region against host-computed values and print **T-states** (and
   seconds @ 3.5 / 28 MHz).

`vectors/gen.js` builds a real RSA-1024/e=3 relation with Node's `crypto` + `BigInt`: generate a
keypair (e=3), pick a message `m < n`, sign `s = m^d mod n`, and emit `n`, `s`, `exp_s3 = m`
(`= s³ mod n` since `e=3`), and `exp_s2 = s² mod n`, all as 128-byte LE buffers. The Z80 result
must reproduce these exactly — any discrepancy is a Z80 bug, not a key issue.

`rabin_runner.c` drives the full pipeline: for each record in `vectors/rabin_vectors.bin` it
loads `n`, `s`, the `(e,f)` tweaks and the artifact, runs `rabin_verify` to `HALT`, and checks the
verdict byte **and** the on-device digest against the host. It then flips one artifact bit and
re-runs, asserting the verify now **fails** — a positive *and* a negative test.

This gives a **scriptable, deterministic, cycle-accurate** loop with no GUI, ideal for iterating
on the asm.

---

## 10. Real-hardware validation

`sha_zx.tap` was run on a real/Fuse 48K and timed **64 blocks = 782 frames = 15.6 s**. The
cycle-accurate sim predicted **53.0M T = 15.1 s = 757 frames**:

| | frames | seconds |
|---|---|---|
| z80.h sim (pure compute) | 757 | 15.1 s |
| Real 48K / Fuse | 782 | 15.6 s |

**Within ~3%.** The gap is the 50 Hz interrupt handler (keyboard scan + FRAMES), which runs
~782 times during the hash because interrupts must stay enabled for the timer; a `DI` around the
hash would close it. Conclusion: **the sim's T-state figures are trustworthy** — every number
in §1 reflects real hardware behavior.

(That run validated the sim against the *naïve* core. The **optimised** core was then measured
on a real 48K at **~11 s** for the same 64 blocks — matching the sim's 10.8 s prediction to ~2%,
confirming the 1.40× speedup on silicon, not just in emulation.)

The **known-answer test** (`sha_test.tap`) was also run on the real 48K: **all 5 vectors `OK`**
(empty, abc, 56-byte, 64×'a', 120×'a') — the optimised core's padding and multi-block paths are
correct on hardware, not just in the sim.

---

## 11. Optimization headroom

In rough value order:

- **SHA-256 done so far (1.40×):** shortest-direction rotations, pointer word-ops, inlined
  rotates. **Still on the table:** an 8-round unroll that eliminates the `a→h` copies (~7%) and
  register-resident round state — both hurt readability, so deferred.
- **Modmul to <3 s**: a dedicated squaring routine for `s²` (skip duplicate cross-products,
  ~0.6×), unrolled Comba/`mulsub` inner loops (drop the memory loop-counters), or page-aligned
  quarter-square tables (single-byte index, no `add hl,hl`).
- **Smaller modulus** (768-bit) — weaker but "OK-ish" for a hobby archive; ~2× on both halves.
- ~~**`IY`-free `bn_core`**~~ **DONE** (§8): the cores use shadow `HL` (`EXX`) instead of `IY`, so
  they're interrupt-safe and esxDOS-friendly (and ~2% faster). No work remaining here.
- On the **Next**, none of this is needed — `Z80N MUL` and 28 MHz already put full verify at
  ~1–2 s for typical artifacts.

---

## 12. References

- **Quarter-square multiplication** and 8-bit bignum structure: Niels Möller, "Multiplication on
  the 6502" — https://www.lysator.liu.se/~nisse/misc/6502-mul.html
- **Knuth Algorithm D** (base-`b` long division): TAOCP Vol. 2, §4.3.1; also Handbook of Applied
  Cryptography, Ch. 14.
- **Barrett / Montgomery reduction** (considered, not used): HAC Ch. 14; Wikipedia "Montgomery
  modular multiplication".
- **Z80 multiplication / shift routines**: WikiTI, MSX Assembly Page (Grauw).
- **CRC-32C reference** (separate primitive): ped7g's `nexload2.asm`.
- **Emulator**: floooh `chips/z80.h` (cycle-stepped). **Assembler**: sjasmplus. **Spectrum
  emulators**: Fuse, ZEsarUX.
- SHA-256: FIPS 180-4.
```
