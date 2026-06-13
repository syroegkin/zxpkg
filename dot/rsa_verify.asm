; rsa_verify.asm — PoC: s^3 mod n (RSA-1024/e=3 verify core) on Z80.
; Multiply : Comba (product scanning) + quarter-square 8x8 table.
; Reduction: base-256 long division (Knuth TAOCP Alg. D) — divisor is the RSA
;            modulus, already normalised (top bit set), so no pre-scaling needed.
; Harness measures T-states.  Assemble: sjasmplus --raw=rsa_verify.bin rsa_verify.asm
;
;   $9000 n[128]      $9080 s[128]      $9100 exp_s3[128]   $9180 exp_s2[128]
;   $A000 res_s3[128] $A080 res_s2[128]
;   $A100 P[257] dividend/product (P[256] = virtual top digit)
;   $A210 rmd[128] remainder      $A300 t_buf[128]
;   $A400.. scalar working vars

NLEN     equ 128

n        equ $9000
s        equ $9080
res_s3   equ $A000
res_s2   equ $A080
P        equ $A100
rmd      equ $A210
t_buf    equ $A300

mul_a    equ $A400
mul_b    equ $A402
acc2     equ $A411
kcol     equ $A412
cnt      equ $A413
jidx     equ $A414          ; Alg.D quotient position 128..0
qhat     equ $A415          ; estimated quotient digit
vtop     equ $A416          ; n[127] (divisor top digit)
mscnt    equ $A417          ; multiply-subtract inner counter
topbrw   equ $A418          ; borrow out of window top
topcry   equ $A419          ; carry out of window top (add-back)
ms_mc    equ $A41A          ; mulsub: multiply carry
ms_bw    equ $A41B          ; mulsub: subtract borrow

         org $8000
main:
         ld sp,$BFFF
         ; s2 = (s * s) mod n  -> res_s2, t_buf
         ld hl,s
         ld (mul_a),hl
         ld hl,s
         ld (mul_b),hl
         call mul_bn
         call mod_bn
         ld hl,rmd
         ld de,res_s2
         ld bc,NLEN
         ldir
         ld hl,rmd
         ld de,t_buf
         ld bc,NLEN
         ldir
         ; s3 = (t_buf * s) mod n  -> res_s3
         ld hl,t_buf
         ld (mul_a),hl
         ld hl,s
         ld (mul_b),hl
         call mul_bn
         call mod_bn
         ld hl,rmd
         ld de,res_s3
         ld bc,NLEN
         ldir
         halt

         INCLUDE "bn_core.inc.asm"
