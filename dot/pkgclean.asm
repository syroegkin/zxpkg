; pkgclean.asm — a `.pkgclean` dot command that DELETES every file ZXPkg
; pushes onto the Next, so the card is left clean.  NextSync only ever *pushes*
; files (it can't remove remote ones), so the cleanup has to run on the device:
; this command F_UNLINKs each artifact and prints the result.
;
; It removes, in order:
;   1. data files:  /ZXPKG/INDEX.DAT  /ZXPKG/INSTALL.DAT
;   2. the other dots: /dot/PKGDIAG /dot/PKG-INST /dot/PKG-GET /dot/PKG
;   3. everything staged under /ZXPKG/CACHE/ (readdir + unlink each file)
;   4. the now-empty dirs: F_RMDIR /ZXPKG/CACHE then /ZXPKG  -> no empty dirs left.
; It does NOT delete itself — HW-confirmed that a dot command can't F_UNLINK its
; own file while running (it stays open) — so remove /dot/PKGCLEAN by hand (or
; .browse) after running this.
;
; Uses $9000+ scratch for the readdir entry + path assembly (free in dot context).
;
; *** the cache-empty + rmdir path is assemble-verified only (no headless pkgclean
;     test exists; like the rest of this dot it is HW-validated). ***
;
; Build: `make pkgclean` -> PKGCLEAN  (push with the others; run `.pkgclean`).

M_GETSETDRV equ $89
F_CLOSE     equ $9b
F_OPENDIR   equ $a3
F_READDIR   equ $a4
F_RMDIR     equ $ab
F_UNLINK    equ $ad

dirent      equ $9100          ; readdir entry: [attr][ASCIIZ name]
pathbuf     equ $9200          ; "/ZXPKG/CACHE/<name>" assembly

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

        ; --- 1+2: unlink the fixed file list (data files, then the other dots) ---
        ld hl,paths            ; walk the ASCIIZ list (empty string = end)
cl_loop:
        ld a,(hl)
        or a
        jr z,cl_files_done
        push hl                ; remember this path's start
        call unlink_path
        pop hl
cl_skip:                       ; advance HL past this ASCIIZ entry
        ld a,(hl)
        inc hl
        or a
        jr nz,cl_skip
        jr cl_loop
cl_files_done:
        ; --- 3: empty /ZXPKG/CACHE, then 4: drop the now-empty dirs ---
        call empty_cache
        ld hl,cachedir : call rmdir_path     ; /ZXPKG/CACHE
        ld hl,zxpkgdir : call rmdir_path     ; /ZXPKG
        ret

; empty_cache: unlink every file in /ZXPKG/CACHE.  Re-opens the dir after each
; delete (restart scan) so we never mutate a directory we're iterating — safe and
; the cache is tiny.  Subdir entries (. ..) carry attr bit $10 and are skipped;
; when only those remain, F_READDIR returns A=0 and we stop.
empty_cache:
ec_again:
        ld a,(drive)
        ld ix,cachedir
        push ix
        pop hl
        ld b,0
        rst $08
        db F_OPENDIR
        ret c                  ; no /ZXPKG/CACHE -> nothing to empty
        ld (dirh),a
ec_find:
        ld a,(dirh)
        ld ix,dirent
        push ix
        pop hl
        rst $08
        db F_READDIR
        or a
        jr z,ec_close_done     ; A=0 -> no (more) entries
        ld a,(dirent)
        and $10
        jr nz,ec_find          ; skip directories (. ..)
        ; a file: close the dir, unlink it, then restart the scan
        ld a,(dirh)
        rst $08
        db F_CLOSE
        call ec_buildpath      ; pathbuf = "/ZXPKG/CACHE/" + (dirent+1)
        ld a,(drive)
        ld ix,pathbuf
        push ix
        pop hl
        rst $08
        db F_UNLINK
        jr ec_again
ec_close_done:
        ld a,(dirh)
        rst $08
        db F_CLOSE
        ret

; ec_buildpath: pathbuf = "/ZXPKG/CACHE/" + (dirent+1)
ec_buildpath:
        ld hl,cacheprefix
        ld de,pathbuf
        ld bc,cacheprefix_len
        ldir
        ld hl,dirent+1
ecb_lp:
        ld a,(hl)
        ld (de),a
        or a
        ret z
        inc hl
        inc de
        jr ecb_lp

; unlink_path: HL -> ASCIIZ path.  F_UNLINK it, then print "<path> ok|FAIL".
; May trash registers; the caller keeps its own copy of HL.
unlink_path:
        push hl                ; keep path for printing
        push hl
        pop ix                 ; IX = filename pointer (esxDOS convention)
        ld a,(drive)
        rst $08
        db F_UNLINK            ; CF=1 on error (e.g. already gone)
        jr report

; rmdir_path: HL -> ASCIIZ dir path.  F_RMDIR it, then print "<path> ok|FAIL".
rmdir_path:
        push hl
        push hl
        pop ix
        ld a,(drive)
        rst $08
        db F_RMDIR             ; CF=1 on error (e.g. already gone / not empty)
        ; fall through to report

; report: CF=delete/rmdir result, [SP] = path ptr to print.  Prints "<path> ok|FAIL".
report:
        ld a,0
        adc a,0                ; A = 1 if it failed, 0 if ok
        ld (ures),a
        pop hl                 ; path again
        call pstr              ; print the path
        ld a,' '
        rst $10
        ld a,(ures)
        or a
        ld hl,s_ok
        jr z,rp_msg
        ld hl,s_fail
rp_msg:
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
dirh:   db 0

paths:
        db "/ZXPKG/INDEX.DAT", 0
        db "/ZXPKG/INSTALL.DAT", 0
        db "/dot/PKGDIAG", 0
        db "/dot/PKG-INST", 0
        db "/dot/PKG-GET", 0
        db "/dot/PKG", 0
        db 0                     ; empty string -> end of list
                                 ; (NOT /dot/PKGCLEAN — a running dot can't unlink itself)

cachedir:    db "/ZXPKG/CACHE", 0
zxpkgdir:    db "/ZXPKG", 0
cacheprefix: db "/ZXPKG/CACHE/"
cacheprefix_len equ $ - cacheprefix

s_ban:  db "ZXPkg cleanup:", 0
s_ok:   db "ok", 0
s_fail: db "FAIL", 0
clean_end:

        SAVEBIN "PKGCLEAN", clean, clean_end - clean
