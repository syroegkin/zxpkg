; sha_zx.asm — SHA-256 timing demo for ZX Spectrum / Fuse (core in sha_core.inc).
; Prints SHA-256("abc") for correctness, then times NBLK block-compressions using
; the 50 Hz FRAMES counter (true Spectrum seconds even under Fuse turbo) and prints
; both the timing and the resulting digest of the timed run.
; Build: sjasmplus sha_zx.asm  ->  sha_zx.tap

NBLK    equ 64
FRAMES  equ 23672
blk     equ $9000          ; abc block buffer
deltaf  equ $B302          ; elapsed frames
lz      equ $B304          ; pdec16 leading-zero flag
tcount  equ $B306          ; timing loop counter

    DEVICE ZXSPECTRUM48
        org $8000
main:
        ld a,2
        call $1601
        ld de,s_title
        call pstr
        ; build padded "abc" block
        ld hl,blk
        ld (hl),0
        ld de,blk+1
        ld bc,63
        ldir
        ld a,$61 : ld (blk+0),a
        ld a,$62 : ld (blk+1),a
        ld a,$63 : ld (blk+2),a
        ld a,$80 : ld (blk+3),a
        ld a,$18 : ld (blk+63),a
        ; --- correctness: hash one block, print digest ---
        call sha_init
        ld hl,blk
        ld (blkptr),hl
        call sha_block
        call sha_digest
        ld de,s_dig
        call pstr
        call print_digest
        ld de,s_expect
        call pstr
        ; --- timing: NBLK blocks ---
        ld de,s_tim
        call pstr
        call sha_init
        ld hl,blk
        ld (blkptr),hl
        ld hl,(FRAMES)
        push hl
        ld a,NBLK
        ld (tcount),a
tm_lp:
        call sha_block
        ld a,(tcount)
        dec a
        ld (tcount),a
        jr nz,tm_lp
        ld hl,(FRAMES)
        pop de
        or a
        sbc hl,de
        ld (deltaf),hl
        call pdec16               ; frames
        ld de,s_frames
        call pstr
        ld hl,(deltaf)           ; seconds = frames/50
        call div50
        ld l,c : ld h,b
        call pdec16
        ld a,'.'
        rst $10
        ld hl,(deltaf)           ; tenths = (frames mod 50)/5
        call div50
        ld de,5
        ld a,'0'
t_lp:
        or a
        sbc hl,de
        jr c,t_done
        inc a
        jr t_lp
t_done:
        rst $10
        ld a,'s'
        rst $10
        call pcrlf
        ; end result: digest of the timed run
        call sha_digest
        ld de,s_res
        call pstr
        call print_digest
        ret

print_digest:                    ; print 32 bytes at `digest` as hex
        ld hl,digest
        ld b,32
pd_lp:
        ld a,(hl)
        call phex8
        inc hl
        djnz pd_lp
        jp pcrlf

; ---- print helpers ----
pstr:
        ld a,(de)
        or a
        ret z
        rst $10
        inc de
        jr pstr
pcrlf:
        ld a,13
        rst $10
        ret
phex8:
        push af
        rra : rra : rra : rra
        call phnib
        pop af
phnib:
        and $0f
        add a,$90
        daa
        adc a,$40
        daa
        rst $10
        ret
pdec16:                          ; print HL unsigned decimal, no leading zeros
        ld a,1
        ld (lz),a
        ld de,10000 : call pdig
        ld de,1000  : call pdig
        ld de,100   : call pdig
        ld de,10    : call pdig
        ld a,l
        add a,'0'
        rst $10
        ret
pdig:
        ld c,'0'
pd_l:
        or a
        sbc hl,de
        jr c,pd_d
        inc c
        jr pd_l
pd_d:
        add hl,de
        ld a,c
        cp '0'
        jr nz,pd_emit
        ld a,(lz)
        or a
        ret nz
        ld a,'0'
        rst $10
        ret
pd_emit:
        xor a
        ld (lz),a
        ld a,c
        rst $10
        ret
div50:                           ; HL/50 -> BC=quotient, HL=remainder
        ld bc,0
dv_l:
        or a
        ld de,50
        sbc hl,de
        jr c,dv_d
        inc bc
        jr dv_l
dv_d:
        add hl,de
        ret

s_title:  db "ZXPkg SHA-256 timing", 13, 13, 0
s_dig:    db "abc: ", 0
s_expect: db "exp: ba7816bf...f20015ad", 13, 13, 0
s_tim:    db "64 blk: ", 0
s_frames: db " fr = ", 0
s_res:    db "res: ", 0

        INCLUDE "sha_core.inc.asm"
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

        EMPTYTAP "sha_zx.tap"
        SAVETAP  "sha_zx.tap", BASIC, "sha", basic_prog, basic_end - basic_prog, 10
        SAVETAP  "sha_zx.tap", CODE,  "sha", main, code_end - main, $8000
