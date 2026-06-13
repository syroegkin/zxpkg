; install_esx.asm — `.pkg install` driver as a ZEsarUX snapshot.  Gets the
; default drive, then loads/verifies/installs the staged artifact (see
; install_core.inc.asm).  Build: sjasmplus install_esx.asm -> install_esx.sna
; Run via `make esx-install`.

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
        db M_GETSETDRV         ; A = default drive
        ld (in_drive),a
        call install_run
done:
        halt
        jr done

        INCLUDE "rabin_core.inc.asm"
        INCLUDE "bn_core.inc.asm"
        INCLUDE "sha_core.inc.asm"
        INCLUDE "sha_stream.inc.asm"
        INCLUDE "install_core.inc.asm"

        SAVESNA "install_esx.sna", start
