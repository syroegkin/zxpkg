/* sha_full_runner.c  bin  "message"  expected_hex   -> PASS/FAIL */
#define CHIPS_IMPL
#include "z80.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
static uint8_t mem[1<<16];
int main(int argc,char**argv){
    if(argc<4){fprintf(stderr,"usage: %s bin msg exphex\n",argv[0]);return 2;}
    memset(mem,0,sizeof mem);
    FILE*f=fopen(argv[1],"rb"); if(!f){perror("open");return 2;}
    fread(mem+0x8000,1,0x8000,f); fclose(f);
    mem[0]=0xC3;mem[1]=0;mem[2]=0x80;
    const char*msg=argv[2]; int len=strlen(msg);
    memcpy(mem+0xB000,msg,len);
    mem[0xB100]=(uint8_t)len;
    z80_t cpu; uint64_t pins=z80_init(&cpu); unsigned long long t=0;
    for(;;){ pins=z80_tick(&cpu,pins); if(++t>500000000ULL){printf("TIMEOUT\n");return 2;}
        if(pins&Z80_MREQ){uint16_t a=Z80_GET_ADDR(pins);
            if(pins&Z80_RD)pins=(pins&~0xFF0000ULL)|((uint64_t)mem[a]<<16);
            else if(pins&Z80_WR)mem[a]=(uint8_t)((pins>>16)&0xFF);}
        if(pins&Z80_HALT)break; }
    char got[65]; for(int i=0;i<32;i++)sprintf(got+2*i,"%02x",mem[0xA400+i]); got[64]=0;
    int ok=strcmp(got,argv[3])==0;
    printf("len=%-3d %s  got=%s\n", len, ok?"PASS":"FAIL", got);
    return ok?0:1;
}
