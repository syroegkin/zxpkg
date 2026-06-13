; sha256.asm — SHA-256 per-block benchmark harness (core in sha_core.inc).
; The C harness (sha_runner) writes a padded 64-byte block at $9000 and a repeat
; count at $9FFF; we compress that block `nrep` times to measure marginal per-block
; cost, then emit the digest at `digest` ($A400). nrep=1 reproduces SHA-256("abc").
; Assemble: sjasmplus --raw=sha256.bin sha256.asm

bench_n equ $B300

        org $8000
sha_main:
        ld sp,$BFFF
        call sha_init
        ld hl,$9000               ; block supplied by the harness
        ld (blkptr),hl
        ld a,($9FFF)              ; repeat count
        ld (bench_n),a
bn_lp:
        call sha_block            ; same block each time (timing); blkptr unchanged
        ld a,(bench_n)
        dec a
        ld (bench_n),a
        jr nz,bn_lp
        call sha_digest
        halt

        INCLUDE "sha_core.inc.asm"
