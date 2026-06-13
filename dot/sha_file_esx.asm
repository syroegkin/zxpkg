; sha_file_esx.asm — test driver for streaming SHA-256: hash /HASHME (any size)
; via the esxDOS file API and write the 32-byte digest to /SHA.DAT.
; Build: sjasmplus sha_file_esx.asm -> sha_file_esx.sna ; run via `make esx-sha-file`.

F_OPEN      equ $9a
F_CLOSE     equ $9b
F_READ      equ $9d
F_WRITE     equ $9e
M_GETSETDRV equ $89
FA_READ     equ $01
FA_OPEN_CREAT_WRITE equ $0a

sfx_drive   equ $9780
sfx_oh      equ $9781

    DEVICE ZXSPECTRUM48
        org $8000
start:
        di
        ld sp,$7ff0
        xor a
        rst $08
        db M_GETSETDRV
        ld (sfx_drive),a
        ; open /HASHME for reading
        ld a,(sfx_drive)
        ld ix,hashname
        ld b,FA_READ
        rst $08
        db F_OPEN
        jr c,sfx_done
        ld (sf_fh),a
        ; stream-hash it -> digest
        call sha_fd
        ld a,(sf_fh)
        rst $08
        db F_CLOSE
        ; write the digest to /SHA.DAT
        ld a,(sfx_drive)
        ld ix,outname
        ld b,FA_OPEN_CREAT_WRITE
        rst $08
        db F_OPEN
        jr c,sfx_done
        ld (sfx_oh),a
        ld a,(sfx_oh)
        ld ix,digest
        ld bc,32
        rst $08
        db F_WRITE
        ld a,(sfx_oh)
        rst $08
        db F_CLOSE
sfx_done:
        halt
        jr sfx_done

hashname: db "/HASHME", 0
outname:  db "/SHA.DAT", 0

        INCLUDE "sha_core.inc.asm"
        INCLUDE "sha_stream.inc.asm"

        SAVESNA "sha_file_esx.sna", start
