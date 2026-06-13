; cmd_demo.asm — raw front-end for the .pkg command parse/dispatch/info logic.
; Harness preloads: command-line tail at $9500 with ci_in->$9500, ci_len set;
; index.dat at $A000 with idxptr->$A000.  Outputs cmd_id and (for `info`)
; found_flag/found_idx.  Build: sjasmplus --raw=cmd_demo.bin cmd_demo.asm

         org $8000
main:
         ld sp,$BFFF
         call cmd_parse
         call cmd_dispatch
         ld a,(cmd_id)
         cp 3                 ; info -> resolve the name
         jr nz,cm_done
         call info_find
cm_done:
         halt

         INCLUDE "index_core.inc.asm"
         INCLUDE "index_search.inc.asm"
         INCLUDE "cmd_core.inc.asm"
