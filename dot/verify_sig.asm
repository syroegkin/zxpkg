; verify_sig.asm — raw front-end for the WIRE-FORMAT verify (verify_sig in
; rabin_core.inc.asm).  The device receives a blob, a 130-byte detached .sig and
; a 130-byte public-key entry (spec §5.4/§5.6); this exercises exactly that path.
;
; Harness preloads:
;   blob   -> msgbuf ($B000) + msglen ($B100)
;   .sig   -> sigbuf ($C600)   [u8 key_id][u8 tweak][128 s LE]
;   pubkey -> pkbuf  ($C700)   [u8 key_id][u8 algo ][128 n LE]
; result byte at $C512: 1 = valid, 0 = invalid.
; Build (raw): sjasmplus --raw=verify_sig.bin verify_sig.asm

sigbuf   equ $C600
pkbuf    equ $C700

         org $8000
main:
         ld sp,$BFFF
         ld hl,sigbuf
         ld de,pkbuf
         call verify_sig    ; parses sig+pubkey, hashes blob, verifies -> (result)
         halt

         INCLUDE "rabin_core.inc.asm"
         INCLUDE "bn_core.inc.asm"
         INCLUDE "sha_core.inc.asm"
