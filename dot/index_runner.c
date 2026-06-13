/* index_runner.c — cycle-accurate harness for the index.dat v1 decoder.
 * Loads index_demo.bin + a real index.dat, runs the decoder's round-trip walk,
 * and checks:
 *   1) status == 0 (header accepted), record count matches the header,
 *   2) the re-emitted records == the input's record section (byte-for-byte) —
 *      proves every field/length boundary was walked correctly,
 *   3) a corrupted schema_ver (byte 0 = 2) is REJECTED (status == 1).
 *
 *   ./index_runner index_demo.bin <index.dat>
 *
 * Z80-side addresses (match index_demo.asm / index_core.inc.asm):
 *   idxdat=0xA000 outbuf=0xB000 idx_total=0x9005 idx_status=0x9007
 *
 * Build: gcc -O2 -o index_runner index_runner.c
 */
#define CHIPS_IMPL
#include "z80.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>

enum { A_IDXDAT = 0xA000, A_OUTBUF = 0xB000, A_TOTAL = 0x9005, A_STATUS = 0x9007 };

static uint8_t mem[1 << 16];
static uint8_t code[0x8000], idx[0x4000];

static long loadfile(const char *path, uint8_t *buf, long max) {
    FILE *f = fopen(path, "rb");
    if (!f) { fprintf(stderr, "cannot open %s\n", path); exit(2); }
    long n = fread(buf, 1, (size_t)max, f);
    fclose(f);
    return n;
}

static void run(void) {
    z80_t cpu;
    uint64_t pins = z80_init(&cpu);
    unsigned long long ticks = 0, limit = 2000000000ULL;
    for (;;) {
        pins = z80_tick(&cpu, pins);
        if (pins & Z80_MREQ) {
            uint16_t a = Z80_GET_ADDR(pins);
            if (pins & Z80_RD)      pins = (pins & ~0xFF0000ULL) | ((uint64_t)mem[a] << 16);
            else if (pins & Z80_WR) mem[a] = (uint8_t)((pins >> 16) & 0xFF);
        }
        if (pins & Z80_HALT) break;
        if (++ticks > limit) { printf("TIMEOUT\n"); exit(2); }
    }
}

static void setup(long codelen, const uint8_t *idxbytes, long idxlen) {
    memset(mem, 0, sizeof(mem));
    memcpy(mem + 0x8000, code, codelen);
    mem[0] = 0xC3; mem[1] = 0x00; mem[2] = 0x80; /* JP 0x8000 */
    memcpy(mem + A_IDXDAT, idxbytes, idxlen);
}

int main(int argc, char **argv) {
    if (argc < 3) { fprintf(stderr, "usage: %s index_demo.bin index.dat\n", argv[0]); return 2; }
    long codelen = loadfile(argv[1], code, sizeof(code));
    long idxlen = loadfile(argv[2], idx, sizeof(idx));
    if (idxlen < 4) { fprintf(stderr, "index.dat too short\n"); return 2; }

    int ok = 1;
    long reclen = idxlen - 4; /* record section follows the 4-byte header */
    int hdr_count = idx[2] | (idx[3] << 8);

    /* 1+2: normal decode + round-trip */
    setup(codelen, idx, idxlen);
    run();
    int status = mem[A_STATUS];
    int total = mem[A_TOTAL] | (mem[A_TOTAL + 1] << 8);
    int roundtrip = memcmp(mem + A_OUTBUF, idx + 4, (size_t)reclen) == 0;
    printf("decode: status=%d records=%d (header=%d) round-trip=%s\n",
           status, total, hdr_count, roundtrip ? "match" : "MISMATCH");
    if (status != 0 || total != hdr_count || !roundtrip) ok = 0;
    if (!roundtrip) {
        for (long i = 0; i < reclen; i++)
            if (mem[A_OUTBUF + i] != idx[4 + i]) {
                printf("  first diff at record byte %ld: got %02x exp %02x\n", i, mem[A_OUTBUF + i], idx[4 + i]);
                break;
            }
    }

    /* 3: unknown schema_ver must be rejected */
    uint8_t bad[0x4000];
    memcpy(bad, idx, idxlen);
    bad[0] = 2; /* a schema the device doesn't know */
    setup(codelen, bad, idxlen);
    run();
    int badstatus = mem[A_STATUS];
    printf("bad schema_ver: status=%d (want 1=rejected)\n", badstatus);
    if (badstatus != 1) ok = 0;

    printf("%s\n", ok ? "RESULT: PASS" : "RESULT: FAIL");
    return ok ? 0 : 1;
}
