/* crc_runner.c — cycle-accurate harness for the Z80 CRC-32C core.
 *   ./crc_runner crc_demo.bin <dataHex> <expectedHex8>
 * Computes CRC-32C of the data on the Z80 and compares to expected (8 hex
 * digits, with or without a 0x prefix). Exit 0 = match.
 *
 * Z80-side addresses (match crc_demo.asm / crc_core.inc.asm):
 *   crclen=0x9000 crcdata=0xA000 crcval=0xE400
 *
 * Build: gcc -O2 -o crc_runner crc_runner.c
 */
#define CHIPS_IMPL
#include "z80.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>

enum { A_CRCLEN = 0x9000, A_DATA = 0xA000, A_CRCVAL = 0xE400 };

static uint8_t mem[1 << 16];

static long load(const char *path, uint16_t addr) {
    FILE *f = fopen(path, "rb");
    if (!f) { fprintf(stderr, "cannot open %s\n", path); exit(2); }
    long n = fread(mem + addr, 1, (size_t)(0x10000 - addr), f);
    fclose(f);
    return n;
}
static int unhex(const char *s, uint8_t *buf, int max) {
    int n = 0;
    for (; s[0] && s[1]; s += 2) {
        if (n >= max) return -1;
        int hi, lo;
        if (sscanf(s, "%1x%1x", &hi, &lo) != 2) return -1;
        buf[n++] = (uint8_t)((hi << 4) | lo);
    }
    return s[0] ? -1 : n;
}

int main(int argc, char **argv) {
    if (argc < 4) { fprintf(stderr, "usage: %s crc_demo.bin dataHex expectedHex\n", argv[0]); return 2; }
    memset(mem, 0, sizeof(mem));
    load(argv[1], 0x8000);
    mem[0] = 0xC3; mem[1] = 0x00; mem[2] = 0x80; /* JP 0x8000 */

    uint8_t data[0x4000];
    int dlen = unhex(argv[2], data, sizeof(data));
    if (dlen < 0) { fprintf(stderr, "bad dataHex\n"); return 2; }
    memcpy(mem + A_DATA, data, dlen);
    mem[A_CRCLEN] = (uint8_t)(dlen & 0xff);
    mem[A_CRCLEN + 1] = (uint8_t)((dlen >> 8) & 0xff);

    const char *exp = argv[3];
    if (exp[0] == '0' && (exp[1] == 'x' || exp[1] == 'X')) exp += 2;
    uint32_t want = (uint32_t)strtoul(exp, NULL, 16);

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

    uint32_t got = mem[A_CRCVAL] | (mem[A_CRCVAL + 1] << 8) | (mem[A_CRCVAL + 2] << 16) | ((uint32_t)mem[A_CRCVAL + 3] << 24);
    int ok = got == want;
    printf("crc32c=%08x (want %08x) %s  [%d bytes, %lluT]\n", got, want, ok ? "OK" : "MISMATCH", dlen, ticks);
    return ok ? 0 : 1;
}
