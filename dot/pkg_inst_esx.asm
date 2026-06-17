; pkg_inst_esx.asm — headless test harness for the `.pkg-inst` dot (crypto half).
; Runs the SAME pkg_inst_run the dot ships, but at $5E00 (below the $9000+ scratch
; and the crypto buffers, so the ~5KB image fits) under ZEsarUX's esxDOS handler.
; Reads the subcommand from /CMD.TXT, runs it (the install/update verify+copy hits
; real /CACHE + /DOT + /PKG files), and the host checks the resulting files.
; Build via `make esx-pkg-inst`.

M_GETSETDRV equ $89
F_OPEN      equ $9a
F_CLOSE     equ $9b
F_READ      equ $9d
F_WRITE     equ $9e
F_MKDIR     equ $aa
FA_READ     equ $01
FA_OPEN_CREAT_WRITE equ $0a

ph_fh    equ $9300          ; harness file handle (1)
ph_cnt   equ $9302          ; bytes read from /CMD.TXT (2)
cmdbuf   equ $b400          ; the command tail read from /CMD.TXT

    DEVICE ZXSPECTRUM48
        org $5e00
start:
        di
        ld sp,$8ff0
        xor a
        rst $08
        db M_GETSETDRV
        ld (in_drive),a
        ; read /CMD.TXT -> cmdbuf
        ld a,(in_drive)
        ld ix,cmdname
        push ix
        pop hl
        ld b,FA_READ
        rst $08
        db F_OPEN
        jr c,no_cmd
        ld (ph_fh),a
        ld a,(ph_fh)
        ld ix,cmdbuf
        push ix
        pop hl
        ld bc,127
        rst $08
        db F_READ
        ld (ph_cnt),bc
        ld a,(ph_fh)
        rst $08
        db F_CLOSE
        ld hl,cmdbuf
        ld (pi_in),hl
        ld bc,(ph_cnt)         ; strip trailing control chars (CR/LF)
strip:
        ld a,b
        or c
        jr z,lenset
        ld hl,cmdbuf
        add hl,bc
        dec hl
        ld a,(hl)
        cp ' '
        jr nc,lenset
        dec bc
        jr strip
lenset:
        ld a,c
        ld (pi_len),a
        jr run
no_cmd:
        xor a
        ld (pi_len),a
run:
        ld a,2
        call $1601
        call pkg_inst_run
        di
        halt

cmdname: db "/CMD.TXT", 0

        DEFINE TEST_INST       ; install dir = /DOT in the sim (esxDOS sim lacks M_DOSVERSION)
        INCLUDE "pkg_inst_main.inc.asm"

        SAVESNA "pkg_inst_esx.sna", start
