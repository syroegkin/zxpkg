; pkgclean.asm — a `.pkgclean` dot command that DELETES every file the ZXPkg PoC
; pushes onto the Next, so the card is left clean.  NextSync only ever *pushes*
; files (it can't remove remote ones), so the cleanup has to run on the device:
; this command F_UNLINKs each artifact and prints the result.
;
; It deletes, in order:
;   /PKG/INDEX.DAT   /INSTALL.DAT   /dot/PKGDIAG   /dot/PKG
; i.e. the data first, then the other dot commands.  It does NOT delete itself —
; HW-confirmed that a dot command can't F_UNLINK its own file while running (it
; stays open) — so remove /dot/PKGCLEAN by hand (or .browse) after running this.
;
; Like the other dots it touches only its own image + the stack + esxDOS calls
; (filename pointer = IX), no $9000+ scratch.
;
; Build: `make pkgclean` -> PKGCLEAN  (push with the others; run `.pkgclean`).

M_GETSETDRV equ $89
F_UNLINK    equ $ad

    DEVICE ZXSPECTRUM48
        org $2000
clean:
        ld a,2
        call $1601             ; open the upper screen for RST $10
        xor a
        rst $08
        db M_GETSETDRV         ; A = default drive
        ld (drive),a

        ld hl,s_ban
        call pstr
        call crlf

        ld hl,paths            ; walk the ASCIIZ list (empty string = end)
cl_loop:
        ld a,(hl)
        or a
        jr z,cl_done
        push hl                ; remember this path's start
        call unlink_path
        pop hl
cl_skip:                       ; advance HL past this ASCIIZ entry
        ld a,(hl)
        inc hl
        or a
        jr nz,cl_skip
        jr cl_loop
cl_done:
        ret

; unlink_path: HL -> ASCIIZ path.  F_UNLINK it, then print "<path> ok|FAIL".
; May trash registers; the caller keeps its own copy of HL.
unlink_path:
        push hl                ; keep path for printing
        push hl
        pop ix                 ; IX = filename pointer (esxDOS convention)
        ld a,(drive)
        rst $08
        db F_UNLINK            ; CF=1 on error (e.g. already gone)
        ld a,0
        adc a,0                ; A = 1 if the delete failed, 0 if ok
        ld (ures),a
        pop hl                 ; path again
        call pstr              ; print the path
        ld a,' '
        rst $10
        ld a,(ures)
        or a
        ld hl,s_ok
        jr z,up_msg
        ld hl,s_fail
up_msg:
        call pstr
        jp crlf

; pstr: print the NUL-terminated string at HL.
pstr:
        ld a,(hl)
        or a
        ret z
        rst $10
        inc hl
        jr pstr
crlf:
        ld a,13
        rst $10
        ret

; --- data (in the loaded image = RAM, so writable) ---
drive:  db 0
ures:   db 0

paths:
        db "/PKG/INDEX.DAT", 0
        db "/INSTALL.DAT", 0
        db "/dot/PKGDIAG", 0
        db "/dot/PKG-INST", 0
        db "/dot/PKG-GET", 0
        db "/dot/PKG", 0
        db 0                     ; empty string -> end of list
                                 ; (NOT /dot/PKGCLEAN — a running dot can't unlink itself)

s_ban:  db "ZXPkg cleanup:", 0
s_ok:   db "ok", 0
s_fail: db "FAIL", 0
clean_end:

        SAVEBIN "PKGCLEAN", clean, clean_end - clean
