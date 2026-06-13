; update_esx.asm — `.pkg update` driver as a ZEsarUX snapshot.  Verifies the
; staged /CACHE/INDEX.DAT against its .sig and the embedded key, and stores it as
; the local trusted index /PKG/INDEX.DAT only if valid (install_core update_run).
; Build: sjasmplus update_esx.asm -> update_esx.sna ; run via `make esx-update`.

M_GETSETDRV equ $89
F_OPEN      equ $9a
F_CLOSE     equ $9b
F_READ      equ $9d
F_WRITE     equ $9e
FA_READ     equ $01
FA_OPEN_CREAT_WRITE equ $0a

    DEVICE ZXSPECTRUM48
        org $8000
start:
        di
        ld sp,$7ff0
        xor a
        rst $08
        db M_GETSETDRV
        ld (in_drive),a
        call update_run
done:
        halt
        jr done

        INCLUDE "rabin_core.inc.asm"
        INCLUDE "bn_core.inc.asm"
        INCLUDE "sha_core.inc.asm"
        INCLUDE "sha_stream.inc.asm"
        INCLUDE "install_core.inc.asm"

        SAVESNA "update_esx.sna", start
