; sha_stream.inc.asm — streaming SHA-256 over a file of ANY size, lifting
; sha_full's <=180-byte single-shot cap.  INCLUDE after sha_core.inc.asm.
; The includer must define F_READ + FA_READ (esxDOS API).
;
; Usage: open the file, put its handle in sf_fh, call sha_fd -> `digest`.
; Algorithm: sha_init; read 64-byte blocks and sha_block each full one, counting
; bytes; on the short read, append the 0x80 pad + zero fill + 64-bit big-endian
; bit length (one extra block if the remainder is >= 56).

sf_fh    equ $9700          ; open file handle (input)
sf_n     equ $9701          ; bytes in the final (short) block
sf_len   equ $9702          ; total byte count, 32-bit little-endian (4)
sf_blk   equ $9710          ; 64-byte streaming block buffer
bltmp    equ $9770          ; 5-byte scratch for (byte count << 3)

; sha_fd: hash the open file (handle in sf_fh) into `digest`.
sha_fd:
        call sha_init
        xor a
        ld (sf_len+0),a
        ld (sf_len+1),a
        ld (sf_len+2),a
        ld (sf_len+3),a
sf_loop:
        ld a,(sf_fh)
        ld ix,sf_blk
        push ix
        pop hl                 ; HL=IX: a dot command's esxDOS calls read the ptr from HL
        ld bc,64
        rst $08
        db F_READ              ; BC = bytes read (0..64)
        ld a,c
        cp 64
        jr nz,sf_final
        ld hl,sf_blk           ; full block -> compress
        ld (blkptr),hl
        call sha_block
        ld bc,64
        call sf_addlen
        jr sf_loop
sf_final:
        ld (sf_n),a            ; A = remainder n (0..63)
        ld c,a
        ld b,0
        call sf_addlen         ; total += n
        call sf_finish
        jp sha_digest

; sf_addlen: sf_len (32-bit) += BC.
sf_addlen:
        ld hl,(sf_len)
        add hl,bc
        ld (sf_len),hl
        ret nc
        ld hl,(sf_len+2)
        inc hl
        ld (sf_len+2),hl
        ret

; sf_finish: append SHA padding to the remainder already in sf_blk[0..n-1].
sf_finish:
        ld a,(sf_n)
        ld e,a
        ld d,0
        ld hl,sf_blk
        add hl,de
        ld (hl),$80            ; the mandatory 1 bit
        inc hl
        ld a,(sf_n)            ; zero bytes [n+1 .. 63]
        cp 63
        jr z,sf_zeroed
        neg
        add a,63               ; 63 - n
        ld b,a
sf_z1:
        ld (hl),0
        inc hl
        djnz sf_z1
sf_zeroed:
        ld a,(sf_n)
        cp 56
        jr nc,sf_two           ; n >= 56 -> length needs a second block
        call sf_writelen       ; one block: length fits at [56..63]
        ld hl,sf_blk
        ld (blkptr),hl
        call sha_block
        ret
sf_two:
        ld hl,sf_blk           ; first block: pad only, no length
        ld (blkptr),hl
        call sha_block
        ld hl,sf_blk           ; second block: zero [0..55], length [56..63]
        ld b,56
sf_z2:
        ld (hl),0
        inc hl
        djnz sf_z2
        call sf_writelen
        ld hl,sf_blk
        ld (blkptr),hl
        call sha_block
        ret

; sf_writelen: write the 64-bit big-endian bit length (sf_len * 8) to sf_blk[56..63].
sf_writelen:
        ld hl,sf_len           ; bltmp = sf_len (4) + a 5th 0 byte
        ld de,bltmp
        ld bc,4
        ldir
        xor a
        ld (bltmp+4),a
        ld c,3                 ; << 3  (×8: bytes -> bits)
sf_shl:
        or a                   ; clear carry
        ld hl,bltmp
        ld b,5
sf_shl1:
        rl (hl)
        inc hl
        djnz sf_shl1
        dec c
        jr nz,sf_shl
        ld hl,sf_blk+56        ; big-endian: 3 zero bytes then bltmp[4..0]
        xor a
        ld (hl),a : inc hl
        ld (hl),a : inc hl
        ld (hl),a : inc hl
        ld a,(bltmp+4) : ld (hl),a : inc hl
        ld a,(bltmp+3) : ld (hl),a : inc hl
        ld a,(bltmp+2) : ld (hl),a : inc hl
        ld a,(bltmp+1) : ld (hl),a : inc hl
        ld a,(bltmp+0) : ld (hl),a
        ret
