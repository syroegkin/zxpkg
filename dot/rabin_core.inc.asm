; ============================================================================
; rabin_core.inc — full Rabin-Williams-1024 signature verify for the Z80.
; ============================================================================
;
; This include provides the callable subroutine `rabin_verify` plus its
; helpers and the buffer/scalar EQUs it shares with bn_core.inc.  Include it
; from a front-end that has already issued its own `org` (and set SP), e.g.:
;
;       org $8000
;       ld sp,$BFFF
;       call rabin_verify          ; inputs pre-loaded (see below); ret when done
;       ...
;       INCLUDE "rabin_core.inc.asm"   ; rabin_verify + helpers + EQUs   (this file)
;       INCLUDE "bn_core.inc.asm"      ; mul_bn / mod_bn (uses our EQUs)
;       INCLUDE "sha_core.inc.asm"     ; sha_full / sha_digest
;
; WHAT THIS PROVES
; ----------------
; A ZX Spectrum (stock Z80 @ 3.5 MHz) can verify an authenticity signature over
; a downloaded artifact, end to end:  hash the bytes, recover the signed digest
; from the signature using only public data (the modulus n), and check they
; match.  No secret key is ever on the device — only verification.
;
; THE MATH (why one squaring is enough)
; -------------------------------------
; Keypair:  n = p*q   with primes  p = 3 (mod 8),  q = 7 (mod 8).
; The signer builds a 128-byte "message representative" M that embeds the hash
; with fixed redundancy (see build_em below), then finds two tiny tweaks
;       e in {1,2}   and   f in {+1,-1}
; such that  Mqr = f * e * M (mod n)  is a quadratic residue mod n, and emits
;       s = sqrt(Mqr) (mod n)         together with the 2 tweak bits (e,f).
;
; Rabin verification is the *forward* direction — a single modular squaring:
;       t = s^2 (mod n)            == Mqr == f * e * M (mod n)
; so we recover M by undoing the tweaks (both are trivially invertible mod n):
;       if f == -1 :  t <- n - t           ; multiply by -1  (because -x = n-x)
;       if e ==  2 :  t <- t / 2 (mod n)    ; multiply by 1/2 (modular halving)
; The result must equal the M we can rebuild ourselves from SHA-256(artifact).
; A forged signature would square to some unrelated residue whose top/bottom
; bytes will not be the fixed redundancy 6A.. ..CC, so it is rejected.
;
; Compared to RSA-e=3 this is *half* the work (one squaring instead of s^3 =
; two modmuls) at the same factoring-based security; the price is a non-standard
; signer on the portal side (the QR/tweak logic, done in vectors/rabin_sign.js).
;
; CALLING CONVENTION (inputs pre-loaded by the caller / harness)
; --------------------------------------------------------------
;   n        @ $9000   modulus    (little-endian 128 bytes)
;   s        @ $9080   signature  (little-endian 128 bytes)
;   tw_e     @ $9510   the e tweak (1 or 2)
;   tw_f     @ $9511   the f tweak (0x01 = +1, 0xFF = -1)
;   msgbuf   @ $B000   artifact bytes        (consumed by sha_core.inc)
;   msglen   @ $B100   artifact length (1 byte, <= 180 for this PoC)
; OUTPUT
;   result   @ $9512   1 = signature VALID, 0 = INVALID   (also returned implied)
;
; ENDIANNESS
; ----------
; Every bignum is a little-endian byte array: index 0 is the least-significant
; byte, index 127 the most-significant.  This matches bn_core.inc (the divisor's
; top digit is read from n+127) and the vectors produced by rabin_sign.js.
;
; MEMORY MAP RATIONALE
; --------------------
; The SHA-256 core (sha_core.inc) owns $A000..$A30B, $A400 (digest) and
; $B000.. (message).  The bignum buffers/scalars live at $C000.. (a clean 4 KB
; window) so they alias NEITHER the SHA core NOR the program image: the tap
; front-end embeds ~1 KB of test vectors, pushing code up to ~$95FF, so $9xxx
; can't be used for runtime write buffers (they'd clobber the code/vectors).
; $C000 is above the code, above the SHA buffers, and above the stack ($BFFF).
; The artifact hash (computed first) stays intact in `digest` ($A400) while we
; rebuild the expected block at the very end.
; ============================================================================

NLEN     equ 128            ; bignum width in bytes (1024 bits)

; ---- bignum buffers (all in $Cxxx, clear of code + sha_core's $Axxx/$Bxxx) ----
n        equ $C000          ; modulus            (LE 128)            [input]
s        equ $C080          ; signature          (LE 128)            [input]
P        equ $C100          ; product / dividend (257) — used by bn_core mul/mod
rmd      equ $C210          ; mod_bn remainder   (128) — = s^2 mod n
mbuf     equ $C300          ; recovered M; tweaks are undone here in place (128)
embuf    equ $C400          ; expected EM, rebuilt from the on-device digest (128)

; ---- bignum scalars (names are fixed: bn_core.inc refers to them) ----
mul_a    equ $C500          ; pointer: left  multiplicand for mul_bn
mul_b    equ $C502          ; pointer: right multiplicand for mul_bn
acc2     equ $C504          ; Comba accumulator, byte 2 (high)
kcol     equ $C505          ; Comba column index
cnt      equ $C506          ; Comba inner-loop counter
jidx     equ $C507          ; Alg.D quotient digit position (128..0)
qhat     equ $C508          ; Alg.D estimated quotient digit
vtop     equ $C509          ; divisor top digit n[127]
mscnt    equ $C50A          ; multiply-subtract inner counter
topbrw   equ $C50B          ; borrow out of the division window top
topcry   equ $C50C          ; carry out of the division window top (add-back)
ms_mc    equ $C50D          ; mulsub: multiply carry (was reg C in the IY version)
ms_bw    equ $C50E          ; mulsub: subtract borrow (was reg B)

; ---- tweak inputs / result output ----
tw_e     equ $C510          ; e tweak: 1 or 2                          [input]
tw_f     equ $C511          ; f tweak: 0x01 (+1) or 0xFF (-1)          [input]
result   equ $C512          ; 1 = PASS (valid), 0 = FAIL (invalid)     [output]
vs_sig   equ $C513          ; verify_sig: saved &.sig                  [internal]
vs_pk    equ $C515          ; verify_sig: saved &pubkey                [internal]

; ----------------------------------------------------------------------------
; verify_sig — verify a blob against the on-wire signature + public-key bytes
; (spec §5.4/§5.6), the form the device actually receives.  This is the thin
; glue over rabin_verify: it parses the two 130-byte structures, loads n/s and
; the e/f tweaks, then runs the verify.
;
;   HL = &.sig   : [u8 key_id][u8 tweak][128 s LE]
;   DE = &pubkey : [u8 key_id][u8 algo ][128 n LE]
;   msgbuf/msglen pre-loaded with the blob.
; result: 1 = valid, 0 = invalid (also 0 on key_id mismatch or unknown algo).
; ----------------------------------------------------------------------------
; verify_sig: blob in msgbuf/msglen -> hashed here (sha_full, <=180 bytes).
verify_sig:
         call vs_parse        ; load n/s/tweaks; CF + result=0 on key/algo mismatch
         ret c
         jp rabin_verify      ; hashes msgbuf, verifies, sets (result), RET to our caller
; verify_sig_pre: caller already computed `digest` (e.g. streaming sha_fd over a
; large artifact) — skip the built-in SHA and verify against that digest.
verify_sig_pre:
         call vs_parse
         ret c
         jp rabin_verify_pre

; vs_parse: HL=&.sig, DE=&pubkey -> load n, s and the e/f tweaks.
; Returns CF=0 on success; CF=1 (and result=0) on key_id/algo mismatch.
vs_parse:
         ld (vs_sig),hl
         ld (vs_pk),de
         ld a,(de)            ; pubkey[0] = key_id
         cp (hl)              ; sig[0] = key_id  (HL = &.sig)
         jr nz,vs_bad
         inc de               ; &pubkey[1] = algo
         ld a,(de)
         cp 1                 ; must be rabin-williams-1024
         jr nz,vs_bad
         ld hl,(vs_pk)        ; n <- pubkey[2..129] (128 LE)
         inc hl : inc hl
         ld de,n
         ld bc,128
         ldir
         ld hl,(vs_sig)       ; s <- sig[2..129] (128 LE)
         inc hl : inc hl
         ld de,s
         ld bc,128
         ldir
         ld hl,(vs_sig)       ; tweak = sig[1]: bit0->e (0:1,1:2), bit1->f (0:+1,1:-1)
         inc hl
         ld a,(hl)
         ld b,a
         and 1
         jr z,vs_e1
         ld a,2
         jr vs_es
vs_e1:
         ld a,1
vs_es:
         ld (tw_e),a
         ld a,b
         and 2
         jr z,vs_fpos
         ld a,$ff             ; f = -1
         jr vs_fst
vs_fpos:
         ld a,$01             ; f = +1
vs_fst:
         ld (tw_f),a
         or a                 ; CF = 0 (success)
         ret
vs_bad:
         xor a
         ld (result),a        ; key_id/algo mismatch -> invalid
         scf                  ; CF = 1 (parse failed)
         ret

; ----------------------------------------------------------------------------
; rabin_verify — the whole pipeline, as a callable subroutine (ends in RET).
; Registers are all scratch EXCEPT the shadow set, which is saved/restored:
; `RANDOMIZE USR` runs inside the ROM floating-point calculator, which keeps its
; state in the alternate registers (HL' etc.).  bn_core uses EXX, so we must
; hand the shadow set back intact or BASIC crashes/resets on return.  (IY is
; never touched at all — see bn_core.inc.asm header.)  The caller must have set
; SP and pre-loaded inputs.
; ----------------------------------------------------------------------------
rabin_verify:
         ; -- STEP 1 : digest = SHA-256(msgbuf[0..msglen-1]) ------------------
         ; sha_full pads + hashes msgbuf (<=180 bytes); sha_digest writes the
         ; big-endian digest.  For larger artifacts the caller computes `digest`
         ; itself (streaming sha_fd) and enters at rabin_verify_pre instead.
         call sha_full
         call sha_digest
         ; fall through into rabin_verify_pre with `digest` ready
rabin_verify_pre:
         exx                ; preserve the ROM calculator's alternate registers
         push bc : push de : push hl
         exx

         ; -- STEP 2 : t = s^2 mod n  (the single Rabin squaring) -------------
         ; mul_bn multiplies (mul_a)*(mul_b) -> P[0..255].  We point BOTH
         ; operands at s, so P = s*s (256-byte product).  mod_bn then reduces
         ; P modulo n via Knuth Algorithm D, leaving the 128-byte remainder in
         ; rmd.  We copy rmd into mbuf, where the tweak-undo happens in place.
         ld hl,s : ld (mul_a),hl     ; mul_a := &s   (16-bit pointer store)
         ld hl,s : ld (mul_b),hl     ; mul_b := &s
         call mul_bn                 ; P  = s * s          (full 2048-bit product)
         call mod_bn                 ; rmd = P mod n       (= s^2 mod n)
         ld hl,rmd : ld de,mbuf : ld bc,NLEN : ldir
                                     ; mbuf <- rmd (128 bytes); ldir copies
                                     ; HL->DE, BC times, ascending.

         ; -- STEP 3 : undo the f tweak.  f == -1  =>  mbuf := n - mbuf -------
         ; -x mod n == n - x for 0 < x < n, and here 0 < s^2 mod n < n.
         ld a,(tw_f)        ; load the f tweak byte
         cp $ff             ; is it 0xFF (our encoding of -1)?
         jr nz,rv_nof       ;   no  -> f = +1, nothing to undo
         call sub_n_mbuf    ;   yes -> mbuf := n - mbuf
rv_nof:

         ; -- STEP 4 : undo the e tweak.  e == 2  =>  mbuf := mbuf / 2 mod n --
         ld a,(tw_e)        ; load the e tweak byte
         cp 2               ; is it 2?
         jr nz,rv_noe       ;   no  -> e = 1, nothing to undo
         call halve_mbuf    ;   yes -> mbuf := mbuf * (1/2) mod n
rv_noe:

         ; -- STEP 5 : rebuild the expected block and compare ----------------
         ; build_em writes the canonical representative (header/filler/hash/
         ; trailer) into embuf using OUR freshly computed digest.  If the
         ; signature is genuine, the recovered mbuf equals embuf byte for byte.
         call build_em
         ld hl,mbuf         ; HL -> recovered bytes
         ld de,embuf        ; DE -> expected  bytes
         ld c,1             ; C = running verdict, optimistically PASS
         ld b,NLEN          ; B = 128 byte counter for djnz
rv_cmp:
         ld a,(de)          ; A = expected[i]      (ld a,(de) does NOT touch flags)
         cp (hl)            ; compare with recovered[i]; Z set iff equal
         jr z,rv_eq         ; equal -> leave verdict as-is
         ld c,0             ; differ -> verdict FAIL (and keep scanning: simple,
                            ;            and avoids an early-exit timing signal)
rv_eq:
         inc hl             ; advance both pointers (16-bit inc: no flag change)
         inc de
         djnz rv_cmp        ; loop 128 times (djnz does not affect CF/Z we rely on)
         ld a,c             ; A = final verdict
         ld (result),a      ; publish it at $9512
         exx                ; restore the ROM calculator's alternate registers
         pop hl : pop de : pop bc
         exx
         ret                ; verdict in A and at result

; ============================================================================
; tweak / padding helpers — all are single linear passes over little-endian
; bignums.  The recurring trick: the 16-bit `inc hl`/`inc de` and `djnz` used
; to walk the array do NOT modify the carry flag, so a borrow/carry produced by
; one `sbc`/`adc` survives untouched into the next iteration's `sbc`/`adc`.
; That is what lets a flat loop implement a 128-byte add/subtract.
; ============================================================================

; ----------------------------------------------------------------------------
; sub_n_mbuf :  mbuf := n - mbuf      (computes -mbuf mod n)
; Precondition: 0 < mbuf < n, so the true result is in [1, n-1] and the final
; borrow is guaranteed 0 (n is genuinely larger) — we don't need to check it.
; ----------------------------------------------------------------------------
sub_n_mbuf:
         ld hl,mbuf         ; HL -> mbuf[i]  (minuend's storage AND destination)
         ld de,n            ; DE -> n[i]
         or a               ; clear CF: `or a` sets CF=0 (start with no borrow)
         ld b,NLEN          ; 128 bytes
snm_lp:
         ld a,(de)          ; A = n[i]             (no flag change)
         sbc a,(hl)         ; A = n[i] - mbuf[i] - borrow ; CF = new borrow
         ld (hl),a          ; mbuf[i] = result     (no flag change)
         inc hl             ; next byte (no flag change -> CF preserved)
         inc de
         djnz snm_lp        ; repeat for all 128 bytes
         ret

; ----------------------------------------------------------------------------
; halve_mbuf :  mbuf := mbuf / 2 (mod n)      (computes mbuf * 2^-1 mod n)
; Standard modular-halving identity for ODD n:
;     mbuf even ->  mbuf / 2                         (plain logical shift right)
;     mbuf odd  -> (mbuf + n) / 2   (mbuf+n is even because n is odd; the sum
;                                    can be up to 2n-1 so it carries into a
;                                    129th bit, which becomes the shifted-in MSB)
; ----------------------------------------------------------------------------
halve_mbuf:
         ld a,(mbuf)        ; look at the least-significant byte...
         rrca               ; ...rotate bit0 into CF (rrca ignores incoming CF)
         jr nc,hm_even      ; bit0 = 0 -> even -> shift directly
         call add_n_mbuf    ; odd: mbuf += n ; on return CF = carry out of the
                            ;      top byte = the bit to shift into the new MSB
         jr hm_shift        ; (jr preserves CF)
hm_even:
         or a               ; even: incoming MSB is 0 -> clear CF
hm_shift:
         ; Logical shift-right-by-1 of the whole 128-byte value, walking from
         ; the most-significant byte DOWN.  `rr (hl)` rotates a memory byte
         ; right through carry: new bit7 = old CF, new CF = old bit0.  Going
         ; high->low, the CF carries each byte's outgoing low bit into the next
         ; lower byte's high bit — exactly a multi-byte >>1, with the entry CF
         ; (set above) landing in bit7 of the top byte.
         ld hl,mbuf+NLEN-1  ; HL -> most-significant byte (mbuf[127])
         ld b,NLEN          ; 128 bytes
hm_lp:
         rr (hl)            ; rotate this byte right through carry
         dec hl             ; move toward the low end (no flag change -> CF kept)
         djnz hm_lp
         ret

; ----------------------------------------------------------------------------
; add_n_mbuf :  mbuf := mbuf + n   ;  returns CF = carry out of the top byte
; Helper for the odd case of halve_mbuf.  The returned CF is the 129th bit.
; ----------------------------------------------------------------------------
add_n_mbuf:
         ld hl,mbuf         ; HL -> mbuf[i] (addend AND destination)
         ld de,n            ; DE -> n[i]
         or a               ; clear CF (start with no carry-in)
         ld b,NLEN
anm_lp:
         ld a,(de)          ; A = n[i]
         adc a,(hl)         ; A = n[i] + mbuf[i] + carry ; CF = new carry
         ld (hl),a          ; mbuf[i] = sum
         inc hl
         inc de
         djnz anm_lp        ; CF preserved across inc/djnz
         ret                ; CF now holds the final carry out

; ----------------------------------------------------------------------------
; build_em : write the canonical message representative into embuf.
;
; Big-endian (mathematical) layout of the 128-byte block:
;     byte[0]      = 0x6A                 header  (< 0x80 => guarantees M < n)
;     byte[1..94]  = 0xBC (94 bytes)      fixed filler — the redundancy
;     byte[95..126]= SHA-256 digest (32)  the actual binding to the artifact
;     byte[127]    = 0xCC                 trailer
;
; We store little-endian, so big-endian byte k lands at LE index 127-k:
;     LE[0]       = 0xCC                  (trailer)
;     LE[1..32]   = digest, REVERSED      (digest is big-endian in memory)
;     LE[33..126] = 0xBC                  (filler)
;     LE[127]     = 0x6A                  (header)
; ----------------------------------------------------------------------------
build_em:
         ld hl,embuf        ; HL -> embuf[0]
         ld (hl),$CC        ; LE[0] = trailer
         inc hl             ; HL -> embuf[1]
         ; copy the 32 digest bytes in reverse (BE digest -> LE position)
         ld de,digest+31    ; DE -> most-significant digest byte (digest is BE)
         ld b,32
be_d:
         ld a,(de)          ; read digest byte, high end first
         ld (hl),a          ; place at the low end of embuf's hash field
         inc hl             ; embuf ascends
         dec de             ; digest descends  (reverses the order)
         djnz be_d          ; -> HL now at embuf[33]
         ; 94 filler bytes
         ld b,94
be_f:
         ld (hl),$BC
         inc hl
         djnz be_f          ; -> HL now at embuf[127]
         ld (hl),$6A        ; LE[127] = header
         ret
