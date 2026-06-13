; identify_core.inc.asm — `.pkg scan`: build the installed-package DB /ZXPKG/INSTALL.DAT.
; The ONE expensive pass: for each /DOT file, CRC it, match its NAME to a registry
; record's command (version-independent), and compare the CRC to the registry's
; latest to decide current vs outdated.  `.pkg status` then just reads /INSTALL.DAT
; (instant, no re-CRC).
;
; Matching is by COMMAND NAME, not CRC: a CRC only matches one exact version, so an
; older installed file would look "unknown"; matching the /DOT filename against the
; package command lets us flag it "outdated" instead.
;
; INCLUDE after crc_core + index_core.  Caller sets id_drive.  esxDOS ptrs = IX+HL.
; /INSTALL.DAT record: [u8 fnamelen][fname][u8 status][u32 crc LE]
;   status: 0 unmanaged | 1 current | 2 outdated
;   if status != 0:      [u8 namelen][name][u8 verlen][ver]   (name + LATEST version)

F_OPEN      equ $9a
F_CLOSE     equ $9b
F_READ      equ $9d
F_WRITE     equ $9e
F_OPENDIR   equ $a3
F_READDIR   equ $a4
FA_READ     equ $01
FA_OPEN_CREAT_WRITE equ $0a

id_drive    equ $9030
id_dirh     equ $9031
id_outh     equ $9032
id_fileh    equ $9033
id_namelen  equ $9036          ; current /DOT filename length (1)
id_match    equ $903c          ; 1 if the filename matched a registry command (1)
id_count    equ $903d          ; number of /DOT files processed (for the summary)
id_nlen     equ $903e          ; index_find_cmd: filename length to compare (1)
id_status   equ $903f          ; computed record status 0/1/2 (1)
dirent      equ $9100          ; readdir entry
pathbuf     equ $9200          ; "/DOT/<name>"
recbuf      equ $9300          ; output record assembly
idxbuf      equ $A000          ; the loaded index.dat (<= 8 KB)
filebuf     equ $C000          ; current file contents for CRC (<= 8 KB)

identify_run:
        call crc_make_table
        xor a
        ld (id_count),a
        ; load the trusted index /ZXPKG/INDEX.DAT into idxbuf
        ld a,(id_drive)
        ld ix,idxname
        push ix
        pop hl               ; HL=IX: a dot command's esxDOS calls read the ptr from HL
        ld b,FA_READ
        rst $08
        db F_OPEN
        ret c
        ld (id_fileh),a
        ld a,(id_fileh)
        ld ix,idxbuf
        push ix
        pop hl
        ld bc,$2000
        rst $08
        db F_READ
        ld a,(id_fileh)
        rst $08
        db F_CLOSE
        ; open /INSTALLED.DAT for writing
        ld a,(id_drive)
        ld ix,outname
        push ix
        pop hl
        ld b,FA_OPEN_CREAT_WRITE
        rst $08
        db F_OPEN
        ret c
        ld (id_outh),a
        ; walk /DOT
        ld a,(id_drive)
        ld ix,dotpath
        push ix
        pop hl
        ld b,0
        rst $08
        db F_OPENDIR
        jr c,id_closeout
        ld (id_dirh),a
id_loop:
        ld a,(id_dirh)
        ld ix,dirent
        push ix
        pop hl
        rst $08
        db F_READDIR
        or a
        jr z,id_enddir
        ld a,(dirent)
        and $10
        jr nz,id_loop          ; skip directories
        call scan_tick         ; per-file progress (front-end defines it)
        call build_path
        call crc_file          ; -> crcval ; CF skip on open error
        jr c,id_loop
        call index_find_cmd    ; match filename -> command ; id_match + cur_* on hit
        call write_record      ; emit [fname][status][crc](+name+ver) to /INSTALL.DAT
        ld a,(id_count)        ; count this file
        inc a
        ld (id_count),a
        jr id_loop
id_enddir:
        ld a,(id_dirh)
        rst $08
        db F_CLOSE
id_closeout:
        ld a,(id_outh)
        rst $08
        db F_CLOSE
        ret

; index_find_cmd: find the registry record whose command (cur_cmd) case-folds equal
; to the current /DOT filename (dirent+1).  Walks idxbuf directly (self-contained,
; no idxptr/index_search dependency).  Sets id_match (1/0); on a hit cur_* = record.
index_find_cmd:
        ld hl,dirent+1         ; measure the filename length
        ld b,0
ifc_len:
        ld a,(hl)
        or a
        jr z,ifc_lenok
        inc hl
        inc b
        jr ifc_len
ifc_lenok:
        ld a,b
        ld (id_nlen),a
        ld hl,idxbuf
        call index_open
        jr c,ifc_no
ifc_walk:
        ld hl,(idx_count)
        ld a,h
        or l
        jr z,ifc_no
        call index_next
        ld a,(cur_cmd+2)       ; command length
        ld hl,id_nlen
        cp (hl)
        jr nz,ifc_walk         ; length differs
        ld a,(id_nlen)
        or a
        jr z,ifc_walk          ; empty name never matches
        ld b,a
        ld hl,(cur_cmd)
        ld de,dirent+1
ifc_cmp:
        ld a,(de)
        call id_tolower
        ld c,a
        ld a,(hl)
        call id_tolower
        cp c
        jr nz,ifc_walk
        inc hl
        inc de
        djnz ifc_cmp
        ld a,1                 ; case-folded command match
        ld (id_match),a
        ret
ifc_no:
        xor a
        ld (id_match),a
        ret
id_tolower:
        cp 'A'
        ret c
        cp 'Z'+1
        ret nc
        add a,$20
        ret

; calc_status: A = 0 unmanaged / 1 current / 2 outdated.  Uses id_match, and
; compares the file's CRC (crcval) to the matched record's CRC (cur_crc).
calc_status:
        ld a,(id_match)
        or a
        ret z                  ; 0 = unmanaged
        ld hl,crcval
        ld de,cur_crc
        ld b,4
cs_cmp:
        ld a,(de)
        cp (hl)
        jr nz,cs_old
        inc hl
        inc de
        djnz cs_cmp
        ld a,1                 ; CRC == latest -> current
        ret
cs_old:
        ld a,2                 ; command matched but CRC differs -> outdated
        ret

; build_path: pathbuf = "/DOT/" + (dirent+1) ; sets id_namelen.
build_path:
        ld hl,dotprefix
        ld de,pathbuf
        ld bc,dotprefix_len
        ldir
        ld hl,dirent+1
        ld b,0
bp_lp:
        ld a,(hl)
        ld (de),a
        or a
        jr z,bp_done
        inc hl
        inc de
        inc b
        jr bp_lp
bp_done:
        ld a,b
        ld (id_namelen),a
        ret

; crc_file: CRC the file at (pathbuf) -> crcval, STREAMING in 8 KB chunks so files
; larger than the buffer are hashed correctly (no size cap).  CF on open error.
crc_file:
        ld a,(id_drive)
        ld ix,pathbuf
        push ix
        pop hl
        ld b,FA_READ
        rst $08
        db F_OPEN
        ret c
        ld (id_fileh),a
        call crc_init
cf_loop:
        ld a,(id_fileh)
        ld ix,filebuf
        push ix
        pop hl
        ld bc,$2000            ; read up to 8 KB into filebuf
        rst $08
        db F_READ              ; BC = bytes actually read (0 at EOF)
        ld a,b
        or c
        jr z,cf_eof
        ld de,filebuf
        call crc_update        ; fold this chunk (BC bytes at DE) into crcval
        jr cf_loop
cf_eof:
        call crc_final
        ld a,(id_fileh)
        rst $08
        db F_CLOSE
        or a                   ; CF=0 success
        ret

; write_record: emit one /INSTALL.DAT record for the current file:
;   [fnamelen][fname][status][crc] (+ [namelen][name][verlen][ver] if managed).
write_record:
        call calc_status       ; A = 0/1/2
        ld (id_status),a
        ld de,recbuf
        ld a,(id_namelen)      ; [fnamelen]
        ld (de),a
        inc de
        ld a,(id_namelen)      ; [fname]
        or a
        jr z,wr_status
        ld c,a
        ld b,0
        ld hl,dirent+1
        ldir
wr_status:
        ld a,(id_status)       ; [status]
        ld (de),a
        inc de
        ld hl,crcval           ; [u32 crc LE]  (the file's CRC)
        ld bc,4
        ldir
        ld a,(id_status)
        or a
        jr z,wr_emit           ; unmanaged -> no name/version
        ld a,(cur_name+2)      ; [namelen][name]  (package name)
        ld (de),a
        inc de
        ld c,a
        ld b,0
        or a
        jr z,wr_ver
        ld hl,(cur_name)
        ldir
wr_ver:
        ld a,(cur_ver+2)       ; [verlen][ver]  (LATEST version from the registry)
        ld (de),a
        inc de
        ld c,a
        ld b,0
        or a
        jr z,wr_emit
        ld hl,(cur_ver)
        ldir
wr_emit:
        ld hl,recbuf           ; BC = DE - recbuf  (record length)
        ex de,hl
        or a
        sbc hl,de
        ld c,l
        ld b,h
        ld a,(id_outh)
        ld ix,recbuf
        push ix
        pop hl
        rst $08
        db F_WRITE
        ret

idxname:    db "/ZXPKG/INDEX.DAT", 0
outname:    db "/ZXPKG/INSTALL.DAT", 0   ; 8.3-legal base names (classic esxDOS rejects >8 char base)
dotpath:    db "/DOT", 0
dotprefix:  db "/DOT/"
dotprefix_len equ 5
