; gopher_uart.inc.asm — SELF-CONTAINED gopher fetch over the ZX Spectrum Next UART,
; driving the ESP8266 with raw AT commands.  Drop-in replacement for gopher_core.inc.asm
; (same gf_run contract + gf_host/gf_port/gf_sel/gf_file inputs), but needs NO NextZXOS
; ESPAT driver installed — like .http/.nxtp.  This removes the "install the ESP driver"
; step from a network install.
;
; *** HARDWARE-ONLY — there is NO ESP/UART emulation in the sim, so this is
;     ASSEMBLE-VERIFIED only and must be exercised + tuned on a real Next.  Same
;     maturity bar as the ESPAT gopher_core it replaces, minus the driver dependency. ***
;
; Next UART (per MrKWatkins/ZXSpectrumNextTests ports.txt):
;   port $133B  read = status: bit0 rx-byte-available, bit1 tx-busy, bit2 rx-buf-full
;               write = transmit one byte (no Tx FIFO — wait until !tx-busy first)
;   port $143B  read = received byte (0 if empty); write = baud prescalar (bit7: 0=lo7,1=hi7)
;   port $153B  bit6 = 0 select ESP UART (1 = Pi); bits2:0 = prescalar MSBs (16:14)
; Baud = Fsys / prescalar; ESP default is 115200, Fsys ~28 MHz -> prescalar 243 (HW-tune).
;
; ESP flow uses TRANSPARENT mode (CIPMODE=1): after AT+CIPSEND the link is a raw byte
; pipe, so the gopher reply arrives as plain bytes — read-until-idle, no +IPD framing.
; Integrity is NOT this layer's job: a truncated/tampered download is refused later by
; the Rabin+SHA verify in vi_run.  Relies on the front-end's F_OPEN/F_CLOSE/F_WRITE/
; FA_OPEN_CREAT_WRITE and in_drive.

UART_TX  equ $133B            ; write = tx byte ; read = status
UART_RX  equ $143B            ; read = rx byte ; write = baud prescalar
UART_CTL equ $153B            ; bit6 esp/pi select ; bits2:0 prescalar MSB

GF_GBUF     equ $C000         ; receive buffer (shared, sequentially, with rabin scratch)
GF_GBUF_CAP equ $2F00         ; ~12 KB cap (page-aligned: single high-byte compare)

; ---- caller inputs (ASCIIZ pointers) — same addresses as the ESPAT version ----
gf_host  equ $9050            ; (2)
gf_port  equ $9052            ; (2)
gf_sel   equ $9054            ; (2)
gf_file  equ $9056            ; (2)
; ---- internal state ----
gf_to    equ $9059            ; recv idle-timeout counter (2)
gf_cur   equ $905b            ; receive write cursor (2)
gf_fh    equ $905d            ; esxDOS output file handle (1)
aw_pos   equ $905e            ; at_wait: running match pointer (2)
aw_tok   equ $9060            ; at_wait: token start pointer (2)
gf_conn  equ $9300            ; AT command line assembled here

; gf_run: bring up a transparent TCP link to gf_host:gf_port, send the selector + CRLF,
; read the reply into GF_GBUF until idle, and save it to gf_file.  CF=0 ok / CF=1 fail.
gf_run:
        call uart_init
        ld hl,at_cipclose : call uart_send_z   ; clear any prior connection (ignore reply)
        call at_drain
        ld hl,at_cipmode  : call uart_send_z   ; AT+CIPMODE=1 (transparent)
        ld hl,tk_ok       : call at_wait       ; best-effort
        call gf_build_cipstart                 ; gf_conn = AT+CIPSTART="TCP","host",port CRLF
        ld hl,gf_conn     : call uart_send_z
        ld hl,tk_connect  : call at_wait       ; wait for CONNECT
        jr c,gf_fail
        ld hl,at_cipsend  : call uart_send_z   ; AT+CIPSEND (enter passthrough)
        ld hl,tk_prompt   : call at_wait       ; wait for ">"
        jr c,gf_fail
        ld hl,(gf_sel)    : call uart_send_z   ; gopher request: selector ...
        ld a,13 : call uart_tx_a               ; ... + CRLF
        ld a,10 : call uart_tx_a
        call gf_recv                           ; raw reply -> GF_GBUF ; HL = byte count
        push hl
        ld hl,at_plus3    : call uart_send_z   ; "+++" exit passthrough (best-effort)
        ld hl,at_cipclose : call uart_send_z
        pop hl
        ld a,h : or l
        jr z,gf_fail                           ; nothing received -> refuse
        jp gf_save                             ; write GF_GBUF -> gf_file ; sets CF
gf_fail:
        scf
        ret

; ---- UART byte I/O ----------------------------------------------------------
; uart_init: select the ESP UART and set 115200 baud (prescalar 243; HW-tune to Fsys).
uart_init:
        ld bc,UART_CTL
        ld a,0                ; bit6=0 ESP, prescalar MSBs=0
        out (c),a
        ld bc,UART_RX
        ld a,243 & $7f        ; lower 7 prescalar bits (bit7=0)
        out (c),a
        ld a,$80 | ((243>>7) & $7f) ; upper 7 prescalar bits (bit7=1)
        out (c),a
        ret

; uart_tx_a: transmit the byte in A (wait until the transmitter is not busy).
uart_tx_a:
        push af
utx_w:
        ld bc,UART_TX
        in a,(c)
        and %00000010         ; bit1 = tx busy
        jr nz,utx_w
        pop af
        ld bc,UART_TX
        out (c),a
        ret

; uart_send_z: transmit the ASCIIZ string at HL.
uart_send_z:
        ld a,(hl)
        or a
        ret z
        push hl
        call uart_tx_a
        pop hl
        inc hl
        jr uart_send_z

; uart_rx_poll: one non-blocking read.  CF=0 + A=byte if a byte was available, else CF=1.
uart_rx_poll:
        ld bc,UART_TX
        in a,(c)
        and 1                 ; bit0 = rx byte available
        jr z,urp_none
        ld bc,UART_RX
        in a,(c)
        or a                  ; CF=0, A = received byte
        ret
urp_none:
        scf
        ret

; uart_rx_to: read one byte with a timeout.  CF=0 + A=byte, or CF=1 on timeout.
uart_rx_to:
        ld de,0
urt_lp:
        call uart_rx_poll
        ret nc
        dec de
        ld a,d : or e
        jr nz,urt_lp
        scf
        ret

; ---- ESP AT helpers ---------------------------------------------------------
; at_wait: read the UART until the ASCIIZ token at HL is seen, or timeout.
; CF=0 found, CF=1 timeout.  (Simple restart-on-mismatch — fine for OK / CONNECT / ">".)
at_wait:
        ld (aw_tok),hl
aw_reset:
        ld hl,(aw_tok)
        ld (aw_pos),hl
aw_lp:
        call uart_rx_to
        ret c                 ; timeout -> CF=1
        ld hl,(aw_pos)
        cp (hl)
        jr nz,aw_reset        ; mismatch -> restart the match
        inc hl
        ld (aw_pos),hl
        ld a,(hl)
        or a
        jr nz,aw_lp           ; more token chars expected
        or a                  ; matched fully -> CF=0
        ret

; at_drain: consume any pending UART bytes (short), ignoring them.
at_drain:
        ld b,32
adr_lp:
        call uart_rx_poll
        ret c
        djnz adr_lp
        ret

; gf_build_cipstart: gf_conn = AT+CIPSTART="TCP","<host>",<port> CRLF NUL
gf_build_cipstart:
        ld hl,at_cs_pre : ld de,gf_conn : call gb_cpy   ; AT+CIPSTART="TCP","
        ld hl,(gf_host) : call gb_cpy                   ; host
        ld hl,at_q_comma : call gb_cpy                  ; ",
        ld hl,(gf_port) : call gb_cpy                   ; port
        ld hl,at_crlf : call gb_cpy                     ; CRLF
        xor a : ld (de),a
        ret
; gb_cpy: append the ASCIIZ at HL to DE (DE advanced; NUL not copied).
gb_cpy:
        ld a,(hl)
        or a
        ret z
        ld (de),a
        inc hl
        inc de
        jr gb_cpy

; ---- receive + save ---------------------------------------------------------
; gf_recv: read raw bytes into GF_GBUF until an idle gap (server sent all + closed) or
; the cap is hit.  Returns HL = byte count.
gf_recv:
        ld hl,GF_GBUF : ld (gf_cur),hl
        ld hl,0 : ld (gf_to),hl
gr_lp:
        call uart_rx_poll
        jr c,gr_idle
        ld hl,(gf_cur) : ld (hl),a : inc hl : ld (gf_cur),hl
        ld hl,0 : ld (gf_to),hl
        ld a,(gf_cur+1)
        cp (GF_GBUF+GF_GBUF_CAP)>>8
        jr c,gr_lp
        jr gr_done            ; cap hit (short -> sig will refuse)
gr_idle:
        ld hl,(gf_to) : inc hl : ld (gf_to),hl
        ld a,h
        cp $ea                ; ~60000 empty polls since last byte -> closed
        jr c,gr_lp
gr_done:
        ld hl,(gf_cur) : ld de,GF_GBUF : or a : sbc hl,de
        ret                   ; HL = byte count

; gf_save: write GF_GBUF (HL = byte count) to gf_file.  CF=0 ok / CF=1 on save failure.
gf_save:
        push hl
        ld a,(in_drive)
        ld ix,(gf_file)
        push ix : pop hl
        ld b,FA_OPEN_CREAT_WRITE
        rst $08
        db F_OPEN
        jr c,gs_err
        ld (gf_fh),a
        pop bc                ; BC = byte count
        ld a,(gf_fh)
        ld ix,GF_GBUF
        push ix : pop hl
        rst $08
        db F_WRITE
        ld a,(gf_fh)
        rst $08
        db F_CLOSE
        or a                  ; CF=0 success
        ret
gs_err:
        pop hl
        scf
        ret

; ---- AT strings (34 = '"') --------------------------------------------------
at_cipclose: db "AT+CIPCLOSE",13,10,0
at_cipmode:  db "AT+CIPMODE=1",13,10,0
at_cipsend:  db "AT+CIPSEND",13,10,0
at_cs_pre:   db "AT+CIPSTART=",34,"TCP",34,",",34,0
at_q_comma:  db 34,",",0
at_crlf:     db 13,10,0
at_plus3:    db "+++",0
tk_ok:       db "OK",0
tk_connect:  db "CONNECT",0
tk_prompt:   db ">",0
