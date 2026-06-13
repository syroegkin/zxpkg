; index_core.inc.asm — index.dat v1 decoder (spec §6).  Pure byte-walk; uses
; only A/BC/DE/HL/IX (no IY, no EXX — esxDOS/ROM-safe).  Strings are NOT copied:
; index_next records a (pointer,length) into the in-place index.dat for each
; field, which is all search/list/info need.
;
; Layout decoded:
;   [u8 schema_ver=1][u8 key_id][u16 record_count]
;   record*: [u32 crc32c][u8 machine][u8 os_flags][u8 feature_flags][u24 size]
;            [u8 t_len][type][u8 c_len][cmd][u8 n_len][name][u8 v_len][ver][u8 d_len][desc]

; ---- decoder state ----
idx_cur    equ $9000          ; cursor: current parse position (2)
idx_count  equ $9002          ; records remaining to parse (2)
idx_keyid  equ $9004          ; signing key id from the header (1)
idx_total  equ $9005          ; record_count from the header (2)
idx_status equ $9007          ; 0 = ok, 1 = unknown schema_ver (1)
outptr     equ $9008          ; (used by front-ends, e.g. round-trip out cursor) (2)
; ---- current record (cur_crc..cur_size are 10 CONTIGUOUS bytes) ----
cur_crc    equ $9010          ; u32 crc32c (4)
cur_mach   equ $9014          ; machine code (1)
cur_os     equ $9015          ; os_flags (1)
cur_feat   equ $9016          ; feature_flags (1)
cur_size   equ $9017          ; u24 size (3)
cur_type   equ $901A          ; {ptr(2), len(1)} into index.dat
cur_cmd    equ $901D          ; {ptr(2), len(1)}
cur_name   equ $9020          ; {ptr(2), len(1)}
cur_ver    equ $9023          ; {ptr(2), len(1)}
cur_desc   equ $9026          ; {ptr(2), len(1)}

; index_open: HL = &index.dat.  Validates schema_ver, reads header, points the
; cursor at the first record.  Returns CF=0 ok / CF=1 unknown schema (rejected).
index_open:
         ld a,(hl)            ; schema_ver
         cp 1
         jr nz,io_bad         ; spec: reject an index we don't understand
         inc hl
         ld a,(hl)            ; key_id
         ld (idx_keyid),a
         inc hl
         ld e,(hl)
         inc hl
         ld d,(hl)            ; DE = record_count (LE)
         inc hl
         ld (idx_count),de
         ld (idx_total),de
         ld (idx_cur),hl      ; first record
         xor a
         ld (idx_status),a
         or a                 ; CF = 0 (success)
         ret
io_bad:
         ld a,1
         ld (idx_status),a
         scf                  ; CF = 1 (unknown schema)
         ret

; index_next: parse the record at (idx_cur) into cur_*, advance the cursor, and
; decrement idx_count.  Call it idx_count times after a successful index_open.
index_next:
         ld hl,(idx_cur)
         ld de,cur_crc
         ld bc,10
         ldir                 ; crc(4)+machine+os+feat+size(3) — HL now past fixed
         ld ix,cur_type
         call ix_pstr
         ld ix,cur_cmd
         call ix_pstr
         ld ix,cur_name
         call ix_pstr
         ld ix,cur_ver
         call ix_pstr
         ld ix,cur_desc
         call ix_pstr
         ld (idx_cur),hl      ; cursor at next record
         ld hl,(idx_count)
         dec hl
         ld (idx_count),hl
         ret

; ix_pstr: HL -> [len][bytes...]; IX -> {ptr(2), len(1)}.  Store the string's
; pointer + length (no copy); advance HL past the string.
ix_pstr:
         ld a,(hl)            ; len
         ld (ix+2),a
         inc hl               ; HL -> first string byte
         ld (ix+0),l
         ld (ix+1),h          ; store pointer
         ld e,a
         ld d,0
         add hl,de            ; HL -> past the string
         ret
