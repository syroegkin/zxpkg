; smoke_esx.asm — prove the ZEsarUX esxDOS handler pipeline end-to-end.
; Creates /PKGTEST.TXT on the (host-backed) esxDOS drive and writes a line via
; the RST $08 file API, then halts.  If esxdos_root/PKGTEST.TXT appears with the
; text, the environment works.  Built as a snapshot so ZEsarUX boots straight in.
; Build: sjasmplus smoke_esx.asm  ->  smoke_esx.sna

F_OPEN      equ $9a
F_CLOSE     equ $9b
F_WRITE     equ $9e
M_GETSETDRV equ $89
FA_OPEN_CREAT_WRITE equ $0a     ; FA_OPEN_CREAT($08) | FA_WRITE($02)

    DEVICE ZXSPECTRUM48
        org $8000
start:
        di
        ld sp,$7ff0
        ; A = current default drive
        xor a
        rst $08
        db M_GETSETDRV
        ld (drive),a
        ; open/create the file for writing.  Pointer goes in BOTH IX and HL:
        ; ZEsarUX's handler reads IX (upper-RAM caller), but real esxDOS in a dot
        ; command reads HL — set both so the same code works in sim and on HW.
        ld a,(drive)
        ld ix,fname
        push ix
        pop hl
        ld b,FA_OPEN_CREAT_WRITE
        rst $08
        db F_OPEN              ; -> A = handle, CF on error
        jr c,fail
        ld (fhandle),a
        ; write the payload
        ld a,(fhandle)
        ld ix,fdata
        push ix
        pop hl
        ld bc,fdata_end-fdata
        rst $08
        db F_WRITE
        ; close
        ld a,(fhandle)
        rst $08
        db F_CLOSE
        ld a,1
        ld (status),a         ; 1 = reached the end OK
done:
        halt
        jr done
fail:
        ld a,$ff
        ld (status),a
        halt
        jr fail

fname:   db "/PKGTEST.TXT", 0
fdata:   db "hello from z80 via esxdos", 13, 10
fdata_end:
drive:   db 0
fhandle: db 0
status:  db 0

        SAVESNA "smoke_esx.sna", start
