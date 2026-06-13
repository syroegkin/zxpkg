/* rabin_runner.c — cycle-accurate harness for the full Rabin-Williams verify.
 *
 * Loads rabin_verify.bin at 0x8000 and drives each vector in rabin_vectors.bin
 * through verify(), checking the PASS/FAIL byte and reporting T-states. Also
 * runs a tamper test (flip one artifact byte) that MUST report FAIL.
 *
 * rabin_vectors.bin (see vectors/rabin_sign.js):
 *   [0]      NVEC
 *   [1..2]   artifact length (LE u16)
 *   [3..34]  expected SHA-256 digest (big-endian)
 *   [35..]   artifact bytes (len)
 *   then NVEC records, 258 bytes each: n(LE128) s(LE128) e(1) f(1)
 *
 * Z80-side addresses (must match rabin_core.inc / sha_core.inc):
 *   n=0xC000 s=0xC080  tw_e=0xC510 tw_f=0xC511 result=0xC512
 *   digest=0xA400  msgbuf=0xB000  msglen=0xB100
 *
 * Build: gcc -O2 -o rabin_runner rabin_runner.c
 * Usage: ./rabin_runner rabin_verify.bin vectors/rabin_vectors.bin
 */
#define CHIPS_IMPL
#include "z80.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>

enum {
    A_N = 0xC000, A_S = 0xC080, A_TWE = 0xC510, A_TWF = 0xC511, A_RES = 0xC512,
    A_DIGEST = 0xA400, A_MSGBUF = 0xB000, A_MSGLEN = 0xB100,
};

static uint8_t mem[1 << 16];

static long load_file(const char *path, uint8_t *buf, long max) {
    FILE *f = fopen(path, "rb");
    if (!f) { fprintf(stderr, "cannot open %s\n", path); exit(1); }
    long n = fread(buf, 1, (size_t)max, f);
    fclose(f);
    return n;
}

/* Run the loaded code from reset to HALT; return T-states (0 on timeout). */
static unsigned long long run_to_halt(void) {
    z80_t cpu;
    uint64_t pins = z80_init(&cpu);
    unsigned long long ticks = 0, limit = 2000000000ULL;
    for (;;) {
        pins = z80_tick(&cpu, pins);
        ticks++;
        if (pins & Z80_MREQ) {
            uint16_t a = Z80_GET_ADDR(pins);
            if (pins & Z80_RD)      pins = (pins & ~0xFF0000ULL) | ((uint64_t)mem[a] << 16);
            else if (pins & Z80_WR) mem[a] = (uint8_t)((pins >> 16) & 0xFF);
        }
        if (pins & Z80_HALT) break;
        if (ticks > limit) { printf("TIMEOUT\n"); return 0; }
    }
    return ticks;
}

int main(int argc, char **argv) {
    if (argc < 3) { fprintf(stderr, "usage: %s code.bin vectors.bin\n", argv[0]); return 1; }

    static uint8_t code[0x8000], vec[0x10000];
    long codelen = load_file(argv[1], code, sizeof(code));
    long veclen  = load_file(argv[2], vec, sizeof(vec));
    (void)veclen;

    int      nvec   = vec[0];
    int      artlen = vec[1] | (vec[2] << 8);
    uint8_t *exp_dg = vec + 3;
    uint8_t *art    = vec + 35;
    uint8_t *recs   = art + artlen;
    const int RECSZ = 258;

    printf("code=%ld bytes  nvec=%d  artifact=%d bytes (%d SHA blocks)\n",
           codelen, nvec, artlen, (artlen + 9 + 63) / 64);

    int all_ok = 1;
    unsigned long long last_ticks = 0;

    for (int v = 0; v < nvec; v++) {
        uint8_t *r = recs + v * RECSZ;
        int e = r[256], f = r[257];

        /* fresh memory image: code + this vector's inputs */
        memset(mem, 0, sizeof(mem));
        memcpy(mem + 0x8000, code, codelen);
        mem[0] = 0xC3; mem[1] = 0x00; mem[2] = 0x80;       /* JP 0x8000 */
        memcpy(mem + A_N, r, 128);                          /* n */
        memcpy(mem + A_S, r + 128, 128);                    /* s */
        mem[A_TWE] = e;
        mem[A_TWF] = f;
        memcpy(mem + A_MSGBUF, art, artlen);
        mem[A_MSGLEN] = (uint8_t)artlen;

        unsigned long long ticks = run_to_halt();
        last_ticks = ticks;
        int res    = mem[A_RES];
        int dg_ok  = memcmp(mem + A_DIGEST, exp_dg, 32) == 0;

        printf("  vec %d (e=%d, f=%s): %s  digest=%s  %lluT (%.2fs @3.5MHz)\n",
               v, e, f == 0xff ? "-1" : "+1",
               res ? "PASS" : "FAIL", dg_ok ? "ok" : "MISMATCH",
               ticks, ticks / 3500000.0);
        if (!res || !dg_ok) all_ok = 0;
    }

    /* tamper test: corrupt one artifact byte on vector 0 -> must FAIL */
    {
        uint8_t *r = recs;
        memset(mem, 0, sizeof(mem));
        memcpy(mem + 0x8000, code, codelen);
        mem[0] = 0xC3; mem[1] = 0x00; mem[2] = 0x80;
        memcpy(mem + A_N, r, 128);
        memcpy(mem + A_S, r + 128, 128);
        mem[A_TWE] = r[256];
        mem[A_TWF] = r[257];
        memcpy(mem + A_MSGBUF, art, artlen);
        mem[A_MSGBUF] ^= 0x01;                              /* flip 1 bit */
        mem[A_MSGLEN] = (uint8_t)artlen;
        run_to_halt();
        int res = mem[A_RES];
        printf("  tamper (1 bit flipped): %s  (want FAIL)\n", res ? "PASS" : "FAIL");
        if (res) all_ok = 0;                                /* should NOT verify */
    }

    printf("full verify ~ %.2f s @ 3.5 MHz, %.2f s @ 28 MHz\n",
           last_ticks / 3500000.0, last_ticks / 28000000.0);
    printf("%s\n", all_ok ? "RESULT: PASS" : "RESULT: FAIL");
    return all_ok ? 0 : 1;
}
