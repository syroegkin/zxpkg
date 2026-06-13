; pkg_dot.asm — the real `.pkg` esxDOS/NextZXOS dot command (v2).
; Loads at $2000 (esxDOS dot-command load address).  v2 parses the command tail
; and dispatches a subcommand:
;
;   .pkg                 scan /DOT, identify each file -> /INSTALLED.DAT (v1 default)
;   .pkg list            list packages compatible with this machine
;   .pkg search <term>   list packages whose name contains <term>
;   .pkg info <name>     full details for one package
;   .pkg scan            same as bare `.pkg`
;   .pkg help            usage
;   .pkg install/update/remove   recognised; not wired in v2 (see below)
;
; All the dispatch + handler + printing logic lives in pkg_main.inc.asm, shared
; verbatim with the headless test harness pkg_shell_esx.asm (`make esx-shell`),
; so what we ship is exactly what CI exercises.  install/update are NOT wired into
; this binary in v2 — they pull in the full Rabin/SHA crypto stack (~4 KB) and need
; network/staging; they are validated standalone by `make esx-install`/`esx-update`.
;
; HARDWARE NOTES (only fully verifiable on a real Next / classic esxDOS machine):
;  * COMMAND TAIL: esxDOS enters a dot command with HL = start of the tail and
;    DE = end (one past the last char); length = DE - HL.  *** This register
;    convention is the one thing still to confirm on hardware. ***  We capture it
;    as the very first thing (before any RST that would clobber HL/DE), with a
;    guard: a bogus/oversized length falls back to "no args" (== scan).
;  * esxDOS calls a dot command with IY = $5C3A; the cores are IY-free and use no
;    EXX, so RST $10 and the return are safe.
;  * The cores use scratch RAM at $9000.. / $A000 / $C000 / $E000 — fine in our
;    sim (we own RAM), but a production command must coexist with NextZXOS RAM;
;    treat this as a real-hardware experiment, not a polished release.
;
; Build: `make pkg`  ->  PKG (the uploadable dot command; copy to /dot, run `.pkg`).

M_GETSETDRV equ $89

    DEVICE ZXSPECTRUM48
        org $2000
pkg_entry:
        ; --- capture the command tail FIRST (RST $1601 / RST $08 clobber HL/DE) ---
        ; CONFIRMED ON REAL HW via `.pkgdiag`: esxDOS enters a dot command with
        ; HL = start of the tail (already past the command name), terminated by $0D.
        ; DE is the exec address ($2000), NOT the tail end — so we measure the length
        ; ourselves by scanning to the first control byte (CR/NUL), capped at 127.
        ld (ci_in),hl
        ld b,0                 ; B = tail length
pe_scan:
        ld a,(hl)
        cp ' '
        jr c,pe_scanend        ; < $20 (CR / NUL) -> end of tail
        inc hl
        inc b
        ld a,b
        cp 127
        jr c,pe_scan           ; cap the length at 127
pe_scanend:
        ld a,b
        ld (ci_len),a          ; 0 length -> bare `.pkg` (== scan)
pe_setup:
        ld a,2
        call $1601             ; open the upper screen for RST $10
        xor a
        rst $08
        db M_GETSETDRV         ; A = default drive
        ld (id_drive),a
        call pkg_run           ; parse tail -> dispatch -> handler (pkg_main)
        ret                    ; return to esxDOS

        INCLUDE "pkg_main.inc.asm"
pkg_end:

        SAVEBIN "PKG", pkg_entry, pkg_end - pkg_entry

; NOTE: there's no sim-test snapshot for THIS binary — $2000 is ROM on a bare 48K,
; and esxDOS dot commands only get RAM there via divMMC paging $0000-$3FFF, which
; our API-level ZEsarUX handler does NOT do.  So this $2000 image runs only on real
; hardware (or a full divMMC+firmware setup).  The identical dispatch/query/format
; logic IS exercised headlessly at $8000 by `make esx-shell` (pkg_shell_esx.asm),
; and scan is covered by `make esx-identify`.
