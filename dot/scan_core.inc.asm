; scan_core.inc.asm — `.pkg scan`: enumerate /DOT via the esxDOS directory API,
; CRC-32C each regular file (identity), and write the results to /SCAN.DAT as
; [u8 namelen][name][u32 crc32c LE] records.  Device-side identity scan (a real
; .pkg would then look each CRC up in the index and refresh installed.dat).
;
; INCLUDE after crc_core.inc.asm (uses crc_make_table / crc_compute / crcval).
; Caller sets sc_drive (default drive) and has built the CRC table.
; esxDOS pointer params go in IX (upper-RAM caller).

F_OPEN      equ $9a
F_CLOSE     equ $9b
F_READ      equ $9d
F_WRITE     equ $9e
F_OPENDIR   equ $a3
F_READDIR   equ $a4
FA_READ     equ $01
FA_OPEN_CREAT_WRITE equ $0a

; --- buffers (clear of crc_core's crctab=$E000/crcval=$E400) ---
dirent      equ $9000          ; readdir entry: [attr][ASCIIZ name][meta]
pathbuf     equ $9100          ; "/DOT/<name>" ASCIIZ
recbuf      equ $9200          ; output record assembly
sc_drive    equ $9300
sc_dirh     equ $9301
sc_outh     equ $9302
sc_fileh    equ $9303
sc_flen     equ $9304          ; bytes read (2)
sc_namelen  equ $9306
filebuf     equ $9400          ; file contents (read cap 16 KB -> ends < $E000)

; scan_run: open /SCAN.DAT, walk /DOT, CRC each file, append a record per file.
scan_run:
        ld a,(sc_drive)        ; create the output file
        ld ix,outname
        push ix
        pop hl                 ; HL=IX: a dot command's esxDOS calls read the ptr from HL
        ld b,FA_OPEN_CREAT_WRITE
        rst $08
        db F_OPEN
        ret c                  ; can't create output -> give up
        ld (sc_outh),a
        ld a,(sc_drive)        ; open the /DOT directory
        ld ix,dotpath
        push ix
        pop hl
        ld b,0
        rst $08
        db F_OPENDIR
        jr c,sc_closeout
        ld (sc_dirh),a
sc_loop:
        ld a,(sc_dirh)         ; read next directory entry
        ld ix,dirent
        push ix
        pop hl
        rst $08
        db F_READDIR
        or a
        jr z,sc_enddir         ; A=0 -> end of directory
        ld a,(dirent)          ; attribute byte
        and $10                ; directory? (covers . and ..)
        jr nz,sc_loop          ;   skip
        call build_path        ; pathbuf = "/DOT/" + name ; sc_namelen set
        call crc_file          ; CRC the file -> crcval ; CF on open error
        jr c,sc_loop           ;   couldn't open -> skip
        call write_record      ; append [namelen][name][crc] to /SCAN.DAT
        jr sc_loop
sc_enddir:
        ld a,(sc_dirh)
        rst $08
        db F_CLOSE
sc_closeout:
        ld a,(sc_outh)
        rst $08
        db F_CLOSE
        ret

; build_path: pathbuf = "/DOT/" + (dirent+1 ASCIIZ).  Sets sc_namelen.
build_path:
        ld hl,dotprefix
        ld de,pathbuf
        ld bc,dotprefix_len
        ldir                   ; copy "/DOT/"
        ld hl,dirent+1         ; name (ASCIIZ)
        ld b,0                 ; name length counter
bp_lp:
        ld a,(hl)
        ld (de),a              ; copy byte (including the terminating 0)
        or a
        jr z,bp_done
        inc hl
        inc de
        inc b
        jr bp_lp
bp_done:
        ld a,b
        ld (sc_namelen),a
        ret

; crc_file: open pathbuf (read), read up to 16 KB into filebuf, close, CRC it.
; Returns CF set if the file could not be opened.
crc_file:
        ld a,(sc_drive)
        ld ix,pathbuf
        push ix
        pop hl
        ld b,FA_READ
        rst $08
        db F_OPEN
        ret c
        ld (sc_fileh),a
        ld a,(sc_fileh)
        ld ix,filebuf
        push ix
        pop hl
        ld bc,$4000            ; cap 16 KB (dot commands are small)
        rst $08
        db F_READ              ; BC = bytes actually read
        ld (sc_flen),bc
        ld a,(sc_fileh)
        rst $08
        db F_CLOSE
        ld de,filebuf
        ld bc,(sc_flen)
        call crc_compute       ; -> crcval (4 bytes LE)
        or a                   ; clear CF = success
        ret

; write_record: append [u8 namelen][name][u32 crc LE] to the output file.
write_record:
        ld a,(sc_namelen)
        ld (recbuf),a
        ld hl,dirent+1         ; name -> recbuf+1
        ld de,recbuf+1
        ld a,(sc_namelen)
        ld c,a
        ld b,0
        or a
        jr z,wr_crc
        ldir
wr_crc:
        ld hl,crcval           ; crc (4) follows the name (DE already there)
        ld bc,4
        ldir
        ld a,(sc_namelen)      ; record length = 1 + namelen + 4
        add a,5
        ld c,a
        ld b,0
        ld a,(sc_outh)
        ld ix,recbuf
        push ix
        pop hl
        rst $08
        db F_WRITE
        ret

dotpath:    db "/DOT", 0
outname:    db "/SCAN.DAT", 0
dotprefix:  db "/DOT/"
dotprefix_len equ 5
