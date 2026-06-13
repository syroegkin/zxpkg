# `spec/` — formats & the crypto-parity gate

The on-wire **contract** both halves of ZXPkg must agree on, plus the **shared test vectors**
that prove they do. The format definitions live in [`../plans/01-spec.md`](../plans/01-spec.md);
this folder holds the committed vectors and the gate that checks them.

## `vectors/` (committed, deterministic)

| file | what |
|---|---|
| `testkey.json` | **TEST-ONLY** Rabin-Williams-1024 keypair (`n,p,q`). Committed so vectors are reproducible. **Never used to sign real artifacts** (real keys live in `portal/keys/`, git-ignored). |
| `crc32c.json` | CRC-32C inputs → expected `u32` (params: reflected `0x82F63B78`, init/xorout `0xFFFFFFFF`). |
| `sha256.json` | SHA-256 KATs (empty / abc / 56-byte / 64×a / 120×a). |
| `rabin.json` | Rabin-Williams signed blobs (`n`, the 130-byte `.sig`, `e/f`) + tampered twins, `expect: valid|invalid`. |
| `index.dat` + `index.json` | A sample compiled index (binary, via the portal's own encoder) + the fixture rows it was built from. |

Signing is deterministic (no randomness given key+blob), so regenerating with the same
`testkey.json` reproduces every vector byte-for-byte.

## The gate

Run from `portal/` (needs the device harnesses in `../dot/`, built via the local
`.toolchain`):

```sh
npm run vectors:gen      # (re)generate vectors/ from testkey.json (keeps the key if present)
npm run vectors:check    # assert Node reference AND Z80 reference agree — exits non-zero on mismatch
```

`vectors:check` verifies each vector on **both** sides:

| primitive | Node ref | Z80 ref |
|---|---|---|
| CRC-32C | `portal/src/lib/crc32c.ts` | `dot/crc_runner` |
| SHA-256 | `node:crypto` | `dot/sha_full_runner` |
| Rabin-Williams | `portal/src/lib/rabin.ts` | `dot/rabin_runner` (incl. tamper-reject) |
| **wire-format verify** | `portal/src/lib/rabin.ts` | `dot/verify_sig_runner` — feeds the **real 130-byte `.sig` + 130-byte pubkey entry** through the device `verify_sig` glue (valid / tampered→reject / key_id-mismatch→reject) |
| **`index.dat` v1** | `portal/src/lib/index-format.ts` (`encodeIndex`) | `dot/index_runner` — decoder round-trips every record + rejects an unknown `schema_ver` |

This is the gate the overview calls *"crypto parity — the gate for everything"*: a portal-signed
blob must verify on the device, and a tampered blob must fail, with hashes byte-identical on both.

## Coverage

All four primitives now have **Node + Z80** parity (CRC-32C, SHA-256, Rabin-Williams sign/verify
incl. the wire-format `.sig`/pubkey path, and `index.dat` v1). Current gate: **38/38**.
