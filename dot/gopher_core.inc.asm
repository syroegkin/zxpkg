; gopher_core.inc.asm — reusable GOPHER fetch over the Next's WiFi (ESP8266 via the
; NextZXOS ESPAT driver), for the smart-device `.pkg-inst install <name>` path.
; Factored from the pkg_get bring-up dot; same transport, same EOF handling.
;
; *** HARDWARE-ONLY — there is NO ESP emulation in our sim, so this path is
;     ASSEMBLE-VERIFIED here and must be exercised on a real Next (test-plan §5). ***
;
; Caller contract (all ASCIIZ pointers, set before calling gf_run):
;   gf_host -> host         e.g. "pkg.zx.in.net"
;   gf_port -> port         e.g. "70"
;   gf_sel  -> selector     e.g. "/artifact/morse/1.2.0/MORSE"
;   gf_file -> dest file    e.g. "/ZXPKG/CACHE/MORSE"   (always saved; no display mode)
; Returns: CF=0 on success (file written), CF=1 on connect / empty / save failure;
;   on a connect failure A = the ESPAT error byte ($00 = driver not installed).
; Integrity is NOT this layer's job — a truncated/tampered download is caught later
; by the Rabin+SHA verify in vi_run, which simply refuses it.
;
; Buffers: receives into GBUF ($C000) and writes the file only after the connection
; closes (the ESPAT docs warn the UART drops bytes if the SD is touched mid-receive).
; GBUF reuses the rabin scratch at $C000 — safe because the fetch fully completes and
; writes the file BEFORE vi_run touches the crypto buffers (strictly sequential).
;
; Relies on the front-end having defined F_OPEN/F_CLOSE/F_WRITE/FA_OPEN_CREAT_WRITE.

M_DRVAPI    equ $92            ; NextZXOS driver API entry (RST $08 : DB $92)
ESPAT_ID    equ 'N'           ; ESPAT driver id (= 78)

GF_GBUF     equ $C000         ; receive buffer (shared, sequentially, with rabin)
GF_GBUF_CAP equ $2F00         ; ~12 KB cap (page-aligned: one high-byte compare)

; ---- caller inputs (ASCIIZ pointers) ----
gf_host  equ $9050            ; (2)
gf_port  equ $9052            ; (2)
gf_sel   equ $9054            ; (2)
gf_file  equ $9056            ; (2)
; ---- internal state ----
gf_hand  equ $9058            ; ESP channel handle (1)
gf_to    equ $9059            ; recv idle-timeout counter (2)
gf_cur   equ $905b            ; receive write cursor (2)
gf_fh    equ $905d            ; esxDOS output file handle (1)
gf_conn  equ $9300            ; "D>N>TCP,<host>,<port>",0 assembled here

; gf_run: connect, send selector + CRLF, receive to GF_GBUF until close, save to file.
gf_run:
        call gf_build_conn          ; gf_conn = "D>N>TCP,host,port",0
        ; --- open the TCP channel ---
        call gf_conn_len            ; DE = strlen(gf_conn)  (sets DE before HL)
        ld c,ESPAT_ID
        ld b,$f9                    ; B=$f9 = open
        ld hl,gf_conn               ; connect-string pointer in HL (dot convention)
        rst $08
        db M_DRVAPI
        ret c                       ; CF=1, A = ESPAT error -> caller reports
        ld (gf_hand),a
        ; --- gopher request: selector then CRLF ---
        ld hl,(gf_sel)
        call gf_send_z
        ld a,13 : call gf_send_byte
        ld a,10 : call gf_send_byte
        ; --- receive into GF_GBUF until EOF / idle-close ---
        ld hl,GF_GBUF
        ld (gf_cur),hl
        ld hl,0
        ld (gf_to),hl
gf_rxlp:
        ld c,ESPAT_ID
        ld b,$fc                    ; B=$fc = recv one byte
        ld a,(gf_hand)
        ld d,a
        rst $08
        db M_DRVAPI
        jr c,gf_rxnone              ; CF=1: no byte yet, or EOF
        ld hl,(gf_cur)              ; store the byte
        ld (hl),a
        inc hl
        ld (gf_cur),hl
        ld hl,0                     ; any data resets the idle counter
        ld (gf_to),hl
        ld a,(gf_cur+1)             ; buffer full? (cap is page-aligned)
        cp (GF_GBUF+GF_GBUF_CAP)>>8
        jr c,gf_rxlp
        jr gf_rxdone                ; cap hit: stop (short -> sig will refuse)
gf_rxnone:
        cp $fe
        jr z,gf_rxdone              ; $fe = driver end-of-file -> remote closed
        ld hl,(gf_to)              ; just idle: bump the timeout
        inc hl
        ld (gf_to),hl
        ld a,h
        cp $ea                      ; ~60000 empty polls since last byte -> closed
        jr c,gf_rxlp
gf_rxdone:
        ld c,ESPAT_ID               ; --- close the channel ---
        ld b,$fa                    ; B=$fa = close
        ld a,(gf_hand)
        ld d,a
        rst $08
        db M_DRVAPI
        ; --- byte count = gf_cur - GF_GBUF ---
        ld hl,(gf_cur)
        ld de,GF_GBUF
        or a
        sbc hl,de                   ; HL = bytes received
        ld a,h
        or l
        scf
        ret z                       ; nothing received -> CF=1 (caller refuses)
        ; --- save GF_GBUF -> gf_file (esxDOS ptr in IX *and* HL) ---
        push hl                     ; byte count
        ld a,(in_drive)
        ld ix,(gf_file)
        push ix
        pop hl
        ld b,FA_OPEN_CREAT_WRITE
        rst $08
        db F_OPEN
        jr c,gf_saveerr
        ld (gf_fh),a
        pop bc                      ; BC = byte count
        ld a,(gf_fh)
        ld ix,GF_GBUF
        push ix
        pop hl
        rst $08
        db F_WRITE
        ld a,(gf_fh)
        rst $08
        db F_CLOSE
        or a                        ; CF=0 = success
        ret
gf_saveerr:
        pop hl
        scf
        ret

; gf_build_conn: gf_conn = "D>N>TCP," + host + "," + port + NUL  (hosts are ASCIIZ).
gf_build_conn:
        ld hl,gf_s_dntcp
        ld de,gf_conn
gbc_pre:
        ld a,(hl) : or a : jr z,gbc_host
        ld (de),a : inc hl : inc de : jr gbc_pre
gbc_host:
        ld hl,(gf_host)
gbc_h:
        ld a,(hl) : or a : jr z,gbc_comma
        ld (de),a : inc hl : inc de : jr gbc_h
gbc_comma:
        ld a,',' : ld (de),a : inc de
        ld hl,(gf_port)
gbc_p:
        ld a,(hl) : or a : jr z,gbc_term
        ld (de),a : inc hl : inc de : jr gbc_p
gbc_term:
        xor a : ld (de),a
        ret

; gf_conn_len: DE = strlen(gf_conn) (excl. NUL).  Clobbers HL/A.
gf_conn_len:
        ld hl,gf_conn
        ld de,0
gcl_lp:
        ld a,(hl) : or a : ret z
        inc hl : inc de : jr gcl_lp

; gf_send_z: send the ASCIIZ string at HL over the channel.
gf_send_z:
        ld a,(hl)
        or a
        ret z
        push hl
        call gf_send_byte
        pop hl
        inc hl
        jr gf_send_z

; gf_send_byte: send the char in A (B=$fb send, D=handle, E=char).
gf_send_byte:
        ld e,a
        ld c,ESPAT_ID
        ld b,$fb
        ld a,(gf_hand)
        ld d,a
        rst $08
        db M_DRVAPI
        ret

gf_s_dntcp:  db "D>N>TCP,", 0
