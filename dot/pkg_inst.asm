; pkg_inst.asm — the `.pkg-inst` dot command (crypto half of ZXPkg): install/update
; with signature verification.  Thin $2000 front-end; the logic + crypto cores live
; in pkg_inst_main.inc.asm (shared with the pkg_inst_esx test harness).
;   .pkg-inst install <name>   /ZXPKG/CACHE/<name>(+.SIG) -> /DOT/<name>   (sig-gated)
;   .pkg-inst update           /ZXPKG/CACHE/INDEX.DAT(+.SIG) -> /ZXPKG/INDEX.DAT
; Build: `make pkg-inst` -> PKG-INST  (copy to /dot on the SD; run `.pkg-inst ...`).

M_GETSETDRV equ $89
F_OPEN      equ $9a
F_CLOSE     equ $9b
F_READ      equ $9d
F_WRITE     equ $9e
F_MKDIR     equ $aa
FA_READ     equ $01
FA_OPEN_CREAT_WRITE equ $0a

    DEVICE ZXSPECTRUM48
        org $2000
entry:
        ; capture the command tail FIRST (HL = start, CR-terminated; DE = exec addr).
        ld (pi_in),hl
        ld b,0
e_scan:
        ld a,(hl)
        cp ' '
        jr c,e_scanend
        inc hl
        inc b
        ld a,b
        cp 127
        jr c,e_scan
e_scanend:
        ld a,b
        ld (pi_len),a
        ld a,2
        call $1601             ; open the upper screen for RST $10
        xor a
        rst $08
        db M_GETSETDRV
        ld (in_drive),a
        call pkg_inst_run
        ret

        INCLUDE "pkg_inst_main.inc.asm"
pkg_inst_end:

        SAVEBIN "PKG-INST", entry, pkg_inst_end - entry
