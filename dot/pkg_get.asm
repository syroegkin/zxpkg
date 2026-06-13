; pkg_get.asm — `.pkg-get <host> <port> <selector> [file]` : fetch one item over
; GOPHER via the Next's WiFi (ESP8266, NextZXOS ESPAT driver) and either print it
; (no [file]) or save it to [file] (e.g. /ZXPKG/CACHE/INDEX.DAT).
;
; *** HARDWARE BRING-UP — UNTESTED (no ESP emulation in our sim) ***
; This is the integrated-WiFi bring-up unit, now speaking the chosen transport:
; GOPHER (user decision; see portal/DEPLOY.md §A).  Gopher item retrieval is just:
;   connect TCP -> send "<selector>\r\n" -> read raw bytes until the server
;   closes -> that's the file.  No request line, no headers, no status parsing.
; Against a Gophernicus root the selectors are e.g. /index/v1.dat (+.sig) and
; /artifacts/<pkg>/<ver>/<CMD> (+.sig).
;
; EOF: gopher has no length field — end of item = server closing the connection.
; We treat (a) a $FE "end of file" return from the driver, or (b) a long idle
; (~60000 empty polls after the last byte) as close.  A short read just produces
; a truncated file, which the signature check in `.pkg-inst` then REFUSES — so a
; mis-detected EOF can never install garbage, it only costs a retry.
;
; RECEIVE BUFFERING: bytes are collected in RAM (gbuf $C000, cap ~12KB) and the
; file is written ONLY after the connection is done — the ESPAT docs warn the
; UART loses data if SD access (DI) happens mid-receive.  The index and typical
; dot artifacts fit easily; bigger needs chunking later.
;
; PREREQUISITES on the Next (one-time; NextZXOS mode):
;   .install /nextzxos/espat.drv ; load espat.sys to a bank ; allocate a buffer
;   bank ; start the IPD driver (DRIVER 78,1/6/9/3) ; WiFi joined.
;   (`.pkg-get` returned err=00 on HW until espat.drv was installed.)
;
; ESPAT driver API (driver id 'N'=78, via M_DRVAPI = RST $08 : DB $92):
;   B=$f9 open  : HL=&"D>N>TCP,host,port", DE=len  -> A=handle (Fc=1 on error)
;   B=$fb send  : D=handle, E=char
;   B=$fc recv  : D=handle -> A=char (Fc=0); A=$ff,Fc=1 if none yet; $fe = EOF
;   B=$fa close : D=handle
;
; Build: `make pkg-get` -> PKG-GET  (copy to /dot; run `.pkg-get host 70 /index/v1.dat /CACHE/INDEX.DAT`).

M_DRVAPI    equ $92
M_GETSETDRV equ $89
ESPAT_ID    equ 'N'            ; = 78
F_OPEN      equ $9a
F_CLOSE     equ $9b
F_WRITE     equ $9e
FA_OPEN_CREAT_WRITE equ $0a

GBUF        equ $C000          ; receive buffer (file is written AFTER the fetch)
GBUF_CAP    equ $2F00          ; ~12KB cap — keeps well clear of the stack at $FFxx

; scratch
g_in     equ $9000             ; command tail ptr (2)
g_len    equ $9002             ; command tail len (1)
g_h      equ $9003             ; host token ptr (2)
g_hl     equ $9005             ; host token len (1)
g_p      equ $9006             ; port token ptr (2)
g_pl     equ $9008             ; port token len (1)
g_u      equ $9009             ; selector token ptr (2)
g_ul     equ $900b             ; selector token len (1)
g_f      equ $900c             ; output-file token ptr (2)
g_fl     equ $900e             ; output-file token len (1)
g_hand   equ $900f             ; ESP channel handle (1)
g_to     equ $9010             ; recv idle-timeout counter (2)
g_cur    equ $9012             ; receive write cursor (2)
g_drv    equ $9014             ; default drive (1)
g_fh     equ $9015             ; esxDOS output file handle (1)
connbuf  equ $9100             ; "D>N>TCP,<host>,<port>\0" assembled here
fnbuf    equ $9200             ; ASCIIZ copy of the output filename

    DEVICE ZXSPECTRUM48
        org $2000
entry:
        ld (g_in),hl           ; capture tail (HL=start, CR-terminated; DE=exec addr)
        ld b,0
e_scan:
        ld a,(hl)
        cp ' '
        jr c,e_end
        inc hl
        inc b
        ld a,b
        cp 127
        jr c,e_scan
e_end:
        ld a,b
        ld (g_len),a
        ld a,2
        call $1601             ; open upper screen for RST $10
        xor a
        rst $08
        db M_GETSETDRV         ; A = default drive (for the optional file save)
        ld (g_drv),a

        call parse4            ; host/port/selector/[file] -> g_* tokens
        ld a,(g_ul)
        or a
        jp z,usage             ; need at least host+port+selector

        call build_conn        ; connbuf = "D>N>TCP,<host>,<port>",0

        ; --- open the TCP channel ---
        ld de,s_conn : call pstr
        call conn_len          ; DE = strlen(connbuf) (clobbers HL) — BEFORE HL is set
        ld c,ESPAT_ID
        ld b,$f9
        ld hl,connbuf          ; dot command: connect-string pointer in HL
        rst $08
        db M_DRVAPI
        jp c,open_err
        ld (g_hand),a
        ld de,s_opened : call pstr

        ; --- gopher request: just the selector + CRLF ---
        ld hl,(g_u)
        ld a,(g_ul)
        call send_n
        ld a,13 : call send_byte
        ld a,10 : call send_byte

        ; --- receive into gbuf until EOF/idle-close ---
        ld hl,GBUF
        ld (g_cur),hl
        ld hl,0
        ld (g_to),hl
recv_lp:
        ld c,ESPAT_ID
        ld b,$fc
        ld a,(g_hand)
        ld d,a
        rst $08
        db M_DRVAPI
        jr c,recv_none         ; Fc=1: no byte (or EOF — check which)
        ; got a byte in A -> store (and echo to screen if no output file)
        ld hl,(g_cur)
        ld (hl),a
        inc hl
        ld (g_cur),hl
        push af
        ld a,(g_fl)
        or a
        jr nz,rb_nostore_echo  ; saving to file -> no screen echo (keep recv fast)
        pop af
        rst $10                ; display mode: echo the byte
        jr rb_stored
rb_nostore_echo:
        pop af
rb_stored:
        ld hl,0                ; any data resets the idle counter
        ld (g_to),hl
        ; buffer full?  GBUF+GBUF_CAP is page-aligned, so one high-byte compare
        ; does it (keep GBUF_CAP a multiple of $100 or restore the 16-bit test).
        ld a,(g_cur+1)
        cp (GBUF+GBUF_CAP)>>8
        jr c,recv_lp
        ld de,s_full : call pstr   ; cap hit: stop (sig check will refuse if short)
        jr fetch_done
recv_none:
        cp $fe
        jr z,fetch_done        ; driver says end-of-file -> remote closed
        ld hl,(g_to)           ; just idle: bump the timeout counter
        inc hl
        ld (g_to),hl
        ld a,h
        cp $ea                 ; ~60000 empty polls since the last byte -> closed
        jr c,recv_lp
fetch_done:
        ; --- close the channel ---
        ld c,ESPAT_ID
        ld b,$fa
        ld a,(g_hand)
        ld d,a
        rst $08
        db M_DRVAPI

        ; --- got (g_cur - GBUF) bytes; save or finish ---
        ld de,s_got : call pstr
        ld hl,(g_cur)
        ld de,GBUF
        or a
        sbc hl,de              ; HL = byte count
        push hl
        call pdec16
        ld de,s_bytes : call pstr
        pop hl
        ld a,(g_fl)
        or a
        ret z                  ; display mode: done (bytes were echoed live)
        ld a,h
        or l
        ret z                  ; nothing received -> nothing to save

        ; --- save gbuf -> the output file (esxDOS ptr in IX *and* HL) ---
        push hl                ; byte count
        call copy_fname        ; fnbuf = ASCIIZ output filename
        ld a,(g_drv)
        ld ix,fnbuf
        push ix
        pop hl
        ld b,FA_OPEN_CREAT_WRITE
        rst $08
        db F_OPEN
        jr c,save_err_pop
        ld (g_fh),a
        pop bc                 ; BC = byte count
        ld a,(g_fh)
        ld ix,GBUF
        push ix
        pop hl
        rst $08
        db F_WRITE
        ld a,(g_fh)
        rst $08
        db F_CLOSE
        ld de,fnbuf : call pstr_de_ascii
        ld de,s_saved : call pstr
        ret
save_err_pop:
        pop hl
        ld de,s_saverr : call pstr
        ret

open_err:
        push af
        ld de,s_operr : call pstr
        pop af                 ; A = driver error ($00=driver missing, $85/$86=addr parse...)
        call phex8
        call crlf
        ret
usage:
        ld de,s_usage
        jp pstr

; send_n: send A bytes starting at HL over the channel.
send_n:
        or a
        ret z
        ld b,a
sn_lp:
        push bc
        push hl
        ld a,(hl)
        call send_byte
        pop hl
        pop bc
        inc hl
        djnz sn_lp
        ret

; send_byte: send the char in A (B=$fb, D=handle, E=char).
send_byte:
        ld e,a
        ld c,ESPAT_ID
        ld b,$fb
        ld a,(g_hand)
        ld d,a
        rst $08
        db M_DRVAPI
        ret

; build_conn: connbuf = "D>N>TCP," + host + "," + port + NUL
build_conn:
        ld hl,s_dntcp
        ld de,connbuf
bc_pre:
        ld a,(hl) : or a : jr z,bc_host
        ld (de),a : inc hl : inc de : jr bc_pre
bc_host:
        ld a,(g_hl) : or a : jr z,bc_comma
        ld b,a : ld hl,(g_h)
bc_hl:
        ld a,(hl) : ld (de),a : inc hl : inc de : djnz bc_hl
bc_comma:
        ld a,',' : ld (de),a : inc de
        ld a,(g_pl) : or a : jr z,bc_term
        ld b,a : ld hl,(g_p)
bc_pl:
        ld a,(hl) : ld (de),a : inc hl : inc de : djnz bc_pl
bc_term:
        xor a : ld (de),a
        ret

; conn_len: DE = strlen(connbuf) (excl. NUL).  Clobbers HL.
conn_len:
        ld hl,connbuf
        ld de,0
cl_lp:
        ld a,(hl)
        or a
        ret z
        inc hl
        inc de
        jr cl_lp

; copy_fname: fnbuf = output-file token as ASCIIZ.
copy_fname:
        ld a,(g_fl)
        ld b,a
        ld hl,(g_f)
        ld de,fnbuf
cf_lp:
        ld a,(hl)
        ld (de),a
        inc hl
        inc de
        djnz cf_lp
        xor a
        ld (de),a
        ret

; parse4: split the tail into up to four space-separated tokens:
;   host -> g_h/g_hl, port -> g_p/g_pl, selector -> g_u/g_ul, [file] -> g_f/g_fl.
parse4:
        ld hl,(g_in)
        ld a,(g_len)
        ld b,a
        call p_skip
        ld (g_h),hl
        call p_tok
        ld a,c
        ld (g_hl),a
        call p_skip
        ld (g_p),hl
        call p_tok
        ld a,c
        ld (g_pl),a
        call p_skip
        ld (g_u),hl
        call p_tok
        ld a,c
        ld (g_ul),a
        call p_skip
        ld (g_f),hl
        call p_tok
        ld a,c
        ld (g_fl),a
        ret
p_skip:
        ld a,b : or a : ret z
        ld a,(hl) : cp ' ' : ret nz
        inc hl : dec b : jr p_skip
p_tok:
        ld c,0
pt_lp:
        ld a,b : or a : ret z
        ld a,(hl) : cp ' ' : ret z
        inc hl : dec b : inc c : jr pt_lp

; pstr: print NUL-terminated string at DE.
pstr:
        ld a,(de) : or a : ret z
        rst $10 : inc de : jr pstr
pstr_de_ascii equ pstr         ; alias (filenames are plain ASCII)
crlf:
        ld a,13 : rst $10 : ret
; phex8: print A as two hex digits.
phex8:
        push af
        rra : rra : rra : rra
        call ph4
        pop af
ph4:
        and $0f
        add a,$90 : daa : adc a,$40 : daa
        rst $10
        ret
; pdec16: print HL unsigned decimal, no leading zeros.
pdec16:
        ld a,1
        ld (lzf),a
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
        jr nz,pd_e
        ld a,(lzf)
        or a
        ret nz
        ld a,'0'
        rst $10
        ret
pd_e:
        xor a
        ld (lzf),a
        ld a,c
        rst $10
        ret
lzf:    db 0

s_dntcp:  db "D>N>TCP,", 0
s_conn:   db "connecting...", 13, 0
s_opened: db "connected, fetching", 13, 0
s_got:    db 13, "received ", 0
s_bytes:  db " bytes", 13, 0
s_full:   db 13, "buffer full (12KB cap)", 13, 0
s_saved:  db " saved", 13, 0
s_saverr: db "save failed (dir exists? 8.3?)", 13, 0
s_operr:  db "open failed, err=", 0
s_usage:  db "usage: .pkg-get host port", 13
          db "       selector [file]", 13
          db "e.g. .pkg-get 1.2.3.4 70", 13
          db "  /index/v1.dat /ZXPKG/CACHE/INDEX.DAT", 13, 0
pkg_get_end:

        SAVEBIN "PKG-GET", entry, pkg_get_end - entry
