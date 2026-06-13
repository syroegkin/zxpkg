; install_core.inc.asm — `.pkg install` and `.pkg update`: verify a signed,
; staged file and copy it into place only if its signature is valid.  Both are
; the same operation (stream-hash -> verify against the embedded key -> stream-
; copy), parameterised by source/sig/destination paths:
;   install : /CACHE/ART        + .sig -> /DOT/ART
;   update  : /CACHE/INDEX.DAT  + .sig -> /PKG/INDEX.DAT   (local trusted index)
;
; INCLUDE after sha_core + sha_stream + rabin_core + bn_core.  Caller sets
; in_drive, then calls install_run or update_run.  esxDOS pointers = IX+HL.
; The esxDOS command constants (F_OPEN, FA_READ, …) must be defined by the
; including front-end (so this core can coexist with identify_core, which also
; defines them); the standalone install_esx/update_esx front-ends define them.

in_drive    equ $9600
in_fh       equ $9601          ; current/source handle
in_status   equ $9602          ; 1 installed, 2 refused, 0 I/O error
in_fh2      equ $9603          ; destination handle
vi_src      equ $9604          ; -> source path (2)
vi_sig      equ $9606          ; -> .sig path   (2)
vi_dst      equ $9608          ; -> dest path   (2)
in_sig      equ $9610          ; 130-byte .sig
cpybuf      equ $9800          ; 256-byte stream-copy buffer

install_run:
        ld hl,artpath : ld (vi_src),hl
        ld hl,artsig  : ld (vi_sig),hl
        ld hl,art_dst : ld (vi_dst),hl
        jr vi_run
update_run:
        ld hl,idxpath : ld (vi_src),hl
        ld hl,idxsig  : ld (vi_sig),hl
        ld hl,pkgdst  : ld (vi_dst),hl
        ; fall through

; vi_run: stream-hash (vi_src) -> verify (vi_sig) -> copy to (vi_dst) if valid.
vi_run:
        xor a
        ld (in_status),a
        call hash_src          ; sha_fd over (vi_src) -> digest ; CF on error
        ret c
        call load_sig          ; (vi_sig) -> in_sig ; CF on error
        ret c
        ld hl,in_sig
        ld de,pubkey
        call verify_sig_pre    ; pre-computed digest -> (result)
        ld a,(result)
        or a
        jr z,vi_refuse
        call copy_src_dst      ; valid -> (vi_src) -> (vi_dst)
        ld a,1
        ld (in_status),a
        ret
vi_refuse:
        ld a,2
        ld (in_status),a       ; invalid signature -> do NOT write the destination
        ret

; hash_src: stream SHA-256 over (vi_src) -> digest.
hash_src:
        ld a,(in_drive)
        ld ix,(vi_src)
        push ix
        pop hl                 ; HL=IX: a dot command's esxDOS calls read the ptr from HL
        ld b,FA_READ
        rst $08
        db F_OPEN
        ret c
        ld (sf_fh),a
        call sha_fd
        ld a,(sf_fh)
        rst $08
        db F_CLOSE
        or a
        ret

; load_sig: (vi_sig) -> in_sig (130 bytes).
load_sig:
        ld a,(in_drive)
        ld ix,(vi_sig)
        push ix
        pop hl
        ld b,FA_READ
        rst $08
        db F_OPEN
        ret c
        ld (in_fh),a
        ld a,(in_fh)
        ld ix,in_sig
        push ix
        pop hl
        ld bc,130
        rst $08
        db F_READ
        ld a,(in_fh)
        rst $08
        db F_CLOSE
        or a
        ret

; copy_src_dst: stream-copy (vi_src) -> (vi_dst) in 256-byte chunks.
copy_src_dst:
        ld a,(in_drive)
        ld ix,(vi_src)
        push ix
        pop hl
        ld b,FA_READ
        rst $08
        db F_OPEN
        ret c
        ld (in_fh),a
        ld a,(in_drive)
        ld ix,(vi_dst)
        push ix
        pop hl
        ld b,FA_OPEN_CREAT_WRITE
        rst $08
        db F_OPEN
        jr c,cp_closesrc
        ld (in_fh2),a
cp_loop:
        ld a,(in_fh)
        ld ix,cpybuf
        push ix
        pop hl
        ld bc,256
        rst $08
        db F_READ
        ld a,b
        or c
        jr z,cp_done
        ld a,(in_fh2)
        ld ix,cpybuf
        push ix
        pop hl
        rst $08
        db F_WRITE
        jr cp_loop
cp_done:
        ld a,(in_fh2)
        rst $08
        db F_CLOSE
cp_closesrc:
        ld a,(in_fh)
        rst $08
        db F_CLOSE
        ret

artpath: db "/CACHE/ART", 0
artsig:  db "/CACHE/ART.SIG", 0
art_dst: db "/DOT/ART", 0
idxpath: db "/CACHE/INDEX.DAT", 0
idxsig:  db "/CACHE/INDEX.SIG", 0
pkgdst:  db "/PKG/INDEX.DAT", 0
pubkey:                         ; embedded trust anchor: [key_id][algo][128 n LE]
        INCBIN "pubkey.bin"
