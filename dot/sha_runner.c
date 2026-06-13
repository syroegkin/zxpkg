/* sha_runner.c — run sha256.bin in z80.h, check SHA-256("abc"), report T-states.
 * Usage: ./sha_runner sha256.bin [nrep]   (nrep default 1; >1 = timing only) */
#define CHIPS_IMPL
#include "z80.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>

static uint8_t mem[1 << 16];

int main(int argc, char **argv) {
    if (argc < 2) { fprintf(stderr, "usage: %s sha256.bin [nrep]\n", argv[0]); return 1; }
    int nrep = (argc > 2) ? atoi(argv[2]) : 1;
    memset(mem, 0, sizeof(mem));
    FILE *f = fopen(argv[1], "rb");
    if (!f) { perror("open"); return 1; }
    long code = fread(mem + 0x8000, 1, 0x8000, f);
    fclose(f);
    mem[0] = 0xC3; mem[1] = 0x00; mem[2] = 0x80;          /* JP 0x8000 */

    /* padded 64-byte block for "abc" */
    mem[0x9000] = 0x61; mem[0x9001] = 0x62; mem[0x9002] = 0x63; mem[0x9003] = 0x80;
    mem[0x903F] = 0x18;                                    /* bit length = 24 */
    mem[0x9FFF] = (uint8_t)nrep;                           /* repeat count */

    z80_t cpu;
    uint64_t pins = z80_init(&cpu);
    unsigned long long ticks = 0, limit = 5000000000ULL;
    for (;;) {
        pins = z80_tick(&cpu, pins);
        ticks++;
        if (pins & Z80_MREQ) {
            uint16_t a = Z80_GET_ADDR(pins);
            if (pins & Z80_RD)      pins = (pins & ~0xFF0000ULL) | ((uint64_t)mem[a] << 16);
            else if (pins & Z80_WR) mem[a] = (uint8_t)((pins >> 16) & 0xFF);
        }
        if (pins & Z80_HALT) break;
        if (ticks > limit) { printf("TIMEOUT\n"); return 2; }
    }

    static const uint8_t exp_abc[32] = {
        0xba,0x78,0x16,0xbf,0x8f,0x01,0xcf,0xea,0x41,0x41,0x40,0xde,0x5d,0xae,0x22,0x23,
        0xb0,0x03,0x61,0xa3,0x96,0x17,0x7a,0x9c,0xb4,0x10,0xff,0x61,0xf2,0x00,0x15,0xad };
    printf("code=%ld bytes  nrep=%d\n", code, nrep);
    printf("T-states: %llu  (%.4f s @3.5MHz, %.4f s @28MHz)  -> %.0f T/block\n",
           ticks, ticks / 3500000.0, ticks / 28000000.0, (double)ticks / nrep);
    printf("digest:");
    for (int i = 0; i < 32; i++) printf("%02x", mem[0xA400 + i]);
    printf("\n");
    if (nrep == 1) {
        int ok = memcmp(mem + 0xA400, exp_abc, 32) == 0;
        printf("SHA-256(\"abc\") %s\n", ok ? "PASS" : "FAIL");
        return ok ? 0 : 1;
    }
    return 0;
}
