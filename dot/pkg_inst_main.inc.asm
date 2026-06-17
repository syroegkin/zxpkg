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
ip_src   equ $9100          ; "/ZXPKG/CACHE/<name>"
ip_sig   equ $9140          ; "/ZXPKG/CACHE/<name>.SIG"
ip_dst   equ $9180          ; "/DOT/<name>"
; smart-device install: name->cmd/ver resolution + gopher selector build
rf_cmd   equ $9060          ; resolved command {ptr(2), len(1)} into idxbuf
rf_ver   equ $9063          ; resolved version {ptr(2), len(1)} into idxbuf
if_name  equ $9066          ; current record's name {ptr(2), len(1)} (compare temp)
nm_p     equ $9069          ; target name pointer (saved from pi_arg) (2)
nm_l     equ $906b          ; target name length (1)
iv_p     equ $906d          ; requested version pointer (iv_l=0 -> latest) (2) — clear of if_fh
iv_l     equ $906f          ; requested version length (1)
if_fh    equ $906c          ; index file handle (1)
cmd_buf  equ $9070          ; resolved CMD as ASCIIZ, reused as pi_arg (<=16)
sel_buf  equ $9400          ; gopher selector "<prefix>/artifacts/<name>/<ver>/<CMD>(.sig)"
idxbuf   equ $A000          ; loaded /ZXPKG/INDEX.DAT (<=8KB; free until vi_run)
; registry server config — from /ZXPKG/SERVER ("host port prefix") or defaults
cfg_host equ $9080          ; server host, ASCIIZ (<=32)
cfg_port equ $90A0          ; server port, ASCIIZ (<=8)
cfg_pfx  equ $90A8          ; selector prefix e.g. /pkg, ASCIIZ (<=16)
cfgbuf   equ $90C0          ; /ZXPKG/SERVER read buffer (<=63 + NUL)
F_UNLINK equ $ad            ; esxDOS delete-file (for transient cache cleanup)

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
; message — used by the BASIC installer before it stages files into /ZXPKG/CACHE ----
do_setup:
        ld de,s_setupok
        jp pstr

; ensure_dirs: F_MKDIR /ZXPKG then /ZXPKG/CACHE (parent first), ignoring errors (dir-exists is fine).
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

; ---- install <name> : resolve via /ZXPKG/INDEX.DAT, fetch-if-needed (WiFi), verify -> /DOT/<CMD> ----
; <name> is the registry id (lowercase).  idx_find maps it to the CMD + version; we
; build /ZXPKG/CACHE/<CMD>(+.SIG) and /DOT/<CMD>, then: if the artifact is already
; staged in the cache use it (lets the sim test the verify path without ESP), else
; gopher-fetch it from the registry.  vi_run does the Rabin+SHA verify either way.
do_install:
        ld a,(pi_alen)
        or a
        jp z,di_usage
        call parse_name_ver       ; split arg -> nm_p/nm_l (name) + iv_p/iv_l (opt version)
        call idx_find             ; name(+version) -> rf_cmd/rf_ver ; CF=1 if not in index
        jp c,di_noreg
        call use_cmd_as_arg       ; copy CMD to cmd_buf, repoint pi_arg/pi_alen at it
        ld hl,ip_src : ld (mk_dst),hl
        ld hl,s_cachepre : ld de,s_empty  : call mk_path   ; /ZXPKG/CACHE/<CMD>
        ld hl,ip_sig : ld (mk_dst),hl
        ld hl,s_cachepre : ld de,s_sigsuf : call mk_path   ; /ZXPKG/CACHE/<CMD>.SIG
        ld hl,ip_dst : ld (mk_dst),hl
        call pick_install_dir : ld de,s_empty : call mk_path  ; /DOT (NextZXOS) or /BIN (esxDOS)
        call cache_present        ; CF=0 if /ZXPKG/CACHE/<CMD> already staged
        jr nc,di_verify
        ld de,s_fetching : call pstr
        call net_fetch            ; build selector + gf_run artifact & .sig ; CF=1 on failure
        jp c,di_fetcherr
di_verify:
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
di_noreg:
        ld de,s_inst_noreg : jp pstr
di_fetcherr:
        ld de,s_inst_neterr : jp pstr
di_usage:
        ld de,s_inst_usage : jp pstr

; ---- update : /ZXPKG/CACHE/INDEX.DAT(+.SIG) -> /ZXPKG/INDEX.DAT ----
do_update:
        call ensure_index_staged          ; fetch /pkg/index/v1.dat(+sig) over WiFi (or use staged)
        jp c,du_neterr
        call update_run
        ld a,(in_status)
        cp 1 : jr z,du_ok
        cp 2 : jr z,du_bad
        ld de,s_upd_io : jp pstr
du_ok:
        call del_cache_index              ; transient: drop the staged index so next update refetches
        ld de,s_upd_ok : jp pstr
du_bad:
        ld de,s_upd_bad : jp pstr
du_neterr:
        ld de,s_inst_neterr : jp pstr

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

; parse_name_ver: split the install argument (pi_arg/pi_alen) into a name token
; (nm_p/nm_l) and an optional version token (iv_p/iv_l; iv_l=0 when absent).
;   e.g. "morse 1.1.0" -> name="morse", ver="1.1.0";  "morse" -> name="morse", ver=""
parse_name_ver:
        ld hl,(pi_arg)
        ld a,(pi_alen)
        ld b,a
        ld (nm_p),hl              ; name token
        ld c,0
pnv_n:
        ld a,b : or a : jr z,pnv_nend
        ld a,(hl) : cp ' ' : jr z,pnv_nend
        inc hl : dec b : inc c : jr pnv_n
pnv_nend:
        ld a,c : ld (nm_l),a
pnv_sk:                           ; skip spaces between name and version
        ld a,b : or a : jr z,pnv_none
        ld a,(hl) : cp ' ' : jr nz,pnv_v
        inc hl : dec b : jr pnv_sk
pnv_v:
        ld (iv_p),hl              ; version token
        ld c,0
pnv_vl:
        ld a,b : or a : jr z,pnv_vend
        ld a,(hl) : cp ' ' : jr z,pnv_vend
        inc hl : dec b : inc c : jr pnv_vl
pnv_vend:
        ld a,c : ld (iv_l),a
        ret
pnv_none:
        xor a : ld (iv_l),a
        ret

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

; idx_find: resolve the registry name (pi_arg/pi_alen) to its CMD + version by
; walking the local /ZXPKG/INDEX.DAT (spec §6) loaded into idxbuf.  On success
; CF=0 with rf_cmd/rf_ver = {ptr,len} into idxbuf; CF=1 if there's no index or the
; name isn't in it.  Record = [u32 crc][mach][os][feat][u24 size] then 5 length-
; prefixed strings: type, cmd, name, ver, desc.
idx_find:
        ; nm_p/nm_l (name) and iv_p/iv_l (optional version) are set by parse_name_ver.
        ld a,(in_drive)                   ; load /ZXPKG/INDEX.DAT into idxbuf
        ld ix,pkgdst                      ; "/ZXPKG/INDEX.DAT" (defined in install_core)
        push ix : pop hl
        ld b,FA_READ
        rst $08
        db F_OPEN
        ret c                             ; no index -> CF=1
        ld (if_fh),a
        ld ix,idxbuf
        push ix : pop hl
        ld bc,$2000                       ; up to 8 KB
        rst $08
        db F_READ
        ld a,(if_fh)
        rst $08
        db F_CLOSE
        ld hl,idxbuf
        ld a,(hl)                         ; schema_ver
        cp 1
        jr nz,if_nf                       ; unknown schema -> treat as not found
        inc hl                            ; skip schema_ver
        inc hl                            ; skip key_id
        ld e,(hl) : inc hl
        ld d,(hl) : inc hl                ; DE = record_count, HL -> first record
if_rec:
        ld a,d : or e
        jr z,if_nf                        ; out of records -> not found
        dec de
        push de
        ld bc,10 : add hl,bc              ; skip crc(4)+mach+os+feat+size(3)
        call if_skip                      ; type
        ld ix,rf_cmd : call if_capture    ; cmd  -> rf_cmd
        ld ix,if_name : call if_capture   ; name -> if_name (compare temp)
        ld ix,rf_ver : call if_capture    ; ver  -> rf_ver
        call if_skip                      ; desc
        call if_namematch                 ; Z if record name == target
        jr nz,if_miss                     ; name differs -> next record
        ld a,(iv_l)                        ; name matches; was a specific version asked?
        or a
        jr z,if_hit                       ; no -> first match wins (records are latest-first)
        call if_vermatch                  ; Z if this record's version == requested
        jr z,if_hit
if_miss:
        pop de
        jr if_rec
if_hit:
        pop de
if_found:
        or a                              ; CF=0
        ret
if_nf:
        scf
        ret

; if_capture: HL -> [len][bytes...].  Store ptr->(IX+0/1), len->(IX+2); advance HL.
if_capture:
        ld a,(hl)
        ld (ix+2),a
        inc hl
        ld (ix+0),l
        ld (ix+1),h
        ld c,a : ld b,0
        add hl,bc
        ret
; if_skip: HL -> [len][bytes...]; advance HL past it.
if_skip:
        ld a,(hl)
        inc hl
        ld c,a : ld b,0
        add hl,bc
        ret
; if_namematch: Z if if_name == target (nm_p/nm_l), case-folded.
if_namematch:
        ld a,(if_name+2)
        ld hl,nm_l
        cp (hl)
        ret nz                            ; lengths differ
        or a : ret z                      ; both empty -> equal
        ld b,a
        ld hl,(if_name)
        ld de,(nm_p)
inm_lp:
        ld a,(de) : call tolower_a : ld c,a
        ld a,(hl) : call tolower_a
        cp c
        ret nz
        inc hl : inc de : djnz inm_lp
        xor a                             ; Z = equal
        ret

; if_vermatch: Z if the record's version (rf_ver) equals the requested version
; (iv_p/iv_l), exact byte match.
if_vermatch:
        ld a,(rf_ver+2)
        ld hl,iv_l
        cp (hl)
        ret nz                            ; lengths differ
        or a : ret z                      ; both empty -> equal
        ld b,a
        ld hl,(rf_ver)
        ld de,(iv_p)
ivm_lp:
        ld a,(de) : ld c,a
        ld a,(hl) : cp c
        ret nz
        inc hl : inc de : djnz ivm_lp
        xor a                             ; Z = equal
        ret

; use_cmd_as_arg: copy rf_cmd (the resolved command) to cmd_buf as ASCIIZ and point
; pi_arg/pi_alen at it, so the existing mk_path builds /ZXPKG/CACHE/<CMD>, /DOT/<CMD>.
use_cmd_as_arg:
        ld a,(rf_cmd+2)
        ld (pi_alen),a
        ld hl,cmd_buf
        ld (pi_arg),hl
        ld b,a
        ld de,cmd_buf
        ld hl,(rf_cmd)
        or a : jr z,uca_z
uca_lp:
        ld a,(hl) : ld (de),a : inc hl : inc de : djnz uca_lp
uca_z:
        xor a : ld (de),a
        ret

; pick_dotdir: HL = "/DOT/" if a /DOT directory exists (NextZXOS), else "/BIN/" (classic
; esxDOS).  A filesystem probe — robust + testable, no OS-version syscall needed.
; pick_install_dir: HL = "/DOT/" on NextZXOS, "/BIN/" on classic esxDOS.  Uses the same
; reliable signal as `.pkg`'s detect_machine: M_DOSVERSION ($88) returns Fc=1 on esxDOS,
; Fc=0 on NextZXOS.  (HW-validate-pending — no ESP/OS-version emulation in the sim.)
pick_install_dir:
    IFDEF TEST_INST
        ld hl,s_dotpre                    ; headless install test: deterministic /DOT — the
        ret                              ; esxDOS sim doesn't implement M_DOSVERSION ($88) cleanly
    ELSE
        rst $08
        db $88                            ; M_DOSVERSION
        jr c,pid_bin                      ; Fc=1 -> esxDOS -> /BIN
        ld hl,s_dotpre                    ; NextZXOS -> /DOT
        ret
pid_bin:
        ld hl,s_binpre
        ret
    ENDIF

; cache_present: CF=0 if /ZXPKG/CACHE/<CMD> (ip_src) already exists, else CF=1.
cache_present:
        ld a,(in_drive)
        ld ix,ip_src
        push ix : pop hl
        ld b,FA_READ
        rst $08
        db F_OPEN
        ret c                             ; absent
        ld (if_fh),a
        rst $08
        db F_CLOSE
        or a                              ; CF=0 present
        ret

; net_fetch: build the selector, then gopher-fetch the artifact -> ip_src and the
; signature -> ip_sig.  CF=1 if either fetch fails (caller refuses).
net_fetch:
        call load_server_cfg              ; cfg_host/cfg_port/cfg_pfx (from /ZXPKG/SERVER or defaults)
        call build_selector               ; sel_buf = <prefix>/artifacts/<name>/<ver>/<CMD>
        ld hl,cfg_host : ld (gf_host),hl
        ld hl,cfg_port : ld (gf_port),hl
        ld hl,sel_buf : ld (gf_sel),hl
        ld hl,ip_src : ld (gf_file),hl
        call gf_run
        ret c
        call sel_append_sig               ; sel_buf += ".sig"
        ld hl,ip_sig : ld (gf_file),hl
        call gf_run
        ret

; ensure_index_staged: refresh /ZXPKG/CACHE/INDEX.DAT(+.SIG) by gopher-fetching
; <prefix>/index/v1.dat(+.sig). On fetch failure, fall back to a pre-staged index
; (keeps the sim test + manual staging working). CF=1 only if neither is available.
ensure_index_staged:
        ld a,(in_drive)                   ; cache-first: use a staged index if present
        ld ix,idxpath
        push ix : pop hl
        ld b,FA_READ
        rst $08
        db F_OPEN
        jr c,eis_fetch                    ; not staged -> fetch over WiFi
        ld (if_fh),a
        rst $08
        db F_CLOSE
        or a                              ; CF=0 -> use the staged index
        ret
eis_fetch:
        call load_server_cfg
        call build_index_selector         ; sel_buf = <prefix>/index/v1.dat
        ld hl,cfg_host : ld (gf_host),hl
        ld hl,cfg_port : ld (gf_port),hl
        ld hl,sel_buf : ld (gf_sel),hl
        ld hl,idxpath : ld (gf_file),hl   ; /ZXPKG/CACHE/INDEX.DAT (from install_core)
        call gf_run
        ret c
        call build_index_selector
        call sel_append_sig               ; sel_buf = <prefix>/index/v1.dat.sig
        ld hl,idxsig : ld (gf_file),hl    ; /ZXPKG/CACHE/INDEX.SIG
        call gf_run
        ret                               ; CF from the sig fetch

; del_cache_index: drop the staged index (+.SIG) after update consumes it, so the
; next update refetches fresh rather than reusing a lingering cache copy.
del_cache_index:
        ld a,(in_drive)
        ld ix,idxpath
        push ix : pop hl
        rst $08
        db F_UNLINK
        ld a,(in_drive)
        ld ix,idxsig
        push ix : pop hl
        rst $08
        db F_UNLINK
        ret

; build_index_selector: sel_buf = <prefix>/index/v1.dat
build_index_selector:
        ld de,sel_buf
        ld hl,cfg_pfx    : call bs_catz
        ld hl,s_indexsel : call bs_catz
        xor a : ld (de),a
        ret

; build_selector: sel_buf = "/artifacts/" + name + "/" + ver + "/" + CMD + NUL.
build_selector:
        ld de,sel_buf
        ld hl,cfg_pfx  : call bs_catz     ; "/pkg" (or "" for a no-prefix dev server)
        ld hl,s_artpre : call bs_catz
        ld hl,(nm_p) : ld a,(nm_l) : call bs_catn
        ld a,'/' : ld (de),a : inc de
        ld hl,(rf_ver) : ld a,(rf_ver+2) : call bs_catn
        ld a,'/' : ld (de),a : inc de
        ld hl,(rf_cmd) : ld a,(rf_cmd+2) : call bs_catn
        xor a : ld (de),a
        ret
bs_catz:
        ld a,(hl) : or a : ret z
        ld (de),a : inc hl : inc de : jr bs_catz
bs_catn:
        or a : ret z
        ld b,a
bsn_lp:
        ld a,(hl) : ld (de),a : inc hl : inc de : djnz bsn_lp
        ret
; sel_append_sig: append ".sig" at the NUL terminator of sel_buf.
sel_append_sig:
        ld hl,sel_buf
sas_f:
        ld a,(hl) : or a : jr z,sas_w
        inc hl : jr sas_f
sas_w:
        ex de,hl
        ld hl,s_sigsel
sas_c:
        ld a,(hl) : ld (de),a : or a : ret z
        inc hl : inc de : jr sas_c

; load_server_cfg: fill cfg_host/cfg_port/cfg_pfx from /ZXPKG/SERVER ("host port
; prefix"), falling back to the compiled defaults (gopher.zx.in.net 70 /pkg). A
; missing file or a missing token just leaves that field at its default.
load_server_cfg:
        ld hl,s_host  : ld de,cfg_host : call strcpy_z   ; defaults first
        ld hl,s_port  : ld de,cfg_port : call strcpy_z
        ld hl,s_defpfx: ld de,cfg_pfx  : call strcpy_z
        ld a,(in_drive)
        ld ix,s_srvcfg
        push ix : pop hl
        ld b,FA_READ
        rst $08
        db F_OPEN
        ret c                             ; no /ZXPKG/SERVER -> keep defaults
        ld (if_fh),a
        ld a,(if_fh)
        ld ix,cfgbuf
        push ix : pop hl
        ld bc,63
        rst $08
        db F_READ                         ; BC = bytes read
        ld a,(if_fh)
        push bc
        rst $08
        db F_CLOSE
        pop bc
        ld hl,cfgbuf
        add hl,bc
        ld (hl),0                         ; NUL-terminate what we read
        ld hl,cfgbuf                      ; parse up to three tokens (empty -> keep default)
        ld de,cfg_host : call cfg_tok
        ld de,cfg_port : call cfg_tok
        ld de,cfg_pfx  : call cfg_tok
        ret

; strcpy_z: copy ASCIIZ HL -> DE (including the NUL).
strcpy_z:
        ld a,(hl) : ld (de),a : or a : ret z
        inc hl : inc de : jr strcpy_z

; cfg_tok: HL -> text. Skip leading blanks; if a token follows, copy it to DE as
; ASCIIZ (overwriting the default); if the line ended, leave DE untouched. HL ends
; just past the token. Separators: space / CR / LF / NUL.
cfg_tok:
        ld a,(hl)                         ; skip blanks
        or a : ret z                      ; end of buffer -> keep default
        cp ' '  : jr z,ctk_sp
        cp 13   : jr z,ctk_sp
        cp 10   : jr z,ctk_sp
        jr ctk_cp
ctk_sp:
        inc hl : jr cfg_tok
ctk_cp:
        ld a,(hl)
        or a : jr z,ctk_end
        cp ' ' : jr z,ctk_end
        cp 13  : jr z,ctk_end
        cp 10  : jr z,ctk_end
        ld (de),a : inc hl : inc de : jr ctk_cp
ctk_end:
        xor a : ld (de),a                 ; NUL-terminate the copied token
        ret

s_install:    db "install", 0
s_update:     db "update", 0
s_setup:      db "setup", 0
s_setupok:    db "dirs ready (/ZXPKG)", 13, 0
s_pkgdir:     db "/ZXPKG", 0
s_cachedir:   db "/ZXPKG/CACHE", 0
s_cachepre:   db "/ZXPKG/CACHE/", 0
s_sigsuf:     db ".SIG", 0
s_dotpre:     db "/DOT/", 0
s_binpre:     db "/BIN/", 0
s_empty:      db 0
s_inst_ok:    db " installed", 13, 0
s_inst_bad:   db "bad signature - refused", 13, 0
s_inst_io:    db "install: staged file missing", 13, 0
s_inst_usage: db "usage: .pkg-inst install <name> [version]", 13, 0
s_inst_noreg: db "not in registry - run .pkg-inst update", 13, 0
s_inst_neterr:db "fetch failed (wifi? driver?)", 13, 0
s_fetching:   db "fetching over wifi...", 13, 0
s_srvcfg:     db "/ZXPKG/SERVER", 0
s_host:       db "gopher.zx.in.net", 0   ; default server host (overridable via /ZXPKG/SERVER)
s_port:       db "70", 0                 ; default port
s_defpfx:     db "/pkg", 0               ; default selector prefix
s_artpre:     db "/artifacts/", 0
s_indexsel:   db "/index/v1.dat", 0
s_sigsel:     db ".sig", 0
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
        INCLUDE "gopher_uart.inc.asm"   ; self-contained ESP-over-UART (no ESPAT driver)
