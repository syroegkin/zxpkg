; ============================================================================
; bn_core.inc.asm — shared 1024-bit modular-arithmetic core for the Z80 PoC.
; ============================================================================
;   mul_bn : P[256] = (mul_a)[128] * (mul_b)[128]   (Comba / product scanning)
;   mod_bn : rmd[0..127] = P[256] mod n[128]        (Knuth TAOCP Alg. D, base 256)
; The 8x8 byte multiply uses the quarter-square identity and the qsq table baked
; at assembly time (bottom of this file).
;
; ------------------------------------------------------------------ ENDIANNESS
; Every bignum is a little-endian byte array: index 0 = least-significant byte,
; index 127 = most-significant.  Adds/subtracts walk index 0 upward so the Z80
; carry flag chains naturally from LSB to MSB.
;
; --------------------------------------------------- INTERRUPT-SAFE / IY-FREE
; These routines NEVER use IY.  The 48K ROM's 50 Hz interrupt handler and
; RST $10 both require IY = $5C3A (the system-variable base); esxDOS needs it
; too.  When a *second* array pointer is needed alongside IX, it is kept in the
; SHADOW HL register, reached with EXX:
;   - EXX swaps BC/DE/HL with BC'/DE'/HL' (it does NOT swap AF, and does NOT
;     affect flags), so `exx : ld a,(hl) : … : exx` brings both the byte (in A)
;     and the flags back into the main context.
;   - The ROM ISR preserves the active main bank (push/pop AF,BC,DE,HL) and
;     never touches IX or the *inactive* shadow bank.  So an interrupt may fire
;     on ANY instruction in here without corruption — provided the CALLER keeps
;     IY = $5C3A (which it does; nothing here changes IY).
;   - EXX pairs are balanced on every path; the shadow BC/DE are don't-care.
;
; ------------------------------------------------------------- CALLER CONTRACT
; The INCLUDING file must define (EQU) these buffers/scalars before INCLUDE:
;   NLEN(=128) n P rmd  mul_a mul_b acc2 kcol cnt jidx qhat vtop mscnt
;   topbrw topcry ms_mc ms_bw
; (n, P, rmd are buffers; the rest are 1-byte/2-byte scalar scratch.)
; ============================================================================

; ============================================================================
; mul_bn: P[256] = (mul_a)[128] * (mul_b)[128]   — Comba / product scanning.
;
; Comba walks OUTPUT columns k = 0..255.  Column k sums every partial product
; a[i]*b[j] with i+j = k into a 24-bit accumulator, then emits one product byte
; (the low 8 bits) and shifts the accumulator right by 8.  This touches each
; P[k] exactly once (vs operand-scanning, which re-reads/writes P[i+j] N times).
;
; Accumulator = acc2(memory) : B : C   (24 bits, big end in acc2).  A column has
; at most 128 partial products each <= 255*255 = 65025, sum < 2^24, so 24 bits
; suffice.  a-pointer = IX (walks up); b-pointer = SHADOW HL (walks down) so the
; two operands meet along the diagonal i+j = k.
; ============================================================================
mul_bn:
         xor a                 ; A = 0
         ld (acc2),a           ; accumulator high byte = 0
         ld b,a                ; accumulator mid (B) = 0
         ld c,a                ; accumulator low (C) = 0
         ld (kcol),a           ; current column k = 0
mb_col:
         ld a,(kcol)
         cp 128                ; columns 0..127 vs 128..255 have different
         jr nc,mb_high         ;   diagonal start/length (no min/max branch)
; --- low half (k <= 127): run length = k+1, start a[0]*b[k] ---
mb_low:
         inc a                 ; A = k+1
         ld (cnt),a            ; inner-loop count = k+1
         ld ix,(mul_a)         ; a-pointer = &a[0]
         ld a,(kcol)
         ld e,a
         ld d,0                ; DE = k
         ld hl,(mul_b)
         add hl,de             ; main HL = &b[k]
         push hl : exx : pop hl : exx   ; shadow HL = b-pointer (= &b[k])
         jr mb_inner_start
; --- high half (k >= 128): run length = 255-k, start a[k-127]*b[127] ---
mb_high:
         neg                   ; A = -k (mod 256)
         add a,255             ; A = 255-k = run length
         ld (cnt),a
         ld a,(kcol)
         sub 127
         ld e,a
         ld d,0                ; DE = k-127
         ld ix,(mul_a)
         add ix,de             ; a-pointer = &a[k-127]
         ld hl,(mul_b)
         ld de,127
         add hl,de             ; main HL = &b[127]
         push hl : exx : pop hl : exx   ; shadow HL = b-pointer (= &b[127])
mb_inner_start:
         ld a,(cnt)
         or a
         jr z,mb_store         ; empty column guard
; --- inner loop: accumulate a[i]*b[j] for this column ---
mb_inner:
         ld a,(ix+0)           ; A = a[i]
         exx
         add a,(hl)            ; A = a[i] + b[j]   (hl = shadow b-pointer)
         exx                   ; back to main; CF (from add) survives EXX
         ld l,a
         ld a,0
         adc a,a               ; A = 9th bit of (a[i]+b[j])  (uses that CF)
         ld h,a
         add hl,hl             ; HL = (a[i]+b[j]) * 2   (table entries are 2 bytes)
         ld de,qsq
         add hl,de             ; HL = &qsq[a[i]+b[j]]
         ld e,(hl)
         inc hl
         ld d,(hl)             ; DE = qsq[a[i]+b[j]]
         push de               ; save the "sum" square
         ld a,(ix+0)           ; A = a[i] again
         exx
         sub (hl)              ; A = a[i] - b[j]   (CF = borrow if negative)
         exx                   ; CF survives EXX
         jr nc,mb_dpos
         neg                   ; make |a[i]-b[j]|  (table is symmetric)
mb_dpos:
         ld l,a
         ld h,0
         add hl,hl
         ld de,qsq
         add hl,de             ; HL = &qsq[|a[i]-b[j]|]
         ld e,(hl)
         inc hl
         ld d,(hl)             ; DE = qsq[|a[i]-b[j]|]
         pop hl                ; HL = qsq[sum]
         or a                  ; clear CF
         sbc hl,de             ; HL = qsq[sum] - qsq[diff] = a[i]*b[j]
         ld a,c                ; add the 16-bit product into the 24-bit acc:
         add a,l
         ld c,a                ;   C (low)  += product low
         ld a,b
         adc a,h
         ld b,a                ;   B (mid)  += product high + carry
         jr nc,mb_noc
         ld a,(acc2)
         inc a
         ld (acc2),a           ;   acc2 (high) += 1 on carry out of B
mb_noc:
         inc ix                ; a-pointer up
         exx
         dec hl                ; b-pointer down (shadow)
         exx
         ld a,(cnt)
         dec a
         ld (cnt),a
         jp nz,mb_inner        ; (jp, not jr: body > 127 bytes)
; --- emit one product byte for this column, shift accumulator down 8 ---
mb_store:
         ld a,(kcol)
         ld e,a
         ld d,0
         ld hl,P
         add hl,de             ; HL = &P[k]
         ld (hl),c             ; P[k] = accumulator low byte
         ld c,b                ; shift: low <- mid
         ld a,(acc2)
         ld b,a                ;        mid <- high
         xor a
         ld (acc2),a           ;        high <- 0
         ld a,(kcol)
         inc a
         ld (kcol),a           ; next column
         jr z,mb_done          ; wrapped past 255 -> all 256 columns done
         jp mb_col
mb_done:
         ret

; ============================================================================
; mod_bn: rmd[0..127] = P[256] mod n[128]   — Knuth TAOCP Algorithm D, base 256.
;
; The modulus n is the RSA/Rabin modulus: exactly 1024 bits, so n[127] >= 0x80,
; i.e. already NORMALISED — the precondition Algorithm D needs for an accurate
; 2-digit quotient estimate (no pre-scaling).  For each quotient position
; j = 128..0 we estimate one quotient digit, multiply-subtract q̂*n from the
; 129-digit window, and add n back if we over-subtracted.  We keep only the
; remainder.
; ============================================================================
mod_bn:
         ld a,(n+127)          ; divisor top digit n[127]
         ld (vtop),a           ;   cached for div16_8
         xor a
         ld (P+256),a          ; virtual leading digit U[256] = 0 (window for j=128)
         ld a,128
         ld (jidx),a           ; j = 128
mj_lp:
         ; HL = wbase = P + j   (low end of the current 129-byte window)
         ld a,(jidx)
         ld e,a
         ld d,0
         ld hl,P
         add hl,de
         push hl               ; save wbase
         ; numerator for the estimate = top two window digits U[j+128]:U[j+127]
         ld de,127
         add hl,de
         ld e,(hl)             ; num_lo = U[j+127]
         inc hl
         ld d,(hl)             ; num_hi = U[j+128]
         ex de,hl              ; HL = num_hi:num_lo  (16-bit numerator)
         ld a,(vtop)
         ld c,a                ; C = divisor top digit
         call div16_8          ; A = q̂ = min(HL / n[127], 255)
         ld (qhat),a
         pop hl                ; HL = wbase
         push hl
         pop ix                ; IX = wbase  (window pointer for mulsub)
         call mulsub           ; window -= q̂ * n ; sets topbrw (borrow out of top)
mj_corr:
         ld a,(topbrw)
         or a
         jr z,mj_next          ; no borrow -> estimate was exact, done
         ld a,(jidx)           ; over-subtracted: add n back to the window
         ld e,a
         ld d,0
         ld hl,P
         add hl,de
         push hl
         pop ix
         call addback          ; window += n ; sets topcry (carry out of top)
         ld a,(topcry)
         or a
         jr z,mj_corr          ; still negative (no carry) -> add back again
         xor a
         ld (topbrw),a         ; corrected: clear the borrow and continue
mj_next:
         ld a,(jidx)
         or a
         jr z,mj_done          ; processed j = 0 -> finished
         dec a
         ld (jidx),a
         jp mj_lp
mj_done:
         ld hl,P               ; U[0..127] is the remainder
         ld de,rmd
         ld bc,128
         ldir                  ; rmd <- P[0..127]
         ret

; ----------------------------------------------------------------------------
; div16_8: HL = numerator, C = divisor (normalised, >=128) -> A = min(HL/C,255)
; First caps the >=256 case (H >= C), then an 8-step restoring division with the
; 9th remainder bit carried in the carry flag.
; ----------------------------------------------------------------------------
div16_8:
         ld a,h
         cp c
         jr c,dd_ok
         ld a,255              ; quotient would be >= 256 -> saturate to 255
         ret
dd_ok:
         ld a,h               ; R = high byte (running remainder)
         ld d,l               ; D = low byte (bits to consume, MSB first)
         ld e,0               ; E = quotient accumulator
         ld b,8
dd_lp:
         sla d
         rla                  ; A = (R<<1) | next bit ; CF = bit shifted out (9th)
         jr c,dd_sub          ; if 9th bit set, R>=256 > C -> definitely subtract
         cp c
         jr c,dd_q0           ; R < C -> quotient bit 0
dd_sub:
         sub c                ; R -= C
         scf                  ; quotient bit = 1
         jr dd_shift
dd_q0:
         or a                 ; quotient bit = 0 (clear CF)
dd_shift:
         rl e                 ; shift quotient bit into E
         djnz dd_lp
         ld a,e
         ret

; ============================================================================
; mulsub: window U[j..j+128] (IX) -= q̂ * n ; sets topbrw.
;
; The division hot loop (128 iterations, called up to 128 times per reduction).
; Per digit i it computes q̂*n[i] (quarter-square, inlined), adds the running
; multiply-carry mc, then subtracts that low byte plus the incoming borrow bw
; from the window digit, producing one outgoing borrow.
;
; n-pointer = SHADOW HL (walks up).  mc and bw live in memory (ms_mc/ms_bw) so
; BC stays free; C is reused per-iteration to hold low(product)+mc.
; ============================================================================
mulsub:
         exx
         ld hl,n              ; shadow HL = &n[0]
         exx
         xor a
         ld (ms_mc),a         ; multiply-carry mc = 0
         ld (ms_bw),a         ; subtract-borrow bw = 0
         ld a,128
         ld (mscnt),a         ; 128 digits
ms_lp:
         exx
         ld a,(hl)            ; A = n[i]
         inc hl               ; advance shadow n-pointer
         exx
         ld c,a               ; C = n[i]  (kept; needed again for the difference)
         ld hl,qhat
         add a,(hl)           ; A = n[i] + q̂
         ld l,a
         ld a,0
         adc a,a              ; 9th bit
         ld h,a
         add hl,hl            ; *2 (2-byte table entries)
         ld de,qsq
         add hl,de
         ld e,(hl)
         inc hl
         ld d,(hl)            ; DE = qsq[n[i]+q̂]
         push de
         ld a,(qhat)
         sub c                ; A = q̂ - n[i]
         jr nc,ms_pos
         neg                  ; |q̂ - n[i]|
ms_pos:
         ld l,a
         ld h,0
         add hl,hl
         ld de,qsq
         add hl,de
         ld e,(hl)
         inc hl
         ld d,(hl)            ; DE = qsq[|q̂-n[i]|]
         pop hl
         or a
         sbc hl,de            ; HL = qsq[sum]-qsq[diff] = q̂ * n[i]
         ld a,(ms_mc)
         add a,l
         ld c,a               ; C = low(product) + mc
         ld a,h
         adc a,0
         ld (ms_mc),a         ; new mc = high(product) + carry
         ; window[i] -= C + bw  (fold incoming borrow into CF first, see note)
         ld a,(ms_bw)
         rrca                 ; CF = bw (bit0 -> carry)
         ld a,(ix+0)
         sbc a,c              ; window[i] - (low+mc) - bw
         ld (ix+0),a
         sbc a,a
         and 1
         ld (ms_bw),a         ; new bw = 1 if it underflowed
         inc ix
         ld a,(mscnt)
         dec a
         ld (mscnt),a
         jp nz,ms_lp
         ; final top digit U[j+128] -= mc + bw
         ld a,(ms_bw)
         rrca                 ; CF = bw
         ld a,(ix+0)
         ld hl,ms_mc
         sbc a,(hl)           ; top - mc - bw
         ld (ix+0),a
         sbc a,a
         and 1
         ld (topbrw),a        ; topbrw = 1 if the whole subtraction underflowed
         ret

; ----------------------------------------------------------------------------
; NOTE (this was the first bug): a digit must subtract TWO things — the
; partial-product low byte and the incoming borrow — but emit ONE outgoing
; borrow.  Chaining `sub` then `sbc` would subtract the first borrow twice.
; The fix folds the incoming borrow into the carry flag (`ld a,(ms_bw):rrca`,
; bit0 -> CF) and then does a single `sbc a,c`.
; ----------------------------------------------------------------------------

; ============================================================================
; addback: window U[j..j+128] (IX) += n ; sets topcry.
; Correction step when mulsub over-subtracted (q̂ too big).  n-pointer = shadow
; HL (walks up); B is the djnz counter, so the shadow pointer is only touched
; inside balanced EXX pairs.  inc rr / djnz / EXX all preserve CF, so the carry
; chains across the 128 bytes; the carry out of the top digit goes to topcry.
; ============================================================================
addback:
         exx
         ld hl,n              ; shadow HL = &n[0]
         exx
         or a                 ; clear carry (no carry-in)
         ld b,128
ab_lp:
         ld a,(ix+0)          ; window[i]
         exx
         adc a,(hl)           ; + n[i] + carry
         inc hl               ; advance shadow n-pointer
         exx                  ; CF survives EXX
         ld (ix+0),a
         inc ix
         djnz ab_lp           ; loop 128 bytes (CF preserved)
         ld a,(ix+0)          ; final top digit
         adc a,0              ; + carry
         ld (ix+0),a
         ld a,0
         rla                  ; A = carry out of the top digit
         ld (topcry),a
         ret

; ============================================================================
; qsq[x] = floor(x*x/4), x = 0..510, 16-bit little-endian (1022-byte table).
; Quarter-square identity:  a*b = floor((a+b)^2/4) - floor((a-b)^2/4)
;                                = qsq[a+b] - qsq[|a-b|]
; Exact for integers because (a+b) and (a-b) share parity, so the two floors
; differ by exactly a*b.  Built at assembly time with DUP/EDUP.
; ============================================================================
qsq:
qx = 0
         DUP 511
         dw (qx*qx)/4
qx = qx+1
         EDUP
