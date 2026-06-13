; pkgdiag.asm — a minimal `.pkgdiag` dot command whose ONLY job is to answer the
; two questions a real Next has to settle before we trust the full `.pkg`:
;
;   1. Does a $2000 dot command load, print via RST $10, and return cleanly to
;      NextZXOS at all?  (This proves the toolchain + deploy + entry/exit pipeline.)
;   2. What is the command-tail register convention?  We DUMP HL, DE, BC, IX on
;      entry and the 32 bytes each of HL/DE/IX point at, so running e.g.
;        .pkgdiag hello world
;      shows which register's memory actually contains "hello world".  That removes
;      all guessing about the (assumed HL=start / DE=end) convention in pkg_dot.asm.
;
; DELIBERATELY SAFE: it uses ONLY its own loaded image (RAM at $2000+, writable)
; plus the stack and RST $10 — NO scratch at $9000/$A000/$C000/$E000 — so it can't
; trample NextZXOS working RAM.  If THIS crashes, the problem is the load/return
; pipeline itself, not our buffer map.
;
; Build: `make pkgdiag` -> PKGDIAG  (copy to /dot on the SD; run `.pkgdiag [args]`).

    DEVICE ZXSPECTRUM48
        org $2000
diag:
        ; --- snapshot the entry registers BEFORE anything clobbers them ---
        ld (r_sp),sp           ; the stack pointer NextZXOS handed us (THE key datum:
                               ;  if our $9000+ scratch sits near here, the walk's
                               ;  deep calls corrupt the stack -> reset)
        ld (r_hl),hl
        ld (r_de),de
        ld (r_bc),bc
        push ix
        pop hl
        ld (r_ix),hl

        ld a,2
        call $1601             ; open the upper screen for RST $10

        ld hl,s_ban  : call pstr : call crlf
        ld hl,s_sp   : call pstr : ld hl,(r_sp) : call phex16 : call crlf
        ld hl,s_rtop : call pstr : ld hl,($5cb2) : call phex16 : call crlf  ; RAMTOP sysvar
        ld hl,s_hl   : call pstr : ld hl,(r_hl) : call phex16 : call crlf
        ld hl,s_de   : call pstr : ld hl,(r_de) : call phex16 : call crlf
        ld hl,s_bc   : call pstr : ld hl,(r_bc) : call phex16 : call crlf
        ld hl,s_ix   : call pstr : ld hl,(r_ix) : call phex16 : call crlf
        ld hl,s_athl : call pstr : ld hl,(r_hl) : call dump32 : call crlf
        ld hl,s_atde : call pstr : ld hl,(r_de) : call dump32 : call crlf
        ld hl,s_atix : call pstr : ld hl,(r_ix) : call dump32 : call crlf
        ret                    ; back to NextZXOS

; pstr: print the NUL-terminated string at HL (advances HL past it).
pstr:
        ld a,(hl)
        or a
        ret z
        rst $10
        inc hl
        jr pstr

; crlf: newline.
crlf:
        ld a,13
        rst $10
        ret

; phex16: print HL as four hex digits (HL preserved is not needed afterwards).
phex16:
        ld a,h
        call phex8
        ld a,l
        ; fall through
phex8:
        push af
        rra
        rra
        rra
        rra
        call phex4
        pop af
        ; fall through to do the low nibble
phex4:
        and $0f
        add a,$90              ; classic nibble -> ASCII hex via DAA
        daa
        adc a,$40
        daa
        rst $10
        ret

; dump32: print up to 32 bytes at HL as characters (non-printable -> '.'),
; stopping early at a $0D (the likely command-tail terminator).
dump32:
        ld b,32
d32_lp:
        ld a,(hl)
        cp 13
        ret z                  ; CR -> end of tail
        cp ' '
        jr c,d32_dot
        cp 127
        jr nc,d32_dot
        jr d32_emit
d32_dot:
        ld a,'.'
d32_emit:
        rst $10
        inc hl
        djnz d32_lp
        ret

; --- entry-register snapshots (live in the loaded image = RAM, so writable) ---
r_sp:   dw 0
r_hl:   dw 0
r_de:   dw 0
r_bc:   dw 0
r_ix:   dw 0

s_ban:  db "ZXPkg diag: $2000 dot OK", 0
s_sp:   db "SP=", 0
s_rtop: db "RAMTOP=", 0
s_hl:   db "HL=", 0
s_de:   db "DE=", 0
s_bc:   db "BC=", 0
s_ix:   db "IX=", 0
s_athl: db "@HL[", 0
s_atde: db "@DE[", 0
s_atix: db "@IX[", 0
diag_end:

        SAVEBIN "PKGDIAG", diag, diag_end - diag
