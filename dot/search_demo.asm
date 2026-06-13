; search_demo.asm — raw front-end for the `.pkg search`/`list` query layer.
; Harness preloads: index.dat at $A000 and idxptr->$A000; search term at rawterm
; ($9300) + rawlen ($903A); running machine at srch_mach ($9030).
; Outputs: matchcount ($9036) + matchbuf ($9200) record indices.
; Build: sjasmplus --raw=search_demo.bin search_demo.asm

         org $8000
main:
         ld sp,$BFFF
         call index_search
         halt

         INCLUDE "index_core.inc.asm"
         INCLUDE "index_search.inc.asm"
