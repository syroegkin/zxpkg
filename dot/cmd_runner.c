/* cmd_runner.c — harness for .pkg command parse/dispatch/info logic.
 *   ./cmd_runner cmd_demo.bin <index.dat> "<command line>" <expCmdId> <expFound>
 *     expCmdId : expected cmd_id (0 unknown,1 search,2 list,3 info,4 install,5 remove,6 help)
 *     expFound : for info, expected record index, or "none"; "-" if not checked
 * Exit 0 = all expectations met.
 *
 * Z80 addresses (match cmd_demo.asm / cmd_core.inc.asm / index_search.inc.asm):
 *   ci_in=0x9040 ci_len=0x9042 cmd_id=0x9049 found_idx=0x904A found_flag=0x904B
 *   idxptr=0x9038 cmdline=0x9500 idxdat=0xA000
 */
#define CHIPS_IMPL
#include "z80.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>

enum { A_CI_IN = 0x9040, A_CI_LEN = 0x9042, A_CMD_ID = 0x9049, A_FOUND_IDX = 0x904A,
       A_FOUND_FLAG = 0x904B, A_IDXPTR = 0x9038, A_CMDLINE = 0x9500, A_IDXDAT = 0xA000 };

static uint8_t mem[1 << 16];

int main(int argc, char **argv) {
    if (argc < 6) { fprintf(stderr, "usage: %s cmd_demo.bin index.dat cmdline expCmdId expFound\n", argv[0]); return 2; }
    memset(mem, 0, sizeof(mem));
    FILE *f = fopen(argv[1], "rb");
    if (!f) { fprintf(stderr, "cannot open %s\n", argv[1]); return 2; }
    if (fread(mem + 0x8000, 1, 0x8000, f) == 0) { fprintf(stderr, "empty code\n"); return 2; }
    fclose(f);
    mem[0] = 0xC3; mem[1] = 0x00; mem[2] = 0x80;

    f = fopen(argv[2], "rb");
    if (!f) { fprintf(stderr, "cannot open %s\n", argv[2]); return 2; }
    if (fread(mem + A_IDXDAT, 1, 0x4000, f) < 4) { fprintf(stderr, "bad index.dat\n"); return 2; }
    fclose(f);

    const char *line = argv[3];
    int llen = (int)strlen(line);
    memcpy(mem + A_CMDLINE, line, llen);
    mem[A_CI_IN] = A_CMDLINE & 0xff; mem[A_CI_IN + 1] = (A_CMDLINE >> 8) & 0xff;
    mem[A_CI_LEN] = (uint8_t)llen;
    mem[A_IDXPTR] = A_IDXDAT & 0xff; mem[A_IDXPTR + 1] = (A_IDXDAT >> 8) & 0xff;

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

    int cmd_id = mem[A_CMD_ID];
    int found_flag = mem[A_FOUND_FLAG];
    int found_idx = mem[A_FOUND_IDX];
    int exp_id = atoi(argv[4]);

    int ok = cmd_id == exp_id;
    printf("\"%s\" -> cmd_id=%d (want %d)", line, cmd_id, exp_id);
    if (strcmp(argv[5], "-") != 0) {
        if (strcmp(argv[5], "none") == 0) {
            printf("  info: found=%d (want not-found)", found_flag);
            if (found_flag != 0) ok = 0;
        } else {
            int expf = atoi(argv[5]);
            printf("  info: found=%d idx=%d (want idx %d)", found_flag, found_idx, expf);
            if (!found_flag || found_idx != expf) ok = 0;
        }
    }
    printf("  -> %s\n", ok ? "OK" : "MISMATCH");
    return ok ? 0 : 1;
}
