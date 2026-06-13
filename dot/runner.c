/* runner.c — run a raw Z80 binary in floooh's cycle-stepped z80.h, count T-states.
 *
 * Layout (matches rsa_verify.asm):
 *   code   loaded at 0x8000   (JP 0x8000 placed at 0x0000 so reset runs it)
 *   0x9000 vectors.bin: n[128] s[128] exp_s3[128] exp_s2[128]
 *   0xA000 res_s3[128]  0xA080 res_s2[128]   (written by the Z80 code)
 * Runs until the CPU executes HALT, then compares results and reports T-states.
 *
 * Build: gcc -O2 -o runner runner.c
 * Usage: ./runner rsa_verify.bin vectors/vectors.bin
 */
#define CHIPS_IMPL
#include "z80.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>

static uint8_t mem[1 << 16];

static long load(const char *path, uint16_t addr) {
    FILE *f = fopen(path, "rb");
    if (!f) { fprintf(stderr, "cannot open %s\n", path); exit(1); }
    long nbytes = fread(mem + addr, 1, (size_t)(0x10000 - addr), f);
    fclose(f);
    return nbytes;
}

static int cmp_block(uint16_t got, uint16_t exp, int len, const char *name) {
    if (memcmp(mem + got, mem + exp, len) == 0) {
        printf("  %-8s PASS\n", name);
        return 1;
    }
    printf("  %-8s FAIL\n", name);
    for (int i = len - 1; i >= 0; i--) {           /* print MSB-first */
        printf("    [%3d] got=%02x exp=%02x%s\n", i, mem[got + i], mem[exp + i],
               mem[got + i] != mem[exp + i] ? "  <--" : "");
        if (i < len - 8 && i > 8) { i = 8; printf("    ...\n"); }
    }
    return 0;
}

int main(int argc, char **argv) {
    if (argc < 3) { fprintf(stderr, "usage: %s code.bin vectors.bin\n", argv[0]); return 1; }
    memset(mem, 0, sizeof(mem));
    long code = load(argv[1], 0x8000);
    long vec  = load(argv[2], 0x9000);
    mem[0] = 0xC3; mem[1] = 0x00; mem[2] = 0x80;   /* JP 0x8000 */

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
        if (ticks > limit) { printf("TIMEOUT after %llu ticks\n", ticks); return 2; }
    }

    printf("code=%ld bytes  vectors=%ld bytes\n", code, vec);
    printf("T-states: %llu  (= %.3f s @ 3.5 MHz, %.3f s @ 28 MHz)\n",
           ticks, ticks / 3500000.0, ticks / 28000000.0);
    int ok = 1;
    ok &= cmp_block(0xA080, 0x9180, 128, "s2 modn");   /* res_s2 vs exp_s2 */
    ok &= cmp_block(0xA000, 0x9100, 128, "s3 modn");   /* res_s3 vs exp_s3 */
    printf("%s\n", ok ? "RESULT: PASS" : "RESULT: FAIL");
    return ok ? 0 : 1;
}
