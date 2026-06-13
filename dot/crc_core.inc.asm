; crc_core.inc.asm — CRC-32C (Castagnoli) for the Z80, the ZXPkg identity hash
; (spec §3).  Byte-at-a-time, table-driven; bit-for-bit identical to the portal
; (portal/src/lib/crc32c.ts):
;   reflected polynomial 0x82F63B78, init 0xFFFFFFFF, reflect in/out, xorout 0xFFFFFFFF.
; Pure: uses A/BC/DE/HL/IX only (no IY, no EXX).
;
; crc value is 4 little-endian bytes at crcval (crcval+0 = least significant).

crctab   equ $E000          ; 256 * 4-byte table (1 KiB), built by crc_make_table
crcval   equ $E400          ; current/result CRC (4 bytes, little-endian)

; crc_make_table: fill crctab[n] = reflected CRC-32C of the single byte n.
; c starts as n; eight times: shift right one bit, and if the bit shifted out
; was 1, XOR the reflected polynomial.  (Run once before crc_compute.)
crc_make_table:
         ld ix,crctab
         ld c,0               ; n = 0..255
mt_n:
         ld l,c               ; c = n  (DEHL: D=MSB .. L=LSB)
         ld h,0
         ld e,0
         ld d,0
         ld b,8
mt_bit:
         srl d                ; logical >>1 across DEHL; CF = bit shifted out (LSB)
         rr e
         rr h
         rr l
         jr nc,mt_skip
         ld a,d : xor $82 : ld d,a   ; ^ 0x82F63B78 (poly, MSB..LSB)
         ld a,e : xor $f6 : ld e,a
         ld a,h : xor $3b : ld h,a
         ld a,l : xor $78 : ld l,a
mt_skip:
         djnz mt_bit
         ld (ix+0),l          ; store table[n] little-endian
         ld (ix+1),h
         ld (ix+2),e
         ld (ix+3),d
         inc ix : inc ix : inc ix : inc ix
         inc c
         ld a,c
         or a
         jr nz,mt_n           ; until n wraps 255 -> 0
         ret

; crc_compute: DE = &data, BC = length.  Result -> crcval (4 bytes LE).
;   crc = 0xFFFFFFFF; for each byte: crc = (crc>>8) ^ table[(crc ^ byte) & 0xFF];
;   crc ^= 0xFFFFFFFF.   One-shot = init + update + final (used by the parity gate).
crc_compute:
         call crc_init
         call crc_update
         jr crc_final

; crc_init: start a (possibly streamed) CRC — crcval = 0xFFFFFFFF.
crc_init:
         ld a,$ff
         ld (crcval+0),a
         ld (crcval+1),a
         ld (crcval+2),a
         ld (crcval+3),a
         ret

; crc_update: fold BC bytes at DE into crcval (no init, no final).  Call repeatedly
; for streaming (crc_init once before, crc_final once after).
crc_update:
cc_lp:
         ld a,b
         or c
         ret z
         ld a,(de)            ; next data byte
         inc de
         dec bc
         ld hl,crcval
         xor (hl)             ; A = (crc & 0xFF) ^ byte  = table index
         ld l,a
         ld h,0
         add hl,hl
         add hl,hl            ; HL = index * 4
         push de              ; save data pointer
         ld de,crctab
         add hl,de            ; HL -> table[index]
         ; crc = (crc>>8) ^ table[index]  (read crcN before overwriting it)
         ld a,(crcval+1) : xor (hl) : ld (crcval+0),a : inc hl
         ld a,(crcval+2) : xor (hl) : ld (crcval+1),a : inc hl
         ld a,(crcval+3) : xor (hl) : ld (crcval+2),a : inc hl
         ld a,(hl)       :            ld (crcval+3),a   ; high byte of crc>>8 is 0
         pop de
         jr cc_lp

; crc_final: apply the output XOR (0xFFFFFFFF) to crcval.
crc_final:
         ld a,(crcval+0) : cpl : ld (crcval+0),a
         ld a,(crcval+1) : cpl : ld (crcval+1),a
         ld a,(crcval+2) : cpl : ld (crcval+2),a
         ld a,(crcval+3) : cpl : ld (crcval+3),a
         ret
