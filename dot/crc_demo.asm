; crc_demo.asm — raw front-end for the CRC-32C core.  Harness preloads the data
; at crcdata ($A000) and the length (u16 LE) at crclen ($9000); result lands in
; crcval ($E400, 4 bytes LE).  Build: sjasmplus --raw=crc_demo.bin crc_demo.asm

crcdata  equ $A000          ; harness loads the input here
crclen   equ $9000          ; harness writes the u16 length here

         org $8000
main:
         ld sp,$BFFF
         call crc_make_table
         ld de,crcdata
         ld bc,(crclen)
         call crc_compute
         halt

         INCLUDE "crc_core.inc.asm"
