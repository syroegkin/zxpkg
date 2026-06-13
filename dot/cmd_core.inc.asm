; cmd_core.inc.asm — `.pkg` command-line parsing + subcommand dispatch + the
; exact-name lookup behind `info`.  Device-only logic (the actual printing is
; done by the on-device front-end via RST $10).  Reuses tolower_a + idxptr from
; index_search.inc.asm, so INCLUDE this AFTER index_core + index_search.
;
; Inputs:  ci_in = &command-line tail, ci_len = its length;  idxptr = &index.dat
; Parse outputs: tok_ptr/tok_len (the subcommand), arg_ptr/arg_len (the rest).
; Dispatch output: cmd_id (1 search, 2 list, 3 info, 4 install, 5 remove, 6 help,
;                          7 scan, 8 update, 9 status, 0 unknown).
; info_find outputs: found_flag (1/0), found_idx (record index).

ci_in      equ $9040          ; &command line tail (input, 2)
ci_len     equ $9042          ; command line length (input, 1)
tok_ptr    equ $9043          ; subcommand token pointer (2)
tok_len    equ $9045          ; subcommand token length (1)
arg_ptr    equ $9046          ; argument pointer (2)
arg_len    equ $9048          ; argument length (1)
cmd_id     equ $9049          ; dispatched command id (1)
found_idx  equ $904A          ; info: matched record index (1)
found_flag equ $904B          ; info: 1 = found, 0 = not (1)
rec_idx2   equ $904E          ; info walk: current record index (1)
nf_len     equ $904F          ; info: lowercased name length (1)
tok_lc     equ $9050          ; lowercased token (<=8 chars)
name_buf   equ $9400          ; info: lowercased target name

; cmd_parse: split (ci_in, ci_len) into a leading token and the remaining arg.
cmd_parse:
         ld hl,(ci_in)
         ld a,(ci_len)
         ld b,a               ; B = remaining chars
         call cp_skipsp       ; skip leading spaces
         ld (tok_ptr),hl
         ld c,0               ; token length
cp_tok:
         ld a,b
         or a
         jr z,cp_tokend
         ld a,(hl)
         cp ' '
         jr z,cp_tokend
         inc hl
         dec b
         inc c
         jr cp_tok
cp_tokend:
         ld a,c
         ld (tok_len),a
         call cp_skipsp       ; skip spaces before the argument
         ld (arg_ptr),hl
         ld a,b
         ld (arg_len),a       ; argument = the rest, to end of line
         ret
cp_skipsp:
         ld a,b
         or a
         ret z
         ld a,(hl)
         cp ' '
         ret nz
         inc hl
         dec b
         jr cp_skipsp

; cmd_dispatch: map the (case-folded) token to cmd_id via cmdtab.
cmd_dispatch:
         ld a,(tok_len)
         or a
         jr z,cd_unknown      ; empty token
         cp 9
         jr nc,cd_unknown     ; longer than any command -> unknown
         ld b,a
         ld hl,(tok_ptr)
         ld de,tok_lc
cd_fold:
         ld a,(hl)
         call tolower_a
         ld (de),a
         inc hl
         inc de
         djnz cd_fold         ; tok_lc = lowercased token (B = tok_len preserved? no)
         ld a,(tok_len)
         ld b,a               ; B = token length for comparisons
         ld hl,cmdtab
cd_entry:
         ld a,(hl)            ; entry length (0 = end of table)
         or a
         jr z,cd_unknown
         cp b
         jr nz,cd_skip        ; different length -> not this one
         push hl
         inc hl               ; -> entry characters
         ld de,tok_lc
         ld c,b
cd_cmp:
         ld a,(de)
         cp (hl)
         jr nz,cd_nomatch
         inc hl
         inc de
         dec c
         jr nz,cd_cmp
         ld a,(hl)            ; matched: byte after the string is the id
         pop de               ; discard saved entry start
         ld (cmd_id),a
         ret
cd_nomatch:
         pop hl
cd_skip:
         ld a,(hl)            ; advance to next entry: len + chars + id
         ld e,a
         ld d,0
         inc hl               ; past len byte
         add hl,de            ; past chars
         inc hl               ; past id byte
         jr cd_entry
cd_unknown:
         xor a
         ld (cmd_id),a
         ret

cmdtab:
         db 6,"search",1
         db 4,"list",2
         db 4,"info",3
         db 7,"install",4
         db 6,"remove",5
         db 4,"help",6
         db 4,"scan",7
         db 6,"update",8
         db 6,"status",9
         db 0                 ; end of table

; info_find: exact (case-folded) match of the arg against a package name.
info_find:
         ld a,(arg_len)
         ld (nf_len),a
         or a
         jr z,nf_none         ; empty name -> not found
         ld b,a
         ld hl,(arg_ptr)
         ld de,name_buf
nf_fold:
         ld a,(hl)
         call tolower_a
         ld (de),a
         inc hl
         inc de
         djnz nf_fold
         ld hl,(idxptr)
         call index_open
         jr c,nf_none         ; bad index -> not found
         xor a
         ld (found_flag),a
         ld (rec_idx2),a
nf_walk:
         ld hl,(idx_count)
         ld a,h
         or l
         jr z,nf_done
         call index_next
         ld a,(cur_name+2)    ; name length
         ld hl,nf_len
         cp (hl)
         jr nz,nf_next        ; different length -> not equal
         ld a,(cur_name+2)
         ld b,a
         ld hl,(cur_name)
         ld de,name_buf
nf_cmp:
         ld a,(de)
         cp (hl)
         jr nz,nf_next
         inc hl
         inc de
         djnz nf_cmp
         ld a,(rec_idx2)      ; full match
         ld (found_idx),a
         ld a,1
         ld (found_flag),a
         ret
nf_next:
         ld a,(rec_idx2)
         inc a
         ld (rec_idx2),a
         jr nf_walk
nf_none:
         xor a
         ld (found_flag),a
nf_done:
         ret
