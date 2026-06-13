; pkg_zx.asm — on-device demo of the .pkg query layer for ZX Spectrum / Fuse.
; Embeds the fixture index.dat (INCBIN) and runs three operations, printing the
; results: `list` (all, machine=Next), `search "n"`, and `info snake`.  Ties
; together index_core (decode) + index_search (compat/substring match) with
; RST $10 output.  The index code uses no IY and no EXX, so interrupts stay on.
; Build: sjasmplus pkg_zx.asm  ->  pkg_zx.tap

lz       equ $9410          ; pdec16 leading-zero flag
nf_len   equ $9412          ; info: target name length
name_buf equ $9420          ; info: target name

    DEVICE ZXSPECTRUM48
        org $8000
main:
        ld a,2                 ; use BASIC's stack (no `ld sp`): the final `ret`
        call $1601             ; must return to the USR caller, not orphan its frame
        ld de,s_title
        call pstr

        ld a,3                 ; pretend we're a Next (machine code 3) so all show
        ld (srch_mach),a

        ; --- list (all compatible) ---
        ld de,s_hlist
        call pstr
        xor a
        ld (ndl_len),a         ; empty term -> match all
        call list_print

        ; --- search "n" ---
        ld de,s_hsearch
        call pstr
        ld a,'n'
        ld (ndl_buf),a
        ld a,1
        ld (ndl_len),a
        call list_print

        ; --- info snake ---
        ld de,s_hinfo
        call pstr
        ld hl,s_snake
        ld de,name_buf
        ld bc,5
        ldir
        ld a,5
        ld (nf_len),a
        call info_print
        ret

; list_print: walk the index; print every record that is machine-compatible and
; whose name contains ndl_buf[0..ndl_len) (empty needle = list everything).
list_print:
        ld hl,idx_data
        call index_open
        ret c
lp_walk:
        ld hl,(idx_count)
        ld a,h
        or l
        ret z
        call index_next
        ld a,(cur_mach)        ; compat: cur_mach <= srch_mach
        ld hl,srch_mach
        cp (hl)
        jr z,lp_ok
        jr nc,lp_skip
lp_ok:
        call name_match
        or a
        jr z,lp_skip
        call print_summary
lp_skip:
        jr lp_walk

; info_print: find the record whose name exactly equals name_buf[0..nf_len) and
; print its full details; otherwise print "not found".
info_print:
        ld hl,idx_data
        call index_open
        ret c
ip_walk:
        ld hl,(idx_count)
        ld a,h
        or l
        jr z,ip_none
        call index_next
        ld a,(cur_name+2)
        ld hl,nf_len
        cp (hl)
        jr nz,ip_walk          ; different length -> keep looking
        ld a,(cur_name+2)
        ld b,a
        ld hl,(cur_name)
        ld de,name_buf
ip_cmp:
        ld a,(de)
        cp (hl)
        jr nz,ip_walk
        inc hl
        inc de
        djnz ip_cmp
        call print_detail      ; exact match
        ret
ip_none:
        ld de,s_nofound
        jp pstr

; ---- printing ----
; print_field: HL = string pointer, B = length.
print_field:
        ld a,b
        or a
        ret z
pf_lp:
        ld a,(hl)
        rst $10
        inc hl
        dec b
        jr nz,pf_lp
        ret

; print_summary: "name vVERSION" + newline  (for list/search)
print_summary:
        ld hl,(cur_name)
        ld a,(cur_name+2)
        ld b,a
        call print_field
        ld a,' '
        rst $10
        ld a,'v'
        rst $10
        ld hl,(cur_ver)
        ld a,(cur_ver+2)
        ld b,a
        call print_field
        jp pcrlf

; print_detail: multi-line record dump (for info)
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

; print_mach: print the machine name for cur_mach (0=16k 1=48k 2=128k else next)
print_mach:
        ld a,(cur_mach)
        or a
        jr nz,pm_1
        ld de,s_16k
        jp pstr
pm_1:
        cp 1
        jr nz,pm_2
        ld de,s_48k
        jp pstr
pm_2:
        cp 2
        jr nz,pm_n
        ld de,s_128k
        jp pstr
pm_n:
        ld de,s_next
        jp pstr

; ---- generic helpers ----
pstr:
        ld a,(de)
        or a
        ret z
        rst $10
        inc de
        jr pstr
pcrlf:
        ld a,13
        rst $10
        ret
pdec16:                            ; print HL unsigned decimal, no leading zeros
        ld a,1
        ld (lz),a
        ld de,10000 : call pdig
        ld de,1000  : call pdig
        ld de,100   : call pdig
        ld de,10    : call pdig
        ld a,l
        add a,'0'
        rst $10
        ret
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
        ret nz
        ld a,'0'
        rst $10
        ret
pd_emit:
        xor a
        ld (lz),a
        ld a,c
        rst $10
        ret

s_title:   db "ZXPkg index demo", 13, 13, 0
s_hlist:   db "list (Next):", 13, 0
s_hsearch: db 13, "search n:", 13, 0
s_hinfo:   db 13, "info snake:", 13, 0
s_nofound: db "not found", 13, 0
s_name:    db "name: ", 0
s_ver:     db "ver:  ", 0
s_type:    db "type: ", 0
s_cmd:     db "cmd:  ", 0
s_mach:    db "mach: ", 0
s_size:    db "size: ", 0
s_desc:    db "desc: ", 0
s_16k:     db "16k", 0
s_48k:     db "48k", 0
s_128k:    db "128k", 0
s_next:    db "next", 0
s_snake:   db "snake"

idx_data:
        INCBIN "../spec/vectors/index.dat"

        INCLUDE "index_core.inc.asm"
        INCLUDE "index_search.inc.asm"
code_end:

; ---- BASIC autoloader: CLEAR VAL "32767": LOAD ""CODE: RANDOMIZE USR VAL "32768"
basic_prog:
        db 0, 10
        dw basic_lend - basic_lbody
basic_lbody:
        db $FD, $B0, $22, "32767", $22, $3A
        db $EF, $22, $22, $AF, $3A
        db $F9, $C0, $B0, $22, "32768", $22
        db $0D
basic_lend:
basic_end:

        EMPTYTAP "pkg_zx.tap"
        SAVETAP  "pkg_zx.tap", BASIC, "pkg", basic_prog, basic_end - basic_prog, 10
        SAVETAP  "pkg_zx.tap", CODE,  "pkg", main, code_end - main, $8000
