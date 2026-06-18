; gopher_uart.inc.asm — SELF-CONTAINED gopher fetch over the ZX Spectrum Next UART,
; driving the ESP8266 with raw AT commands.  Drop-in replacement for gopher_core.inc.asm
; (same gf_run contract + gf_host/gf_port/gf_sel/gf_file inputs), but needs NO NextZXOS
; ESPAT driver installed — like .http/.nxtp.  Removes the "install the ESP driver" step.
;
; *** HARDWARE-ONLY — there is NO ESP/UART emulation in the sim, so this is
;     ASSEMBLE-VERIFIED only and must be exercised + tuned on a real Next. ***
;
; Next UART (per MrKWatkins/ZXSpectrumNextTests ports.txt):
;   port $133B  read = status: bit0 rx-byte-available, bit1 tx-busy, bit2 rx-buf-full
;               write = transmit one byte (wait until !tx-busy first)
;   port $143B  read = received byte (0 if empty); write = baud prescalar (bit7: 0=lo7,1=hi7)
;   port $153B  bit6 = 0 select ESP UART; bits2:0 = prescalar MSBs (16:14)
;
; AT flow matches .http (remy/next-http) — NORMAL mode, not transparent: ATE0 (echo off),
; AT+CIPMUX=0, AT+CIPSTART, AT+CIPSEND=<len> then the request bytes; the reply arrives
; framed as "+IPD,<len>:<data>" chunks which we reassemble into GF_GBUF.  After each setup
; command we drain the ESP's reply (wait for idle) so it is never 'busy' for the next one.
; Integrity is verified later by the Rabin+SHA check in vi_run, not here.

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
gf_to    equ $9059            ; (spare)
gf_cur   equ $905b            ; receive write cursor (2)
gf_fh    equ $905d            ; esxDOS output file handle (1)
aw_pos   equ $905e            ; running match pointer (2)
aw_tok   equ $9060            ; token start pointer (2)
rx_t0    equ $9062            ; wall-clock / idle timer start frame (2)
itoa_seen equ $9064           ; itoa16: leading-zero-suppression flag (1)
gf_conn  equ $9300            ; AT command line assembled here

FRAMES   equ $5C78            ; ROM frame counter (50/sec) — CPU-speed-independent timeout
RX_TIMEOUT_FRAMES equ 600     ; ~12 s: ESP AT+CIPSTART does DNS + TCP connect (seconds)
IDLE_GAP_FRAMES   equ 20      ; ~0.4 s of silence => a setup command's reply is complete
IPD_IDLE_FRAMES   equ 150     ; ~3 s of silence after data => the connection has closed

; gf_run: open a TCP link to gf_host:gf_port, send "selector CRLF", reassemble the +IPD
; reply into GF_GBUF, and save it to gf_file.  CF=0 ok / CF=1 fail.
gf_run:
        call uart_init
        ld hl,at_ate0     : call esp_cmd       ; ATE0 — echo off (clean response stream)
        ld hl,at_cipclose : call esp_cmd       ; drop any prior connection (ignore reply)
        ld hl,at_cipmux   : call esp_cmd       ; AT+CIPMUX=0 — single connection
        call gf_build_cipstart                 ; gf_conn = AT+CIPSTART="TCP","host",port CRLF
        ld hl,gf_conn     : call uart_send_z
        ld hl,tk_ok       : call at_wait       ; CONNECT ... OK  (ERROR/FAIL -> timeout)
        jr c,gf_fail
        call gf_send_req                       ; AT+CIPSEND=<len>, ">", selector + CRLF
        jr c,gf_fail
        call gf_recv_ipd                       ; +IPD chunks -> GF_GBUF ; HL = byte count
        push hl
        ld hl,at_cipclose : call esp_cmd       ; tidy up (best-effort)
        pop hl
        ld a,h : or l
        jr z,gf_fail                           ; nothing received -> refuse
        jp gf_save                             ; write GF_GBUF -> gf_file ; sets CF
gf_fail:
        scf
        ret

; esp_cmd: send the ASCIIZ command at HL, then drain the ESP's reply (wait for idle).
; Paces commands so the ESP is never 'busy' when the next one arrives.
esp_cmd:
        call uart_send_z
        ; fall through to drain_idle
; drain_idle: read+discard UART bytes until ~IDLE_GAP_FRAMES of silence.
drain_idle:
        ld hl,(FRAMES) : ld (rx_t0),hl
di_lp:
        call uart_rx_poll
        jr c,di_gap
        ld hl,(FRAMES) : ld (rx_t0),hl          ; reset idle timer on any byte
        jr di_lp
di_gap:
        ld hl,(FRAMES) : ld de,(rx_t0) : or a : sbc hl,de
        ld de,IDLE_GAP_FRAMES : or a : sbc hl,de
        jr c,di_lp
        ret

; ---- UART byte I/O ----------------------------------------------------------
; uart_init: select the ESP UART and set 115200 baud.  The correct prescalar for
; 115200 depends on the current video timing, so (like .http / internet-nextplorer)
; we read NextReg $11 (video timing 0..7) and index a per-timing baud table — a fixed
; prescalar only works in one video mode and garbles AT in the others.
uart_init:
        ld bc,$243B           ; NextReg select port
        ld a,$11              ; reg $11 = video timing
        out (c),a
        ld bc,$253B           ; NextReg data port
        in a,(c)              ; A = timing index (0..7)
        and 7                 ; safety: stay inside the 8-entry table
        add a,a               ; word offset
        ld e,a
        ld d,0
        ld hl,baud_tbl
        add hl,de
        ld e,(hl)
        inc hl
        ld d,(hl)
        ex de,hl              ; HL = prescalar for this video timing
        ld bc,UART_CTL        ; select the ESP UART (bit6=0); matches .http's $20
        ld a,%00100000
        out (c),a
        ld bc,UART_RX         ; write the 14-bit prescalar split across $143B
        ld a,l
        and %01111111
        out (c),a             ; lower 7 bits, bit7=0
        ld a,h
        rl l                  ; carry = bit7 of the low byte
        rla                   ; A = upper bits
        or %10000000
        out (c),a             ; upper bits, bit7=1
        ret
; 115200 prescalars per video-timing index (from .http / internet-nextplorer)
baud_tbl:
        dw 243,248,256,260,269,278,286,234

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

; uart_rx_to: read one byte, waiting up to RX_TIMEOUT_FRAMES of wall-clock (the ESP's
; DNS+connect takes seconds, and a poll-count timeout would be far too short at 28 MHz).
; CF=0 + A=byte, or CF=1 on timeout.  (No echo here — the +IPD payload flows through it.)
uart_rx_to:
        push de                ; preserve caller's DE/BC — read_len keeps the chunk length
        push bc                ; and ri_copy the bytes-remaining counter in DE across our
        ld hl,(FRAMES)         ; calls, and we clobber both in the timeout path below.
        ld (rx_t0),hl
urt_lp:
        call uart_rx_poll
        jr nc,urt_got          ; got a byte
        ld hl,(FRAMES)
        ld de,(rx_t0)
        or a
        sbc hl,de              ; HL = frames elapsed (low 16 bits; fine for ~12 s)
        ld de,RX_TIMEOUT_FRAMES
        or a
        sbc hl,de
        jr c,urt_lp            ; elapsed < timeout -> keep polling
        pop bc
        pop de
        scf                    ; timed out
        ret
urt_got:
        pop bc
        pop de
        or a                   ; CF=0, A = received byte
        ret

; ---- ESP AT helpers ---------------------------------------------------------
; at_wait: read the UART until the ASCIIZ token at HL is seen, or timeout.
; CF=0 found, CF=1 timeout.  (Simple restart-on-mismatch — fine for OK / ">".)
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

; gf_send_req: AT+CIPSEND=<len> (len = strlen(selector)+2), wait ">", then send the
; gopher request "selector CRLF".  CF=1 if the ">" prompt never arrived.
gf_send_req:
        ld hl,(gf_sel) : call strlen_hl        ; HL = selector length
        inc hl : inc hl                         ; + CRLF
        push hl
        ld hl,at_cipsend_pre : ld de,gf_conn : call gb_cpy   ; "AT+CIPSEND="
        pop hl                                  ; HL = byte count
        call itoa16                             ; append decimal length
        ld hl,at_crlf : call gb_cpy
        xor a : ld (de),a
        ld hl,gf_conn : call uart_send_z        ; send "AT+CIPSEND=N\r\n"
        ld hl,tk_prompt : call at_wait          ; wait for ">"
        ret c
        ld hl,(gf_sel) : call uart_send_z       ; the selector ...
        ld a,13 : call uart_tx_a                ; ... + CRLF (= the promised byte count)
        ld a,10 : call uart_tx_a
        or a
        ret

; strlen_hl: HL -> ASCIIZ ; returns length in HL.
strlen_hl:
        ld bc,0
sl_lp:
        ld a,(hl) : or a : jr z,sl_done
        inc hl : inc bc : jr sl_lp
sl_done:
        ld h,b : ld l,c
        ret

; itoa16: HL = value 0..65535 ; append decimal (no leading zeros) at (DE); DE advanced.
itoa16:
        xor a : ld (itoa_seen),a
        ld bc,-10000 : call it_dig
        ld bc,-1000  : call it_dig
        ld bc,-100   : call it_dig
        ld bc,-10    : call it_dig
        ld a,l : add a,'0' : ld (de),a : inc de  ; units (always emitted)
        ret
it_dig:
        ld a,'0'
it_lp:
        add hl,bc
        jr c,it_inc           ; HL still >= power -> count it
        sbc hl,bc             ; underflowed: add the power back (CF=0 here)
        cp '0'
        jr nz,it_emit
        ld a,(itoa_seen) : or a
        ret z                 ; leading zero -> skip
        ld a,'0'
it_emit:
        ld (de),a : inc de
        ld a,1 : ld (itoa_seen),a
        ret
it_inc:
        inc a
        jr it_lp

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

; ---- receive (+IPD reassembly) + save ---------------------------------------
; gf_recv_ipd: reassemble the ESP's "+IPD,<len>:<data>" stream into GF_GBUF until the
; connection closes (idle gap with no new +IPD) or the cap is hit.  Returns HL = count.
gf_recv_ipd:
        ld hl,GF_GBUF : ld (gf_cur),hl
ri_next:
        call scan_ipd                            ; find "+IPD," ; CF=1 -> idle/done
        jr c,ri_done
        call read_len                            ; decimal length until ':' -> DE
        jr c,ri_done
ri_copy:
        ld a,d : or e
        jr z,ri_next                             ; chunk consumed -> next +IPD
        call uart_rx_to                          ; (no echo: this is the payload)
        jr c,ri_done                             ; mid-chunk timeout
        ld hl,(gf_cur) : ld (hl),a : inc hl : ld (gf_cur),hl
        dec de
        ld a,(gf_cur+1)
        cp (GF_GBUF+GF_GBUF_CAP)>>8
        jr nc,ri_done                            ; cap hit
        jr ri_copy
ri_done:
        ld hl,(gf_cur) : ld de,GF_GBUF : or a : sbc hl,de
        ret                                      ; HL = byte count

; scan_ipd: scan the UART for the literal "+IPD," ; CF=0 found, CF=1 after IPD_IDLE_FRAMES
; of silence (server sent everything and closed).
scan_ipd:
        ld hl,(FRAMES) : ld (rx_t0),hl
si_reset:
        ld hl,tk_ipd : ld (aw_pos),hl
si_lp:
        call uart_rx_poll
        jr nc,si_got
        ld hl,(FRAMES) : ld de,(rx_t0) : or a : sbc hl,de
        ld de,IPD_IDLE_FRAMES : or a : sbc hl,de
        jr c,si_lp
        scf : ret                                ; idle -> done
si_got:
        ld hl,(FRAMES) : ld (rx_t0),hl           ; reset idle timer on any byte
        ld hl,(aw_pos)
        cp (hl)
        jr nz,si_reset
        inc hl : ld (aw_pos),hl
        ld a,(hl) : or a
        jr nz,si_lp
        or a : ret                               ; matched "+IPD," fully

; read_len: read ASCII decimal digits until ':' -> DE = value.  CF=1 on timeout.
read_len:
        ld de,0
rl_lp:
        call uart_rx_to
        ret c
        cp ':'
        ret z                                     ; ':' -> done (CF=0)
        sub '0'
        cp 10
        jr nc,rl_lp                               ; non-digit -> ignore
        ld h,d : ld l,e
        add hl,hl : add hl,hl : add hl,de : add hl,hl   ; HL = DE*10
        ld c,a : ld b,0
        add hl,bc
        ex de,hl                                  ; DE = DE*10 + digit
        jr rl_lp

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
at_ate0:        db "ATE0",13,10,0
at_cipclose:    db "AT+CIPCLOSE",13,10,0
at_cipmux:      db "AT+CIPMUX=0",13,10,0
at_cipsend_pre: db "AT+CIPSEND=",0
at_cs_pre:      db "AT+CIPSTART=",34,"TCP",34,",",34,0
at_q_comma:     db 34,",",0
at_crlf:        db 13,10,0
tk_ok:          db "OK",0
tk_prompt:      db ">",0
tk_ipd:         db "+IPD,",0
