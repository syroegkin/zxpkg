/* verify_sig_runner.c — cycle-accurate harness for the wire-format verify.
 * Drives verify_sig.bin with a blob + the real 130-byte .sig and 130-byte
 * public-key entry (spec §5.4/§5.6), exactly as the device receives them.
 *
 *   ./verify_sig_runner verify_sig.bin <blobHex> <sigHex(260)> <pubkeyHex(260)>
 * Prints "valid" / "invalid" and the verdict byte; exit 0 = valid, 1 = invalid.
 *
 * Z80-side addresses (match verify_sig.asm / rabin_core.inc.asm / sha_core.inc.asm):
 *   msgbuf=0xB000 msglen=0xB100 sigbuf=0xC600 pkbuf=0xC700 result=0xC512
 *
 * Build: gcc -O2 -o verify_sig_runner verify_sig_runner.c
 */
#define CHIPS_IMPL
#include "z80.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>

enum { A_MSGBUF = 0xB000, A_MSGLEN = 0xB100, A_SIG = 0xC600, A_PK = 0xC700, A_RES = 0xC512 };

static uint8_t mem[1 << 16];

static long load(const char *path, uint16_t addr) {
    FILE *f = fopen(path, "rb");
    if (!f) { fprintf(stderr, "cannot open %s\n", path); exit(2); }
    long n = fread(mem + addr, 1, (size_t)(0x10000 - addr), f);
    fclose(f);
    return n;
}

/* decode hex string into buf; returns byte count (-1 on bad input) */
static int unhex(const char *s, uint8_t *buf, int max) {
    int n = 0;
    for (; s[0] && s[1]; s += 2) {
        if (n >= max) return -1;
        int hi, lo;
        if (sscanf(s, "%1x%1x", &hi, &lo) != 2) return -1;
        buf[n++] = (uint8_t)((hi << 4) | lo);
    }
    return s[0] ? -1 : n; /* odd length -> error */
}

int main(int argc, char **argv) {
    if (argc < 5) { fprintf(stderr, "usage: %s code.bin blobHex sigHex pubkeyHex\n", argv[0]); return 2; }
    memset(mem, 0, sizeof(mem));
    long code = load(argv[1], 0x8000);
    (void)code;
    mem[0] = 0xC3; mem[1] = 0x00; mem[2] = 0x80; /* JP 0x8000 */

    uint8_t blob[256], sig[160], pk[160];
    int blen = unhex(argv[2], blob, sizeof(blob));
    int slen = unhex(argv[3], sig, sizeof(sig));
    int plen = unhex(argv[4], pk, sizeof(pk));
    if (blen < 0 || blen > 180) { fprintf(stderr, "bad blob (0..180 bytes)\n"); return 2; }
    if (slen != 130) { fprintf(stderr, "bad .sig: %d bytes (want 130)\n", slen); return 2; }
    if (plen != 130) { fprintf(stderr, "bad pubkey: %d bytes (want 130)\n", plen); return 2; }

    memcpy(mem + A_MSGBUF, blob, blen);
    mem[A_MSGLEN] = (uint8_t)blen;
    memcpy(mem + A_SIG, sig, 130);
    memcpy(mem + A_PK, pk, 130);

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
        if (ticks > limit) { printf("TIMEOUT\n"); return 2; }
    }

    int res = mem[A_RES];
    printf("%s (result=%d, %lluT, %.2fs @3.5MHz)\n", res ? "valid" : "invalid", res,
           ticks, ticks / 3500000.0);
    return res ? 0 : 1;
}
