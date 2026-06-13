; index_demo.asm — raw front-end exercising the index.dat v1 decoder.
; Walks every record via index_open/index_next and RE-EMITS each record's bytes
; into outbuf (round-trip).  If the decoder finds every field/length boundary
; correctly, outbuf == the input's record section byte-for-byte — a strong, easy
; harness check (index_runner.c compares them).
;
; Harness preloads index.dat at idxdat ($A000).  Build (raw):
;   sjasmplus --raw=index_demo.bin index_demo.asm

idxdat   equ $A000          ; harness loads index.dat here
outbuf   equ $B000          ; round-trip reconstruction lands here

         org $8000
main:
         ld sp,$BFFF
         ld hl,idxdat
         call index_open
         jr c,done            ; unknown schema_ver -> idx_status=1, leave outbuf empty
         ld hl,outbuf
         ld (outptr),hl
walk:
         ld hl,(idx_count)
         ld a,h
         or l
         jr z,done            ; all records consumed
         call index_next
         call emit_record     ; append reconstruction to (outptr)
         jr walk
done:
         halt

; emit_record: append the current record, reconstructed from cur_*, to (outptr).
emit_record:
         ld de,(outptr)
         ld hl,cur_crc
         ld bc,10
         ldir                 ; fixed 10 bytes (crc/machine/os/feat/size)
         ld ix,cur_type
         call emit_str
         ld ix,cur_cmd
         call emit_str
         ld ix,cur_name
         call emit_str
         ld ix,cur_ver
         call emit_str
         ld ix,cur_desc
         call emit_str
         ld (outptr),de
         ret

; emit_str: DE = out cursor; IX -> {ptr(2),len(1)}.  Write [len][string]; DE advanced.
emit_str:
         ld a,(ix+2)          ; len
         ld (de),a
         inc de
         or a
         ret z                ; empty string -> just the length byte
         ld l,(ix+0)
         ld h,(ix+1)          ; HL = string pointer
         ld c,a
         ld b,0
         ldir                 ; copy len bytes HL -> DE
         ret

         INCLUDE "index_core.inc.asm"
