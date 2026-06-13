; identify_esx.asm — `.pkg scan` (with identification) as a ZEsarUX snapshot.
; CRCs each /DOT file, looks the CRC up in /ZXPKG/INDEX.DAT, writes /ZXPKG/INSTALL.DAT.
; Build: sjasmplus identify_esx.asm -> identify_esx.sna ; run via `make esx-identify`.

M_GETSETDRV equ $89

    DEVICE ZXSPECTRUM48
        org $8000
start:
        di
        ld sp,$7ff0
        xor a
        rst $08
        db M_GETSETDRV
        ld (id_drive),a
        call identify_run
done:
        halt
        jr done

scan_tick:                      ; headless sim has no open screen channel -> no-op
        ret

        INCLUDE "crc_core.inc.asm"
        INCLUDE "index_core.inc.asm"
        INCLUDE "identify_core.inc.asm"

        SAVESNA "identify_esx.sna", start
