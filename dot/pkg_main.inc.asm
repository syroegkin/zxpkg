; pkg_main.inc.asm — the shared body of the `.pkg` command: command-tail parsing,
; subcommand dispatch, the handlers, and all RST $10 output formatting.  This is
; the SINGLE source of the dispatch/print logic, shared by two front-ends:
;
;   * pkg_dot.asm     — the real esxDOS/NextZXOS dot command at $2000 (HW only).
;   * pkg_shell_esx.asm — a $8000 esxDOS harness that runs under ZEsarUX so the
;                         whole dispatch->query->format path is testable headless.
;
; Both front-ends have esxDOS file I/O, so the query handlers load the index from
; /ZXPKG/INDEX.DAT themselves (load_index).  The only thing a front-end must set up
; before calling pkg_run is:
;   ci_in / ci_len   = the command tail (pointer + length)        [cmd_core vars]
;   id_drive         = the esxDOS default drive                   [identify_core]
;
; OUTPUT REDIRECTION: every character is emitted through pkg_putc.  In the dot
; build pkg_putc is RST $10 (prints to screen).  When the includer DEFINEs
; TEST_OUT (the headless harness), pkg_putc instead appends to outbuf so the host
; can read back exactly what was printed and check it.  Define TEST_OUT BEFORE
; this include to select the buffer path.
;
; INCLUDE ORDER (this file pulls the cores in for you):
;   index_core -> index_search -> cmd_core -> crc_core -> identify_core, then the
; dispatcher + handlers + printers below.  Do NOT also include those cores in the
; front-end; just `INCLUDE "pkg_main.inc.asm"`.

; ---- scratch owned by pkg_main (chosen to not clash with the live vars of any
;      single subcommand; subcommands are mutually exclusive per invocation) ----
lz         equ $9060          ; pdec16 leading-zero suppression flag (1)
li_fileh   equ $9061          ; load_index file handle (1)
out_cur    equ $9062          ; TEST_OUT output write cursor (2)
qp_count   equ $9064          ; query_print: number of records printed (1)
st_mcount  equ $9067          ; status: # managed (registry-known) files (1)
st_ucount  equ $9068          ; status: # unmanaged files (1)
st_fh      equ $9069          ; status: /INSTALL.DAT file handle (1)
st_len     equ $906a          ; status: bytes read from /INSTALL.DAT (2)
st_endp    equ $906c          ; status: end-of-data pointer (2)
sw_st      equ $906e          ; status walk: current record's status byte (1)
mk_dst     equ $906f          ; mk_path destination buffer pointer (2)
pathbuf2   equ $9500          ; mk_path scratch for remove
instbuf    equ $A000          ; status: the loaded /INSTALL.DAT (reuses idxbuf space)

F_UNLINK   equ $ad            ; esxDOS delete-file (A=drive, pointer in IX+HL)

    IFDEF TEST_OUT
outbuf     equ $B000          ; headless harness: formatted output is collected here
    ENDIF

        INCLUDE "index_core.inc.asm"
        INCLUDE "index_search.inc.asm"
        INCLUDE "cmd_core.inc.asm"
        INCLUDE "crc_core.inc.asm"
        INCLUDE "identify_core.inc.asm"
        ; NB: the crypto stack (Rabin/SHA) lives in the separate `.pkg-inst` dot, not
        ; here — that keeps `.pkg` lean (~3.5KB, classic-esxDOS compatible).

; =====================================================================
; pkg_run — parse the tail, dispatch, run the matching handler.
;   Pre: ci_in/ci_len set, id_drive set (and, under TEST_OUT, out_cur initialised).
; =====================================================================
pkg_run:
        call cmd_parse         ; tok_ptr/len + arg_ptr/len
        call cmd_dispatch      ; -> cmd_id
        ld a,(tok_len)
        or a
        jp z,h_status          ; bare `.pkg` (no subcommand) == status report
        ld a,(cmd_id)
        cp 1 : jp z,h_search
        cp 2 : jp z,h_list
        cp 3 : jp z,h_info
        cp 4 : jp z,h_install
        cp 5 : jp z,h_remove
        cp 6 : jp z,h_help
        cp 7 : jp z,h_scan
        cp 8 : jp z,h_update
        cp 9 : jp z,h_status
        cp 10 : jp z,h_env
        jp h_unknown           ; cmd_id 0

; ---- search <term> : list compatible packages whose name contains <term> ----
h_search:
        ld a,(arg_len)         ; lowercase the term into ndl_buf (names are lower)
        ld (ndl_len),a
        or a
        jr z,h_search_go       ; empty term -> behaves like `list`
        ld b,a
        ld hl,(arg_ptr)
        ld de,ndl_buf
hs_lc:
        ld a,(hl)
        call tolower_a
        ld (de),a
        inc hl
        inc de
        djnz hs_lc
h_search_go:
        call open_index_or_err
        ret c
        call set_machine
        jp query_print

; ---- list : every package compatible with this machine ----
h_list:
        xor a
        ld (ndl_len),a         ; empty needle matches everything
        call open_index_or_err
        ret c
        call set_machine
        jp query_print

; ---- info <name> : full details of one package (exact, case-folded name) ----
h_info:
        ld a,(arg_len)
        or a
        jp z,hi_usage          ; `info` with no name (jp: target now >128B away)
        call open_index_or_err
        ret c
        call info_find         ; sets found_flag; on a hit cur_* = the record
        ld a,(found_flag)
        or a
        jr z,hi_none
        call print_detail
        jp print_versions
hi_none:
        ld de,s_nofound
        jp pstr
hi_usage:
        ld de,s_infousage
        jp pstr

; ---- scan : CRC every /DOT file, name it via the index, write /INSTALL.DAT ----
h_scan:
        call identify_run      ; loads /ZXPKG/INDEX.DAT + walks /DOT (a '.' per file)
        jr c,hs_fail           ; CF = couldn't open index or create the output file
        call pcrlf             ; end the row of progress dots
        ld de,s_scandone
        call pstr
        ld a,(id_count)
        ld l,a
        ld h,0
        call pdec16
        ld de,s_scanfiles
        jp pstr
hs_fail:
        ld de,s_scanfail
        jp pstr

; ---- status : read the installed DB /ZXPKG/INSTALL.DAT (built by scan) and report ----
; Bare `.pkg` runs this.  Instant — no CRC walk; just prints managed packages with
; "name vVER  ok|UPD" and tallies managed vs unmanaged.  Run `.pkg scan` to refresh.
h_status:
        call status_run
        jr c,hs_nocache
        ld de,s_st_tally
        call pstr
        ld a,(st_mcount) : ld l,a : ld h,0 : call pdec16
        ld de,s_st_mid : call pstr
        ld a,(st_ucount) : ld l,a : ld h,0 : call pdec16
        ld de,s_st_end : jp pstr
hs_nocache:
        ld de,s_nocache
        jp pstr

; ---- remove <name> : delete /DOT/<name> (refuses to delete PKG itself) ----
h_remove:
        ld a,(arg_len)
        or a
        jr z,hr_usage
        call arg_is_pkg        ; sanity: never delete the package manager
        jr z,hr_self
        ld hl,pathbuf2 : ld (mk_dst),hl
        ld hl,s_dotpre         ; "/DOT/"
        ld de,s_empty          ; no suffix
        call mk_path           ; pathbuf2 = "/DOT/<name>"
        ld a,(id_drive)
        ld ix,pathbuf2
        push ix
        pop hl
        rst $08
        db F_UNLINK
        jr c,hr_fail
        ld de,pathbuf2 : call pstr
        ld de,s_removed : call pstr
        ld de,s_refresh : jp pstr
hr_fail:
        ld de,pathbuf2 : call pstr
        ld de,s_rmfail : jp pstr
hr_self:
        ld de,s_rmself : jp pstr
hr_usage:
        ld de,s_rmusage
        jp pstr

; ---- install / update : handled by the separate `.pkg-inst` dot (the crypto half).
; Keeping them out of `.pkg` is what keeps it lean + classic-esxDOS compatible.
h_install:
h_update:
        ld de,s_use_inst
        jp pstr

; arg_is_pkg: Z set if the argument case-folds to "pkg".
arg_is_pkg:
        ld a,(arg_len)
        cp 3
        ret nz
        ld hl,(arg_ptr)
        ld a,(hl) : call tolower_a : cp 'p' : ret nz
        inc hl
        ld a,(hl) : call tolower_a : cp 'k' : ret nz
        inc hl
        ld a,(hl) : call tolower_a : cp 'g'
        ret

; ---- help / unknown ----
h_unknown:
        ld de,s_unknown
        call pstr              ; then fall through to the usage text
h_help:
        ld de,s_usage
        jp pstr

; =====================================================================
; helpers
; =====================================================================

; set_machine: set srch_mach to the running machine's known-good bit-mask for the compat
; filter.  The headless query harness (TEST_OUT) forces $FF (show-all) so the fixture tests
; stay deterministic; the shipped dot probes the hardware via detect_machine.
set_machine:
    IFDEF TEST_OUT
        ld a,$FF
        ld (srch_mach),a
        ret
    ELSE
        jp detect_machine
    ENDIF

; detect_machine: probe the platform and set srch_mach (machine_flags bitfield:
; 16k=1 48k=2 128k=4 next=8 zxuno=16).  Refs: NextZXOS API (M_DOSVERSION); z88dk
; esxdos.h; MrKWatkins/ZXSpectrumNextTests (NextReg). M_DOSVERSION ($88): NextZXOS
; returns Fc=0 with B='N',C='X' (-> ZX Next platform); esxDOS returns Fc=1,A=14
; (-> classic Spectrum). Map NextZXOS->next, classic->48k|128k, unknown->$FF (show all).
; Exact 48k/128k (port $7FFD) and ZX-Uno (zxuno regs) tiers, and NextReg $00/$03 machine-id
; refinement (ports $243B/$253B), are future HW work.
detect_machine:
        call os_kind            ; A = 0 esxDOS / 1 NextZXOS / 2 unknown
        cp 1 : jr z,dm_next
        or a : jr z,dm_classic
        ld a,$ff                ; unknown -> show all (warn-not-refuse)
        ld (srch_mach),a
        ret
dm_next:
        ld a,8                  ; ZX Spectrum Next
        ld (srch_mach),a
        ret
dm_classic:
        ld a,6                  ; 48k | 128k (exact tier not probed yet)
        ld (srch_mach),a
        ret

; os_kind: classify the OS via M_DOSVERSION ($88) — A = 1 NextZXOS (Fc=0, B='N',C='X'),
; 0 esxDOS (Fc=1), 2 unknown.  Single source for detect_machine + h_env.
os_kind:
        rst $08
        db $88
        jr c,ok_esx
        ld a,b : cp 'N' : jr nz,ok_unk
        ld a,c : cp 'X' : jr nz,ok_unk
        ld a,1 : ret
ok_esx:
        xor a : ret
ok_unk:
        ld a,2 : ret

; ---- env : runtime diagnostics for hardware testing (no secrets) ----
; Prints the .pkg version, the DETECTED machine set, and the OS — to validate
; detect_machine on real hardware.  Runs the real probe (not the TEST_OUT show-all).
h_env:
        ld de,s_env_hdr : call pstr
        ld de,s_env_mach : call pstr
        call detect_machine             ; real probe -> srch_mach
        ld a,(srch_mach)
        ld (cur_mach),a                 ; print_mach reads cur_mach as a machine_flags bitfield
        call print_mach
        call pcrlf
        ld de,s_env_os : call pstr
        call os_kind                    ; 0 esxDOS / 1 NextZXOS / 2 unknown
        cp 1 : jr z,he_next
        or a : jr z,he_esx
        ld de,s_os_unk : jp pstr
he_next:
        ld de,s_nextzxos : jp pstr
he_esx:
        ld de,s_esxdos : jp pstr

; open_index_or_err: load /ZXPKG/INDEX.DAT and set idxptr.  On failure print a
; friendly message and return CF=1 so the handler bails.
open_index_or_err:
        call load_index
        ret nc
        ld de,s_noindex
        call pstr
        scf
        ret

; load_index: read /ZXPKG/INDEX.DAT into idxbuf (<=8 KB) and point idxptr at it.
; CF=1 if the file can't be opened.  (identify_run loads its own copy; this is the
; query path's copy — same buffer, never used concurrently.)
load_index:
        ld a,(id_drive)
        ld ix,li_idxname
        push ix
        pop hl               ; HL=IX: a dot command's esxDOS calls read the ptr from HL
        ld b,FA_READ
        rst $08
        db F_OPEN
        ret c
        ld (li_fileh),a
        ld a,(li_fileh)
        ld ix,idxbuf
        push ix
        pop hl
        ld bc,$2000
        rst $08
        db F_READ
        ld a,(li_fileh)
        rst $08
        db F_CLOSE
        ld hl,idxbuf
        ld (idxptr),hl
        or a                   ; CF=0 (success)
        ret

; mk_path: build (mk_dst) = <prefix HL, ASCIIZ> + <arg_ptr/arg_len> + <suffix DE,
; ASCIIZ incl. its NUL>.  Caller sets mk_dst (the destination buffer) first.  Used
; by remove (/DOT/<name>) and install (/ZXPKG/CACHE/<name>(+.SIG), /DOT/<name>).
mk_path:
        push de                ; save suffix ptr
        ld de,(mk_dst)
mp_pre:
        ld a,(hl)
        or a
        jr z,mp_pre_end
        ld (de),a
        inc hl
        inc de
        jr mp_pre
mp_pre_end:
        ld a,(arg_len)
        or a
        jr z,mp_arg_end
        ld b,a
        ld hl,(arg_ptr)
mp_arg:
        ld a,(hl)
        ld (de),a
        inc hl
        inc de
        djnz mp_arg
mp_arg_end:
        pop hl                 ; suffix ptr
mp_suf:
        ld a,(hl)
        ld (de),a              ; copy incl. the terminating NUL
        or a
        ret z
        inc hl
        inc de
        jr mp_suf

; print_asciiz: print the NUL-terminated string at HL via pkg_putc.
print_asciiz:
        ld a,(hl)
        or a
        ret z
        call pkg_putc
        inc hl
        jr print_asciiz

; status_run: read the installed DB /INSTALL.DAT into instbuf and print a line per
; managed package + a managed/unmanaged tally.  No CRC walk — scan already did it.
; CF=1 if /INSTALL.DAT can't be opened (run `.pkg scan` first).
status_run:
        ld a,(id_drive)
        ld ix,outname          ; "/INSTALL.DAT" (defined in identify_core)
        push ix
        pop hl
        ld b,FA_READ
        rst $08
        db F_OPEN
        ret c
        ld (st_fh),a
        ld a,(st_fh)
        ld ix,instbuf
        push ix
        pop hl
        ld bc,$2000
        rst $08
        db F_READ
        ld (st_len),bc
        ld a,(st_fh)
        rst $08
        db F_CLOSE
        xor a
        ld (st_mcount),a
        ld (st_ucount),a
        ld hl,instbuf          ; end pointer = instbuf + st_len
        ld de,(st_len)
        add hl,de
        ld (st_endp),hl
        ld hl,instbuf          ; HL = parse cursor
sw_loop:
        ld de,(st_endp)        ; done if HL >= end
        ld a,l
        sub e
        ld a,h
        sbc a,d
        jr nc,sw_done
        ld a,(hl)              ; [fnamelen]
        inc hl
        ld c,a
        ld b,0
        add hl,bc              ; skip the filename
        ld a,(hl)              ; [status]
        inc hl
        ld (sw_st),a
        inc hl                 ; skip the [crc] (4 bytes)
        inc hl
        inc hl
        inc hl
        ld a,(sw_st)
        or a
        jr z,sw_unmanaged
        ld a,(hl)              ; [namelen][name]
        inc hl
        ld b,a
        call print_n
        ld a,' ' : call pkg_putc
        ld a,'v' : call pkg_putc
        ld a,(hl)              ; [verlen][ver]
        inc hl
        ld b,a
        call print_n
        ld a,(sw_st)
        cp 1
        jr nz,sw_upd
        ld de,s_st_ok : call pstr
        jr sw_managed
sw_upd:
        ld de,s_st_upd : call pstr
sw_managed:
        ld a,(st_mcount)
        inc a
        ld (st_mcount),a
        jr sw_loop
sw_unmanaged:
        ld a,(st_ucount)
        inc a
        ld (st_ucount),a
        jr sw_loop
sw_done:
        or a                   ; CF=0 success
        ret

; print_n: print B bytes starting at HL, advancing HL past them.
print_n:
        ld a,b
        or a
        ret z
pn_lp:
        ld a,(hl)
        call pkg_putc
        inc hl
        djnz pn_lp
        ret

; query_print: walk the index at idxptr; print "name vVER" for each record whose
; known-good set overlaps the running machine (cur_mach AND srch_mach != 0) and whose
; name contains ndl_buf (empty needle = all).  Prints "no matches" if nothing qualified.
query_print:
        ld hl,(idxptr)
        call index_open
        ret c
        xor a
        ld (qp_count),a
qp_walk:
        ld hl,(idx_count)
        ld a,h
        or l
        jr z,qp_done
        call index_next
        ld a,(cur_mach)        ; compat: show if machine unspecified, else require overlap
        or a
        jr z,qp_compat         ; machine=0 (unspecified) -> compatible (warn, don't hide)
        ld hl,srch_mach
        and (hl)
        jr z,qp_skip           ; declared a machine set but none overlaps this one
qp_compat:
        call name_match
        or a
        jr z,qp_skip
        call print_summary
        ld a,(qp_count)
        inc a
        ld (qp_count),a
qp_skip:
        jr qp_walk
qp_done:
        ld a,(qp_count)
        or a
        ret nz
        ld de,s_nomatch
        jp pstr

; =====================================================================
; printing — every glyph goes through pkg_putc (screen or test buffer)
; =====================================================================

; scan_tick: per-file scan progress — print one '.'.  Called by identify_run's
; loop (defined here for the dot; the sim front-end stubs it out).
scan_tick:
        ld a,'.'
        jp pkg_putc

; pkg_putc: emit the character in A.  Preserves BC/DE/HL (the print loops below
; rely on that, exactly as ROM RST $10 does).
pkg_putc:
    IFDEF TEST_OUT
        push hl
        ld hl,(out_cur)
        ld (hl),a
        inc hl
        ld (out_cur),hl
        pop hl
    ELSE
        rst $10
    ENDIF
        ret

; print_field: HL = string pointer, B = length.
print_field:
        ld a,b
        or a
        ret z
pf_lp:
        ld a,(hl)
        call pkg_putc
        inc hl
        dec b
        jr nz,pf_lp
        ret

; print_summary: "name vVERSION" + newline  (for list / search).
print_summary:
        ld hl,(cur_name)
        ld a,(cur_name+2)
        ld b,a
        call print_field
        ld a,' '
        call pkg_putc
        ld a,'v'
        call pkg_putc
        ld hl,(cur_ver)
        ld a,(cur_ver+2)
        ld b,a
        call print_field
        jp pcrlf

; print_detail: multi-line record dump (for info).
print_detail:
        ld de,s_name : call pstr
        ld hl,(cur_name) : ld a,(cur_name+2) : ld b,a : call print_field : call pcrlf
        ld de,s_ver  : call pstr
        ld hl,(cur_ver)  : ld a,(cur_ver+2)  : ld b,a : call print_field : call pcrlf
        ld de,s_type : call pstr
        ld hl,(cur_type) : ld a,(cur_type+2) : ld b,a : call print_field : call pcrlf
        ld de,s_cmd  : call pstr
        ld hl,(cur_cmd)  : ld a,(cur_cmd+2)  : ld b,a : call print_field : call pcrlf
        ld de,s_mach : call pstr
        call print_mach : call pcrlf
        ld de,s_size : call pstr
        ld hl,(cur_size)       ; low 16 bits (fixture sizes < 64K)
        call pdec16 : call pcrlf
        ld de,s_desc : call pstr
        ld hl,(cur_desc) : ld a,(cur_desc+2) : ld b,a : call print_field
        jp pcrlf

; print_versions: after the latest-version detail, list every version of the same
; package (name matches name_buf/nf_len set by info_find).  The portal emits all
; versions latest-first, so this prints newest -> oldest, one "  vVER" per line.
print_versions:
        ld de,s_versions
        call pstr
        ld hl,(idxptr)
        call index_open
        ret c
pv_walk:
        ld hl,(idx_count)
        ld a,h
        or l
        ret z
        call index_next
        ld a,(cur_name+2)      ; same length as the target name?
        ld hl,nf_len
        cp (hl)
        jr nz,pv_walk
        or a
        jr z,pv_walk
        ld b,a                 ; compare bytes (names are lowercase by manifest rule)
        ld hl,(cur_name)
        ld de,name_buf
pv_cmp:
        ld a,(de)
        cp (hl)
        jr nz,pv_walk
        inc hl
        inc de
        djnz pv_cmp
        ld a,' ' : call pkg_putc   ; "  vVER"
        ld a,' ' : call pkg_putc
        ld a,'v' : call pkg_putc
        ld hl,(cur_ver)
        ld a,(cur_ver+2)
        ld b,a
        call print_field
        call pcrlf
        jr pv_walk

; print_mach: print the known-good machine SET in cur_mach (bitfield: bit0 16k,
; bit1 48k, bit2 128k, bit3 next, bit4 zxuno) as space-separated names.  Walks the
; contiguous NUL-terminated name table (s_16k..s_zxuno), in bit order.
print_mach:
        ld a,(cur_mach)
        ld c,a                 ; C = bits to test (shifted right each step)
        ld de,s_16k            ; first name; table is contiguous in bit order
        ld b,5
pm_lp:
        srl c                  ; CF = current bit; C = remaining bits
        jr nc,pm_skip
        push bc
        push de
        call pstr              ; print name at DE
        ld a,' ' : call pkg_putc
        pop de
        pop bc
pm_skip:
        call pm_adv            ; advance DE past this name's NUL terminator
        djnz pm_lp
        ret
; pm_adv: advance DE to just past the next NUL.
pm_adv:
        ld a,(de)
        inc de
        or a
        jr nz,pm_adv
        ret

; pstr: print the NUL-terminated string at DE.
pstr:
        ld a,(de)
        or a
        ret z
        call pkg_putc
        inc de
        jr pstr
pcrlf:
        ld a,13
        jp pkg_putc

; pdec16: print HL as unsigned decimal, no leading zeros.
pdec16:
        ld a,1
        ld (lz),a
        ld de,10000 : call pdig
        ld de,1000  : call pdig
        ld de,100   : call pdig
        ld de,10    : call pdig
        ld a,l
        add a,'0'
        jp pkg_putc
pdig:
        ld c,'0'
pd_l:
        or a
        sbc hl,de
        jr c,pd_d
        inc c
        jr pd_l
pd_d:
        add hl,de
        ld a,c
        cp '0'
        jr nz,pd_emit
        ld a,(lz)
        or a
        ret nz                 ; still in leading zeros -> suppress
        ld a,'0'
        jp pkg_putc
pd_emit:
        xor a
        ld (lz),a
        ld a,c
        jp pkg_putc

; =====================================================================
; strings
; =====================================================================
li_idxname:  db "/ZXPKG/INDEX.DAT", 0

s_usage:     db "ZXPkg .pkg commands:", 13
             db " status          installed", 13
             db " list            registry", 13
             db " search <term>", 13
             db " info <name>", 13
             db " scan            rebuild DB", 13
             db " remove <name>", 13
             db " env             machine/os", 13
             db " (install/update: .pkg-inst)", 13, 0
s_unknown:   db "unknown command", 13, 0
s_nofound:   db "not found", 13, 0
s_infousage: db "usage: info <name>", 13, 0
s_noindex:   db "no index - run .pkg update", 13, 0
s_nomatch:   db "no matches", 13, 0
s_scandone:  db "scanned /DOT -> /ZXPKG/INSTALL.DAT (", 0
s_scanfiles: db " files)", 13, 0
s_env_hdr:   db "ZXPkg .pkg v0.1", 13, 0
s_env_mach:  db "machine: ", 0
s_env_os:    db "os: ", 0
s_nextzxos:  db "nextzxos", 13, 0
s_esxdos:    db "esxdos", 13, 0
s_os_unk:    db "unknown", 13, 0
s_scanfail:  db "scan failed (file I/O)", 13, 0

; install / update live in the .pkg-inst dot
s_use_inst:  db "use .pkg-inst", 13, 0

; status report
s_nocache:   db "no DB - run .pkg scan", 13, 0
s_st_ok:     db "  ok", 13, 0
s_st_upd:    db "  update", 13, 0
s_st_tally:  db "(", 0
s_st_mid:    db " managed, ", 0
s_st_end:    db " other)", 13, 0

; remove
s_dotpre:    db "/DOT/", 0
s_empty:     db 0
s_removed:   db " removed", 13, 0
s_refresh:   db "run .pkg scan to refresh", 13, 0
s_rmfail:    db " - not removed", 13, 0
s_rmself:    db "refusing to remove pkg itself", 13, 0
s_rmusage:   db "usage: remove <name>", 13, 0

s_name:    db "name: ", 0
s_ver:     db "ver:  ", 0
s_type:    db "type: ", 0
s_cmd:     db "cmd:  ", 0
s_mach:    db "mach: ", 0
s_size:    db "size: ", 0
s_desc:    db "desc: ", 0
s_versions: db "versions:", 13, 0
s_16k:     db "16k", 0
s_48k:     db "48k", 0
s_128k:    db "128k", 0
s_next:    db "next", 0
s_zxuno:   db "zxuno", 0
