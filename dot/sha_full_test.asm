; raw harness: hash msgbuf[0..msglen-1] -> digest, then HALT
        org $8000
        ld sp,$BFFF
        call sha_full
        call sha_digest
        halt
        INCLUDE "sha_core.inc.asm"
