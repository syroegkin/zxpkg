; pkg_inst_main.inc.asm — shared body of the `.pkg-inst` dot (the crypto half):
; tail parse + subcommand dispatch + install/update handlers + the crypto cores.
; Shared by pkg_inst.asm (the real $2000 dot) and pkg_inst_esx.asm (the $5E00 test
; harness, sim-runnable).  The front-end sets pi_in/pi_len + in_drive, opens the
; RST $10 channel, then calls pkg_inst_run.  The front-end also defines the esxDOS
; command constants (F_OPEN, FA_READ, M_GETSETDRV, ...) before INCLUDEing this.

; parser scratch — below the crypto buffers (install $9600+, sha $A000+, rabin
; $C000+), so nothing overlaps within one invocation.
pi_in    equ $9000          ; command tail pointer (2)
pi_len   equ $9002          ; command tail length (1)
pi_tok   equ $9003          ; subcommand token pointer (2)
pi_tlen  equ $9005          ; subcommand token length (1)
pi_arg   equ $9006          ; argument pointer (2)
pi_alen  equ $9008          ; argument length (1)
mk_dst   equ $900a          ; mk_path destination pointer (2)
ip_src   equ $9100          ; "/CACHE/<name>"
ip_sig   equ $9140          ; "/CACHE/<name>.SIG"
ip_dst   equ $9180          ; "/DOT/<name>"

; pkg_inst_run: parse the tail and dispatch install/update/setup.
pkg_inst_run:
        call ensure_dirs       ; best-effort mkdir /PKG + /CACHE (no setup step needed)
        call parse_tail        ; -> pi_tok/pi_tlen + pi_arg/pi_alen
        ld hl,s_install
        call tok_eq
        jp z,do_install        ; jp: handlers sit past ensure_dirs, out of jr range
        ld hl,s_update
        call tok_eq
        jp z,do_update
        ld hl,s_setup
        call tok_eq
        jr z,do_setup
        ld de,s_usage
        jp pstr

; ---- setup : just the dir creation (ensure_dirs already ran), with a friendly
; message — used by the BASIC installer before it stages files into /CACHE ----
do_setup:
        ld de,s_setupok
        jp pstr

; ensure_dirs: F_MKDIR /PKG and /CACHE, ignoring errors (dir-exists is fine).
ensure_dirs:
        ld a,(in_drive)
        ld ix,s_pkgdir
        push ix
        pop hl
        rst $08
        db F_MKDIR
        ld a,(in_drive)
        ld ix,s_cachedir
        push ix
        pop hl
        rst $08
        db F_MKDIR
        ret

; ---- install <name> : /CACHE/<name>(+.SIG) -> /DOT/<name> ----
do_install:
        ld a,(pi_alen)
        or a
        jr z,di_usage
        ld hl,ip_src : ld (mk_dst),hl
        ld hl,s_cachepre : ld de,s_empty  : call mk_path   ; /CACHE/<name>
        ld hl,ip_sig : ld (mk_dst),hl
        ld hl,s_cachepre : ld de,s_sigsuf : call mk_path   ; /CACHE/<name>.SIG
        ld hl,ip_dst : ld (mk_dst),hl
        ld hl,s_dotpre   : ld de,s_empty  : call mk_path   ; /DOT/<name>
        ld hl,ip_src : ld (vi_src),hl
        ld hl,ip_sig : ld (vi_sig),hl
        ld hl,ip_dst : ld (vi_dst),hl
        call vi_run            ; stream-SHA -> Rabin verify -> copy if valid
        ld a,(in_status)
        cp 1 : jr z,di_ok
        cp 2 : jr z,di_bad
        ld de,s_inst_io : jp pstr
di_ok:
        ld de,ip_dst : call pstr
        ld de,s_inst_ok : jp pstr
di_bad:
        ld de,s_inst_bad : jp pstr
di_usage:
        ld de,s_inst_usage : jp pstr

; ---- update : /CACHE/INDEX.DAT(+.SIG) -> /PKG/INDEX.DAT ----
do_update:
        call update_run
        ld a,(in_status)
        cp 1 : jr z,du_ok
        cp 2 : jr z,du_bad
        ld de,s_upd_io : jp pstr
du_ok:
        ld de,s_upd_ok : jp pstr
du_bad:
        ld de,s_upd_bad : jp pstr

; parse_tail: split (pi_in, pi_len) into a leading token + the remaining argument.
parse_tail:
        ld hl,(pi_in)
        ld a,(pi_len)
        ld b,a
        call pt_skipsp
        ld (pi_tok),hl
        ld c,0
pt_tok:
        ld a,b : or a : jr z,pt_tokend
        ld a,(hl) : cp ' ' : jr z,pt_tokend
        inc hl : dec b : inc c
        jr pt_tok
pt_tokend:
        ld a,c : ld (pi_tlen),a
        call pt_skipsp
        ld (pi_arg),hl
        ld a,b : ld (pi_alen),a
        ret
pt_skipsp:
        ld a,b : or a : ret z
        ld a,(hl) : cp ' ' : ret nz
        inc hl : dec b : jr pt_skipsp

; tok_eq: HL -> ASCIIZ keyword.  Z if it case-folds equal to the token (pi_tok/
; pi_tlen).  Trashes A/BC/DE/HL; pi_tok/pi_tlen preserved.
tok_eq:
        ld a,(pi_tlen)
        ld b,a
        ld de,(pi_tok)
te_lp:
        ld a,(hl)
        or a
        jr z,te_kwend
        ld a,b
        or a
        jr z,te_ne             ; token ran out, keyword didn't
        ld a,(de) : call tolower_a : ld c,a
        ld a,(hl) : call tolower_a
        cp c
        jr nz,te_ne
        inc hl : inc de : dec b
        jr te_lp
te_kwend:
        ld a,b
        or a
        jr nz,te_ne            ; keyword ended but token has more
        xor a                  ; Z = equal
        ret
te_ne:
        or 1                   ; NZ
        ret

; mk_path: build (mk_dst) = <prefix HL> + <pi_arg/pi_alen> + <suffix DE, incl NUL>.
mk_path:
        push de
        ld de,(mk_dst)
mp_pre:
        ld a,(hl) : or a : jr z,mp_pre_e
        ld (de),a : inc hl : inc de : jr mp_pre
mp_pre_e:
        ld a,(pi_alen) : or a : jr z,mp_arg_e
        ld b,a : ld hl,(pi_arg)
mp_arg:
        ld a,(hl) : ld (de),a : inc hl : inc de : djnz mp_arg
mp_arg_e:
        pop hl
mp_suf:
        ld a,(hl) : ld (de),a : or a : ret z
        inc hl : inc de : jr mp_suf

; pstr: print the NUL-terminated string at DE via RST $10.
pstr:
        ld a,(de) : or a : ret z
        rst $10 : inc de : jr pstr

tolower_a:
        cp 'A' : ret c
        cp 'Z'+1 : ret nc
        add a,$20 : ret

s_install:    db "install", 0
s_update:     db "update", 0
s_setup:      db "setup", 0
s_setupok:    db "dirs ready (/PKG /CACHE)", 13, 0
s_pkgdir:     db "/PKG", 0
s_cachedir:   db "/CACHE", 0
s_cachepre:   db "/CACHE/", 0
s_sigsuf:     db ".SIG", 0
s_dotpre:     db "/DOT/", 0
s_empty:      db 0
s_inst_ok:    db " installed", 13, 0
s_inst_bad:   db "bad signature - refused", 13, 0
s_inst_io:    db "install: staged file missing", 13, 0
s_inst_usage: db "usage: .pkg-inst install <name>", 13, 0
s_upd_ok:     db "index updated", 13, 0
s_upd_bad:    db "update: bad signature - refused", 13, 0
s_upd_io:     db "update: no staged index", 13, 0
s_usage:      db "ZXPkg .pkg-inst:", 13
              db " install <name>", 13
              db " update", 13
              db " setup", 13, 0

        INCLUDE "rabin_core.inc.asm"
        INCLUDE "bn_core.inc.asm"
        INCLUDE "sha_core.inc.asm"
        INCLUDE "sha_stream.inc.asm"
        INCLUDE "install_core.inc.asm"
