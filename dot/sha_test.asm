; sha_test.asm — SHA-256 known-answer correctness test for ZX Spectrum / Fuse.
; Hashes each embedded test vector (empty, abc, 56-byte, 64xa, 120xa — covering
; 1-block, 2-block, block-boundary and padding edges) and prints name + OK/BAD by
; comparing against the expected digest. Slow but thorough.
; Build: sjasmplus sha_test.asm  ->  sha_test.tap

ventry  equ $B200          ; current vector-table entry pointer
vcount  equ $B202          ; remaining vectors

    DEVICE ZXSPECTRUM48
        org $8000
main:
        ld a,2
        call $1601               ; channel 2 (upper screen)
        ld de,s_title
        call pstr
        ld hl,vectors
        ld (ventry),hl
        ld a,NVEC
        ld (vcount),a
vloop:
        ; print name
        ld ix,(ventry)
        ld l,(ix+0) : ld h,(ix+1)
        ex de,hl
        call pstr
        ld de,s_colon
        call pstr
        ; copy message -> msgbuf, set msglen
        ld ix,(ventry)
        ld a,(ix+4)
        ld (msglen),a
        ld c,(ix+4)
        ld b,0
        ld l,(ix+2) : ld h,(ix+3)
        ld de,msgbuf
        ld a,c
        or a
        jr z,vnocopy
        ldir
vnocopy:
        call sha_full
        call sha_digest
        ; compare digest[0..31] vs expected
        ld ix,(ventry)
        ld l,(ix+5) : ld h,(ix+6)   ; expected ptr
        ld de,digest
        ld b,32
vcmp:
        ld a,(de)
        cp (hl)
        jr nz,vbad
        inc de
        inc hl
        djnz vcmp
        ld de,s_ok
        call pstr
        jr vnext
vbad:
        ld de,s_bad
        call pstr
vnext:
        ld hl,(ventry)
        ld bc,7
        add hl,bc
        ld (ventry),hl
        ld a,(vcount)
        dec a
        ld (vcount),a
        jp nz,vloop
        ld de,s_done
        call pstr
        ret

; ---- print helpers (channel 2 open) ----
pstr:
        ld a,(de)
        or a
        ret z
        rst $10
        inc de
        jr pstr

s_title:  db "SHA-256 known-answer test", 13, 13, 0
s_colon:  db ": ", 0
s_ok:     db "OK", 13, 0
s_bad:    db "BAD", 13, 0
s_done:   db 13, "done.", 13, 0

        INCLUDE "sha_core.inc.asm"
        INCLUDE "sha_test_vectors.inc.asm"
code_end:

; ---- BASIC autoloader: CLEAR VAL "32767": LOAD ""CODE: RANDOMIZE USR VAL "32768"
basic_prog:
        db 0, 10
        dw basic_lend - basic_lbody
basic_lbody:
        db $FD, $B0, $22, "32767", $22, $3A
        db $EF, $22, $22, $AF, $3A
        db $F9, $C0, $B0, $22, "32768", $22
        db $0D
basic_lend:
basic_end:

        EMPTYTAP "sha_test.tap"
        SAVETAP  "sha_test.tap", BASIC, "shatest", basic_prog, basic_end - basic_prog, 10
        SAVETAP  "sha_test.tap", CODE,  "shatest", main, code_end - main, $8000
