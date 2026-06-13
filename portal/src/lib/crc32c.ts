// CRC-32C (Castagnoli) — the canonical identity hash for ZXPkg artifacts.
// Parameters (must match the on-device Z80 implementation exactly):
//   reflected polynomial 0x82F63B78 (i.e. 0x1EDC6F41), init 0xFFFFFFFF,
//   reflect in/out, xorout 0xFFFFFFFF.
const POLY = 0x82f63b78;

const table = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? POLY ^ (c >>> 1) : c >>> 1;
  table[n] = c >>> 0;
}

export function crc32c(buf: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function crc32cHex(buf: Uint8Array): string {
  return crc32c(buf).toString(16).padStart(8, "0");
}
