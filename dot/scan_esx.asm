; scan_esx.asm — `.pkg scan` driver as a ZEsarUX snapshot.  Gets the default
; drive, builds the CRC table, scans /DOT writing /SCAN.DAT, then halts.
; Run:  zesarux ... --enable-esxdos-handler --esxdos-root-dir <dir> --snap scan_esx.sna
; (see `make esx-scan`).  Build: sjasmplus scan_esx.asm -> scan_esx.sna

M_GETSETDRV equ $89

    DEVICE ZXSPECTRUM48
        org $8000
start:
        di
        ld sp,$7ff0
        xor a
        rst $08
        db M_GETSETDRV         ; A = default drive
        ld (sc_drive),a
        call crc_make_table
        call scan_run
done:
        halt
        jr done

        INCLUDE "crc_core.inc.asm"
        INCLUDE "scan_core.inc.asm"

        SAVESNA "scan_esx.sna", start
