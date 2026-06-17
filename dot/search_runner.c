/* search_runner.c — harness for the `.pkg search`/`list` query layer.
 *   ./search_runner search_demo.bin <index.dat> <term> <machine> <expected>
 *     term     : search string ("" = list all)
 *     machine  : running machine BIT/mask (16k=1 48k=2 128k=4 next=8 zxuno=16; 255=all)
 *     expected : comma-separated record indices, or "none"
 * Prints the matched record indices (with package names, parsed from index.dat
 * for readability) and self-checks against <expected>.  Exit 0 = match.
 *
 * Z80 addresses (match search_demo.asm / index_search.inc.asm):
 *   srch_mach=0x9030 matchcount=0x9036 idxptr=0x9038 rawlen=0x903A
 *   matchbuf=0x9200 rawterm=0x9300 idxdat=0xA000
 */
#define CHIPS_IMPL
#include "z80.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>

enum { A_MACH = 0x9030, A_COUNT = 0x9036, A_IDXPTR = 0x9038, A_RAWLEN = 0x903A,
       A_MATCHBUF = 0x9200, A_RAWTERM = 0x9300, A_IDXDAT = 0xA000 };

static uint8_t mem[1 << 16];
static uint8_t idx[0x4000];

static long loadcode(const char *path) {
    FILE *f = fopen(path, "rb");
    if (!f) { fprintf(stderr, "cannot open %s\n", path); exit(2); }
    long n = fread(mem + 0x8000, 1, 0x8000, f);
    fclose(f);
    return n;
}

/* return a malloc'd name string for record index ri (or "?") by walking index.dat */
static void record_name(int ri, char *out, int outsz) {
    long p = 4; /* skip header */
    int count = idx[2] | (idx[3] << 8);
    for (int r = 0; r < count; r++) {
        p += 10; /* crc+machine+os+feat+size */
        int tlen = idx[p++]; p += tlen;        /* type */
        int clen = idx[p++]; p += clen;        /* cmd */
        int nlen = idx[p++]; const uint8_t *name = idx + p; p += nlen; /* name */
        int vlen = idx[p++]; p += vlen;        /* version */
        int dlen = idx[p++]; p += dlen;        /* desc */
        if (r == ri) { int k = nlen < outsz - 1 ? nlen : outsz - 1; memcpy(out, name, k); out[k] = 0; return; }
    }
    snprintf(out, outsz, "?");
}

int main(int argc, char **argv) {
    if (argc < 6) { fprintf(stderr, "usage: %s search_demo.bin index.dat term machine expected\n", argv[0]); return 2; }
    memset(mem, 0, sizeof(mem));
    loadcode(argv[1]);
    mem[0] = 0xC3; mem[1] = 0x00; mem[2] = 0x80;

    FILE *f = fopen(argv[2], "rb");
    if (!f) { fprintf(stderr, "cannot open %s\n", argv[2]); return 2; }
    long idxlen = fread(idx, 1, sizeof(idx), f);
    fclose(f);
    memcpy(mem + A_IDXDAT, idx, idxlen);

    const char *term = argv[3];
    int tlen = (int)strlen(term);
    memcpy(mem + A_RAWTERM, term, tlen);
    mem[A_RAWLEN] = (uint8_t)tlen;
    mem[A_IDXPTR] = A_IDXDAT & 0xff; mem[A_IDXPTR + 1] = (A_IDXDAT >> 8) & 0xff;
    mem[A_MACH] = (uint8_t)atoi(argv[4]);

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
        if (++ticks > limit) { printf("TIMEOUT\n"); return 2; }
    }

    int count = mem[A_COUNT];
    char got[64] = "";
    printf("term=\"%s\" machine=%s -> %d match(es): ", term, argv[4], count);
    for (int i = 0; i < count; i++) {
        int ri = mem[A_MATCHBUF + i];
        char nm[32]; record_name(ri, nm, sizeof(nm));
        printf("%s%d(%s)", i ? ", " : "", ri, nm);
        char tmp[8]; snprintf(tmp, sizeof(tmp), "%s%d", i ? "," : "", ri);
        strncat(got, tmp, sizeof(got) - strlen(got) - 1);
    }
    if (count == 0) strcpy(got, "none");
    printf("\n");

    int ok = strcmp(got, argv[5]) == 0;
    printf("  expected [%s] got [%s] -> %s\n", argv[5], got, ok ? "OK" : "MISMATCH");
    return ok ? 0 : 1;
}
