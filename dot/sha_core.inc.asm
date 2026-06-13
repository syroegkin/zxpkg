; sha_core.inc — SHA-256 core (optimised) shared by the harness and ZX builds.
; INCLUDE this AFTER your own `org` + entry code. Provides:
;   sha_init   - H = IV
;   sha_block  - compress the 64-byte block at (blkptr) into H
;   sha_full   - hash msgbuf[0..msglen-1] (<=180 bytes): pad + all blocks -> H
;   sha_digest - write H (big-endian, 32 bytes) to `digest`
; 32-bit words are little-endian; rotations are byte-aligned + shortest-direction
; residual single-bit rotates (inlined); word ops use DE=dst/HL=src pointers.

hbuf    equ $A000          ; H[0..7]
av      equ $A020          ; working a..h (8 x 4)
bv      equ $A024
cv      equ $A028
dv      equ $A02C
ev      equ $A030
fv      equ $A034
gv      equ $A038
hv      equ $A03C
t1      equ $A040
t2      equ $A044
tmp     equ $A048
tmp2    equ $A04C
xbuf    equ $A050
s0buf   equ $A054
s1buf   equ $A058
sgt     equ $A05C
wbuf    equ $A100          ; W[0..63]
tcnt    equ $A200
kptr    equ $A201
wptr    equ $A203
blkptr  equ $A205          ; pointer to current 64-byte block
pf_len  equ $A207          ; sha_full: message length
pf_nblk equ $A208          ; sha_full: block count
pf_pad  equ $A209          ; sha_full: padded length (2)
pf_ctr  equ $A20B          ; sha_full: block loop counter
padbuf  equ $A300          ; padded message (<=256 bytes = 4 blocks)
digest  equ $A400          ; 32-byte big-endian output
msgbuf  equ $B000          ; message input
msglen  equ $B100          ; message length (bytes)

    MACRO MOV32 dst,src
    ld hl,src : ld de,dst
    ldi : ldi : ldi : ldi
    ENDM
    MACRO XOR32 dst,src
    ld de,dst : ld hl,src
    ld a,(de) : xor (hl) : ld (de),a : inc de : inc hl
    ld a,(de) : xor (hl) : ld (de),a : inc de : inc hl
    ld a,(de) : xor (hl) : ld (de),a : inc de : inc hl
    ld a,(de) : xor (hl) : ld (de),a
    ENDM
    MACRO AND32 dst,src
    ld de,dst : ld hl,src
    ld a,(de) : and (hl) : ld (de),a : inc de : inc hl
    ld a,(de) : and (hl) : ld (de),a : inc de : inc hl
    ld a,(de) : and (hl) : ld (de),a : inc de : inc hl
    ld a,(de) : and (hl) : ld (de),a
    ENDM
    MACRO ADD32 dst,src
    ld de,dst : ld hl,src
    ld a,(de) : add a,(hl) : ld (de),a : inc de : inc hl
    ld a,(de) : adc a,(hl) : ld (de),a : inc de : inc hl
    ld a,(de) : adc a,(hl) : ld (de),a : inc de : inc hl
    ld a,(de) : adc a,(hl) : ld (de),a
    ENDM
    MACRO ROTRC dst,src,nn
    ld a,(src + ((0 + ((nn+4)/8)) & 3)) : ld (dst+0),a
    ld a,(src + ((1 + ((nn+4)/8)) & 3)) : ld (dst+1),a
    ld a,(src + ((2 + ((nn+4)/8)) & 3)) : ld (dst+2),a
    ld a,(src + ((3 + ((nn+4)/8)) & 3)) : ld (dst+3),a
    ld hl,dst
    IF (nn - 8*((nn+4)/8)) > 0
    DUP (nn - 8*((nn+4)/8))
    ld a,(hl) : rrca : inc hl : inc hl : inc hl : rr (hl) : dec hl : rr (hl) : dec hl : rr (hl) : dec hl : rr (hl)
    EDUP
    ELSE
    DUP (8*((nn+4)/8) - nn)
    inc hl : inc hl : inc hl : ld a,(hl) : rlca : dec hl : dec hl : dec hl : rl (hl) : inc hl : rl (hl) : inc hl : rl (hl) : inc hl : rl (hl) : dec hl : dec hl : dec hl
    EDUP
    ENDIF
    ENDM
    MACRO SHRC dst,src,nn
    IF ((0 + (nn/8)) < 4)
    ld a,(src + (0 + (nn/8))) : ld (dst+0),a
    ELSE
    xor a : ld (dst+0),a
    ENDIF
    IF ((1 + (nn/8)) < 4)
    ld a,(src + (1 + (nn/8))) : ld (dst+1),a
    ELSE
    xor a : ld (dst+1),a
    ENDIF
    IF ((2 + (nn/8)) < 4)
    ld a,(src + (2 + (nn/8))) : ld (dst+2),a
    ELSE
    xor a : ld (dst+2),a
    ENDIF
    IF ((3 + (nn/8)) < 4)
    ld a,(src + (3 + (nn/8))) : ld (dst+3),a
    ELSE
    xor a : ld (dst+3),a
    ENDIF
    ld hl,dst
    DUP (nn & 7)
    inc hl : inc hl : inc hl : srl (hl) : dec hl : rr (hl) : dec hl : rr (hl) : dec hl : rr (hl)
    EDUP
    ENDM
    MACRO SUM0 dst,src
    ROTRC dst,src,2
    ROTRC sgt,src,13
    XOR32 dst,sgt
    ROTRC sgt,src,22
    XOR32 dst,sgt
    ENDM
    MACRO SUM1 dst,src
    ROTRC dst,src,6
    ROTRC sgt,src,11
    XOR32 dst,sgt
    ROTRC sgt,src,25
    XOR32 dst,sgt
    ENDM
    MACRO SIG0 dst,src
    ROTRC dst,src,7
    ROTRC sgt,src,18
    XOR32 dst,sgt
    SHRC sgt,src,3
    XOR32 dst,sgt
    ENDM
    MACRO SIG1 dst,src
    ROTRC dst,src,17
    ROTRC sgt,src,19
    XOR32 dst,sgt
    SHRC sgt,src,10
    XOR32 dst,sgt
    ENDM

sha_init:
        ld hl,iv
        ld de,hbuf
        ld bc,32
        ldir
        ret

; sha_full: hash msgbuf[0..(msglen)-1] (length <= 180) -> H
sha_full:
        call sha_init
        ld a,(msglen)
        ld (pf_len),a
        ; copy message to padbuf
        ld hl,msgbuf
        ld de,padbuf
        ld c,a
        ld b,0
        or a
        jr z,pf_pad80          ; empty message
        ldir                   ; DE -> padbuf + len
pf_pad80:
        ld a,$80               ; append the 1 bit
        ld (de),a
        inc de                 ; DE -> first zero-fill byte
        ; nblocks = (len + 72) >> 6
        ld a,(pf_len)
        add a,72
        rrca : rrca : rrca : rrca : rrca : rrca
        and 3
        ld (pf_nblk),a
        ; padded length = nblocks * 64
        ld l,a
        ld h,0
        add hl,hl : add hl,hl : add hl,hl : add hl,hl : add hl,hl : add hl,hl
        ld (pf_pad),hl
        ; zero-fill from DE up to padbuf + padlen
        ld hl,padbuf
        ld bc,(pf_pad)
        add hl,bc              ; HL = end (padbuf + padlen)
        or a
        sbc hl,de             ; HL = end - DE = count of zero bytes
        ld b,h
        ld c,l
pf_zl:
        ld a,b
        or c
        jr z,pf_len_field
        xor a
        ld (de),a
        inc de
        dec bc
        jr pf_zl
pf_len_field:
        ; write 64-bit big-endian bit length into the last 8 bytes (top 6 already 0)
        ld hl,padbuf
        ld bc,(pf_pad)
        add hl,bc
        dec hl                ; HL -> last byte (low byte of length)
        ld a,(pf_len)
        add a,a : add a,a : add a,a   ; A = (len*8) & 0xFF
        ld (hl),a
        dec hl
        ld a,(pf_len)
        rrca : rrca : rrca : rrca : rrca
        and 7                 ; A = len >> 5  (high byte of len*8)
        ld (hl),a
        ; process all blocks
        ld hl,padbuf
        ld (blkptr),hl
        ld a,(pf_nblk)
        ld (pf_ctr),a
pf_blk:
        call sha_block
        ld hl,(blkptr)
        ld bc,64
        add hl,bc
        ld (blkptr),hl
        ld a,(pf_ctr)
        dec a
        ld (pf_ctr),a
        jr nz,pf_blk
        ret

; IY-free (uses HL for the output pointer) so the whole SHA core leaves IY=$5C3A
; intact — safe to run with interrupts on (see bn_core.inc header).
sha_digest:
        ld ix,hbuf
        ld hl,digest
        ld b,8
sd_lp:
        ld a,(ix+3) : ld (hl),a : inc hl
        ld a,(ix+2) : ld (hl),a : inc hl
        ld a,(ix+1) : ld (hl),a : inc hl
        ld a,(ix+0) : ld (hl),a : inc hl
        ld de,4
        add ix,de
        djnz sd_lp
        ret

; sha_block: compress the 64-byte block at (blkptr) into H
sha_block:
        ld hl,(blkptr)
        ld de,wbuf
        ld b,16
wl_lp:
        push de
        inc de : inc de : inc de
        ld a,(hl) : ld (de),a : inc hl : dec de
        ld a,(hl) : ld (de),a : inc hl : dec de
        ld a,(hl) : ld (de),a : inc hl : dec de
        ld a,(hl) : ld (de),a : inc hl
        pop de
        inc de : inc de : inc de : inc de
        djnz wl_lp
        ld a,16
        ld (tcnt),a
        ld hl,wbuf+64
        ld (wptr),hl
sch_lp:
        ld ix,(wptr)
        push ix : pop hl : ld de,-8  : add hl,de : call copy4x
        SIG1 s1buf,xbuf
        push ix : pop hl : ld de,-60 : add hl,de : call copy4x
        SIG0 s0buf,xbuf
        push ix : pop de : ld hl,s1buf : call mov32p
        push ix : pop de : push ix : pop hl : ld bc,-28 : add hl,bc : call add32p
        push ix : pop de : ld hl,s0buf : call add32p
        push ix : pop de : push ix : pop hl : ld bc,-64 : add hl,bc : call add32p
        ld hl,(wptr) : inc hl : inc hl : inc hl : inc hl : ld (wptr),hl
        ld a,(tcnt) : inc a : ld (tcnt),a
        cp 64
        jp nz,sch_lp
        ld hl,hbuf
        ld de,av
        ld bc,32
        ldir
        xor a
        ld (tcnt),a
        ld hl,kbuf
        ld (kptr),hl
        ld hl,wbuf
        ld (wptr),hl
rnd_lp:
        MOV32 t1,hv
        SUM1 tmp,ev
        ADD32 t1,tmp
        MOV32 tmp,fv : XOR32 tmp,gv : AND32 tmp,ev : XOR32 tmp,gv
        ADD32 t1,tmp
        ld de,t1 : ld hl,(kptr) : call add32p
        ld de,t1 : ld hl,(wptr) : call add32p
        SUM0 t2,av
        MOV32 tmp,av : AND32 tmp,bv
        MOV32 tmp2,av : XOR32 tmp2,bv : AND32 tmp2,cv
        XOR32 tmp,tmp2
        ADD32 t2,tmp
        MOV32 hv,gv : MOV32 gv,fv : MOV32 fv,ev
        MOV32 ev,dv : ADD32 ev,t1
        MOV32 dv,cv : MOV32 cv,bv : MOV32 bv,av
        MOV32 av,t1 : ADD32 av,t2
        ld hl,(kptr) : inc hl : inc hl : inc hl : inc hl : ld (kptr),hl
        ld hl,(wptr) : inc hl : inc hl : inc hl : inc hl : ld (wptr),hl
        ld a,(tcnt) : inc a : ld (tcnt),a
        cp 64
        jp nz,rnd_lp
        ADD32 hbuf+0,av
        ADD32 hbuf+4,bv
        ADD32 hbuf+8,cv
        ADD32 hbuf+12,dv
        ADD32 hbuf+16,ev
        ADD32 hbuf+20,fv
        ADD32 hbuf+24,gv
        ADD32 hbuf+28,hv
        ret

copy4x:
        ld de,xbuf
        ld bc,4
        ldir
        ret
mov32p:
        ld bc,4
        ldir
        ret
add32p:
        or a
        ld b,4
ap_lp:
        ld a,(de)
        adc a,(hl)
        ld (de),a
        inc de
        inc hl
        djnz ap_lp
        ret

iv:
        dd $6a09e667, $bb67ae85, $3c6ef372, $a54ff53a
        dd $510e527f, $9b05688c, $1f83d9ab, $5be0cd19
kbuf:
        dd $428a2f98, $71374491, $b5c0fbcf, $e9b5dba5, $3956c25b, $59f111f1, $923f82a4, $ab1c5ed5
        dd $d807aa98, $12835b01, $243185be, $550c7dc3, $72be5d74, $80deb1fe, $9bdc06a7, $c19bf174
        dd $e49b69c1, $efbe4786, $0fc19dc6, $240ca1cc, $2de92c6f, $4a7484aa, $5cb0a9dc, $76f988da
        dd $983e5152, $a831c66d, $b00327c8, $bf597fc7, $c6e00bf3, $d5a79147, $06ca6351, $14292967
        dd $27b70a85, $2e1b2138, $4d2c6dfc, $53380d13, $650a7354, $766a0abb, $81c2c92e, $92722c85
        dd $a2bfe8a1, $a81a664b, $c24b8b70, $c76c51a3, $d192e819, $d6990624, $f40e3585, $106aa070
        dd $19a4c116, $1e376c08, $2748774c, $34b0bcb5, $391c0cb3, $4ed8aa4a, $5b9cca4f, $682e6ff3
        dd $748f82ee, $78a5636f, $84c87814, $8cc70208, $90befffa, $a4506ceb, $bef9a3f7, $c67178f2
