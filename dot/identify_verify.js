// identify_verify.js — verify the device's /INSTALL.DAT (the installed-package DB).
// Record: [u8 fnamelen][fname][u8 status][u32 crc LE]{ if status: [u8 nl][name][u8 vl][ver] }
//   status: 0 unmanaged | 1 current | 2 outdated
// Checks the known fixture mapping and that each CRC matches the host file.
// Usage: node identify_verify.js <esxdos_root>
const fs = require("fs");
const path = require("path");
const { crc32c } = require("./crc32c");

const root = path.resolve(process.argv[2] || "esxdos_root");
const dat = fs.readFileSync(path.join(root, "ZXPKG", "INSTALL.DAT"));
const got = {};
let p = 0;
while (p < dat.length) {
  const fn = dat.slice(p + 1, p + 1 + dat[p]).toString("latin1"); p += 1 + dat[p];
  const status = dat[p++];
  const crc = dat.readUInt32LE(p); p += 4;
  let name = "", ver = "";
  if (status) { name = dat.slice(p + 1, p + 1 + dat[p]).toString("latin1"); p += 1 + dat[p];
                ver = dat.slice(p + 1, p + 1 + dat[p]).toString("latin1"); p += 1 + dat[p]; }
  got[fn] = { status, crc, name, ver };
}

// ABC/CHECK: file CRC == index latest -> current (1); EXTRA: no command -> unmanaged (0)
const expect = {
  ABC: { status: 1, name: "alpha", ver: "1.0", dir: "DOT" },
  CHECK: { status: 1, name: "checker", ver: "2.1", dir: "DOT" },
  BIGGY: { status: 1, name: "biggy", ver: "3.0", dir: "DOT" }, // >8KB: streaming CRC must match whole file
  EXTRA: { status: 0, name: "", ver: "", dir: "DOT" },
  BINTOOL: { status: 1, name: "bintool", ver: "1.5", dir: "BIN" }, // in /BIN (esxDOS dir)
};
let ok = true;
for (const [fn, e] of Object.entries(expect)) {
  const g = got[fn];
  const hostCrc = crc32c(fs.readFileSync(path.join(root, e.dir, fn)));
  const pass = g && g.status === e.status && g.name === e.name && g.ver === e.ver && g.crc === hostCrc;
  if (!pass) ok = false;
  const lbl = ["unmanaged", "current", "outdated"][g ? g.status : 0];
  const id = g && g.status ? `${g.name} ${g.ver} ${lbl}` : "unmanaged";
  console.log(`  ${fn.padEnd(7)} -> ${id.padEnd(20)} crc=${(g ? g.crc : 0).toString(16).padStart(8, "0")} ${pass ? "OK" : "MISMATCH"}`);
}
console.log(ok ? "identify: PASS" : "identify: FAIL");
process.exit(ok ? 0 : 1);
