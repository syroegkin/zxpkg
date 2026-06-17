; index_search.inc.asm — `.pkg search`/`list` query layer over the index.dat
; decoder (index_core.inc.asm).  Device-only logic: walk every record, keep the
; ones that (a) are compatible with the running machine and (b) whose package
; name contains the (case-folded) search term.  Collects matching record indices.
;
; INCLUDE after index_core.inc.asm.  Inputs (set by the caller/harness):
;   idxptr   = &index.dat
;   srch_mach= running machine BIT (16k=1 48k=2 128k=4 next=8 zxuno=16)
;   rawterm  = search term bytes (any case); rawlen = its length (0 = list all)
; Outputs:
;   matchcount = number of matches; matchbuf[0..matchcount-1] = record indices.
;
; Compat rule: a record's `machine` field is a known-good SET (bitfield), so a
; record is compatible iff (cur_mach AND srch_mach) != 0.  Names are lowercase by
; manifest rule, so we lowercase the term once and do a plain substring test.

srch_mach  equ $9030          ; running machine bit (input)
ndl_len    equ $9031          ; lowercased needle length
mb_ptr     equ $9034          ; matchbuf write cursor
matchcount equ $9036          ; number of matches (output)
rec_idx    equ $9037          ; current record index (0-based)
idxptr     equ $9038          ; &index.dat (input, 2)
rawlen     equ $903A          ; raw term length (input)
ndl_buf    equ $9100          ; lowercased search term
matchbuf   equ $9200          ; matched record indices (output)
rawterm    equ $9300          ; raw search term (input)

; index_search: run the query described by the input vars above.
index_search:
         ; lowercase rawterm -> ndl_buf
         ld a,(rawlen)
         ld (ndl_len),a
         or a
         jr z,is_opened_pre    ; empty term -> no copy needed
         ld b,a
         ld hl,rawterm
         ld de,ndl_buf
is_lc:
         ld a,(hl)
         call tolower_a
         ld (de),a
         inc hl
         inc de
         djnz is_lc
is_opened_pre:
         ld hl,(idxptr)
         call index_open
         jr c,is_none          ; unknown schema -> no matches
         xor a
         ld (matchcount),a
         ld (rec_idx),a
         ld hl,matchbuf
         ld (mb_ptr),hl
is_walk:
         ld hl,(idx_count)
         ld a,h
         or l
         jr z,is_done          ; all records visited
         call index_next
         ; compat: keep iff the record's known-good SET overlaps the running machine
         ; bit (cur_mach AND srch_mach != 0). srch_mach = the running machine's bit.
         ld a,(cur_mach)
         ld hl,srch_mach
         and (hl)
         jr z,is_skip          ; no overlap -> incompatible for this machine
         call name_match       ; A = 1 if the (lowercased) term is in cur_name
         or a
         jr z,is_skip
         ld hl,(mb_ptr)        ; record this match
         ld a,(rec_idx)
         ld (hl),a
         inc hl
         ld (mb_ptr),hl
         ld a,(matchcount)
         inc a
         ld (matchcount),a
is_skip:
         ld a,(rec_idx)
         inc a
         ld (rec_idx),a
         jr is_walk
is_none:
         xor a
         ld (matchcount),a
is_done:
         ret

; name_match: A = 1 if ndl_buf[0..ndl_len) is a substring of cur_name, else 0.
; Empty needle matches everything (used by `list`).
name_match:
         ld a,(ndl_len)
         or a
         jr nz,nm_go
         ld a,1
         ret                   ; empty needle -> match
nm_go:
         ld c,a                ; C = needle length (constant)
         ld hl,(cur_name)      ; HL = name pointer
         ld a,(cur_name+2)
         ld b,a                ; B = remaining name chars from current start
nm_outer:
         ld a,b
         cp c
         jr c,nm_no            ; remaining < needle -> cannot match
         push hl               ; save start
         push bc               ; save remaining + needle length
         ld de,ndl_buf
         ld b,c                ; inner counter = needle length
nm_in:
         ld a,(de)
         cp (hl)
         jr nz,nm_mis
         inc hl
         inc de
         djnz nm_in
         pop bc                ; full needle matched here
         pop hl
         ld a,1
         ret
nm_mis:
         pop bc
         pop hl
         inc hl                ; try next start position
         dec b
         jr nm_outer
nm_no:
         xor a
         ret

; tolower_a: A -> lowercase if 'A'..'Z'.
tolower_a:
         cp 'A'
         ret c
         cp 'Z'+1
         ret nc
         add a,$20
         ret
