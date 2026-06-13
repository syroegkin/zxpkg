; rabin_verify.asm — raw front-end for the cycle-accurate harness (rabin_runner.c).
; The verify pipeline itself (verbosely documented) lives in rabin_core.inc.
; The harness pre-loads n, s, tw_e, tw_f, msgbuf+msglen, runs from reset to the
; HALT below, then reads the verdict byte at `result` ($9512).
;
; Build (raw): sjasmplus --raw=rabin_verify.bin rabin_verify.asm

         org $8000
main:
         ld sp,$BFFF        ; private stack just below the SHA message area
         call rabin_verify  ; verdict -> A and (result)
         halt               ; "done" signal for the harness

         INCLUDE "rabin_core.inc.asm"   ; rabin_verify + helpers + EQUs
         INCLUDE "bn_core.inc.asm"      ; mul_bn / mod_bn (uses rabin_core's EQUs)
         INCLUDE "sha_core.inc.asm"     ; sha_full / sha_digest
