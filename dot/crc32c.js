// crc32c.js — shared CRC-32C (Castagnoli) for the host-side verify scripts.
// Same parameters as portal/src/lib/crc32c.ts and the device crc_core.inc.asm:
// reflected poly 0x82F63B78, init 0xFFFFFFFF, xorout 0xFFFFFFFF.
const POLY = 0x82f63b78;
const tbl = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? POLY ^ (c >>> 1) : c >>> 1;
  tbl[n] = c >>> 0;
}
module.exports.crc32c = (b) => {
  let c = 0xffffffff;
  for (const x of b) c = (c >>> 8) ^ tbl[(c ^ x) & 0xff];
  return (c ^ 0xffffffff) >>> 0;
};
