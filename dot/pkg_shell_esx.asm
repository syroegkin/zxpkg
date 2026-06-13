; pkg_shell_esx.asm — headless test harness for the `.pkg` dispatch/query/format
; path.  Runs at $8000 under ZEsarUX's esxDOS host-dir handler (so, unlike the real
; $2000 dot command, it CAN be sim-run).  It exercises the EXACT same pkg_run logic
; the dot command ships, via pkg_main.inc.asm compiled with TEST_OUT (output goes
; to a buffer instead of the screen).
;
; Flow per run:
;   1. read the command tail from /CMD.TXT  -> ci_in / ci_len
;   2. pkg_run   (loads /PKG/INDEX.DAT itself, dispatches, formats into outbuf)
;   3. write outbuf -> /OUT.TXT
; The host (`make esx-shell`) writes /CMD.TXT, runs this, and checks /OUT.TXT
; against output it derives from the same index.json — a Node<->Z80 parity check
; of the whole command surface.  Only query commands are driven here (scan is
; covered by `make esx-identify`).
;
; Build: sjasmplus pkg_shell_esx.asm -> pkg_shell_esx.sna (boots straight in).

M_GETSETDRV equ $89

sh_fileh   equ $9070          ; harness file handle (1)
sh_count   equ $9072          ; bytes read from /CMD.TXT (2)
cmdbuf     equ $B400          ; the command tail read from /CMD.TXT

    DEFINE TEST_OUT           ; route pkg_putc into outbuf (see pkg_main.inc.asm)

    DEVICE ZXSPECTRUM48
        org $5e00              ; below the $9000+ scratch: the merged pkg_main (with
start:                        ; the crypto stack) is ~7.9KB, so at $8000 it would
        di                    ; collide with its own buffers.  Code $5E00..~$7CCD,
        ld sp,$8ff0           ; stack in the free $8xxx gap, scratch $9000+.
        ; default drive for all file ops
        xor a
        rst $08
        db M_GETSETDRV
        ld (id_drive),a

        ; init the TEST_OUT collector
        ld hl,outbuf
        ld (out_cur),hl

        ; --- read the command tail from /CMD.TXT ---
        ld a,(id_drive)
        ld ix,sh_cmdname
        ld b,FA_READ
        rst $08
        db F_OPEN
        jr c,sh_nocmd          ; no /CMD.TXT -> empty tail (== scan, not driven here)
        ld (sh_fileh),a
        ld a,(sh_fileh)
        ld ix,cmdbuf
        ld bc,127
        rst $08
        db F_READ
        ld (sh_count),bc       ; capture count before F_CLOSE clobbers BC
        ld a,(sh_fileh)
        rst $08
        db F_CLOSE
        ld hl,cmdbuf
        ld (ci_in),hl
        ; strip any trailing control chars (CR/LF) the host may leave
        ld bc,(sh_count)
sh_strip:
        ld a,b
        or c
        jr z,sh_lenset
        ld hl,cmdbuf
        add hl,bc
        dec hl                 ; -> last byte
        ld a,(hl)
        cp ' '
        jr nc,sh_lenset        ; >= space -> real char, keep
        dec bc
        jr sh_strip
sh_lenset:
        ld a,c
        ld (ci_len),a          ; tail < 128 bytes
        jr sh_run
sh_nocmd:
        xor a
        ld (ci_len),a
sh_run:
        call pkg_run

        ; --- write outbuf -> /OUT.TXT (host rm -f's it first, so create = exact) ---
        ld a,(id_drive)
        ld ix,sh_outname
        ld b,FA_OPEN_CREAT_WRITE
        rst $08
        db F_OPEN
        ld (sh_fileh),a
        ld hl,(out_cur)
        ld de,outbuf
        or a
        sbc hl,de              ; HL = bytes collected
        ld b,h
        ld c,l
        ld a,(sh_fileh)
        ld ix,outbuf
        rst $08
        db F_WRITE
        ld a,(sh_fileh)
        rst $08
        db F_CLOSE
sh_halt:
        di
        halt                   ; ZEsarUX never auto-exits; the host timeout kills it

        INCLUDE "pkg_main.inc.asm"

sh_cmdname: db "/CMD.TXT", 0
sh_outname: db "/OUT.TXT", 0

        SAVESNA "pkg_shell_esx.sna", start
