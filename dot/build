#!/usr/bin/env bash
# Build + run the RSA-1024/e=3 verify PoC: generate a vector, assemble the Z80
# routine, compile the harness, run it (prints PASS/FAIL + T-states).
set -euo pipefail
cd "$(dirname "$0")"

SJASM=../.toolchain/bin/sjasmplus
Z80H_URL=https://raw.githubusercontent.com/floooh/chips/master/chips/z80.h

[ -f z80.h ] || curl -sS -o z80.h "$Z80H_URL"

echo "== generate test vector =="
node vectors/gen.js

echo "== assemble (sjasmplus) =="
"$SJASM" --raw=rsa_verify.bin rsa_verify.asm

echo "== build harness (gcc) =="
gcc -O2 -o runner runner.c

echo "== run =="
./runner rsa_verify.bin vectors/vectors.bin
