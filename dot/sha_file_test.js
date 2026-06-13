// sha_file_test.js — validate streaming SHA-256 (sha_fd) over files of many
// sizes, hitting every padding edge case (<56, ==56, >56, exact ×64).  For each
// size: write /HASHME, run sha_file_esx.sna in ZEsarUX, read /SHA.DAT, compare
// to the host SHA-256.  Exit 0 if all match.
// Usage: node sha_file_test.js [esxdos_root]
const { execFileSync } = require("child_process");
const fs = require("fs");
const crypto = require("crypto");
const path = require("path");

const ROOT = path.resolve(process.argv[2] || "esxdos_root");
const ZES = "../.toolchain/bin/zesarux";
const ROM = "../.toolchain/roms/48.rom";
const sizes = [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 128, 200, 1000];

fs.mkdirSync(ROOT, { recursive: true });
let ok = true;
for (const n of sizes) {
  const data = Buffer.alloc(n);
  for (let i = 0; i < n; i++) data[i] = (i * 7 + 1) & 0xff; // deterministic pattern
  fs.writeFileSync(path.join(ROOT, "HASHME"), data);
  try { fs.unlinkSync(path.join(ROOT, "SHA.DAT")); } catch {}
  try {
    execFileSync(ZES, ["--machine", "48k", "--romfile", ROM, "--vo", "null", "--ao", "null",
      "--noconfigfile", "--emulatorspeed", "10000", "--enable-esxdos-handler",
      "--esxdos-root-dir", ROOT, "--snap", "sha_file_esx.sna"],
      { timeout: 3000, stdio: "ignore" });
  } catch {} // ZEsarUX never exits on its own; the timeout is expected
  let got = "(no SHA.DAT)";
  try { got = fs.readFileSync(path.join(ROOT, "SHA.DAT")).toString("hex"); } catch {}
  const want = crypto.createHash("sha256").update(data).digest("hex");
  const pass = got === want;
  if (!pass) ok = false;
  console.log(`  ${String(n).padStart(4)} bytes  ${pass ? "OK" : "MISMATCH"}` +
    (pass ? "" : `\n    got  ${got}\n    want ${want}`));
}
console.log(ok ? "sha-stream: PASS" : "sha-stream: FAIL");
process.exit(ok ? 0 : 1);
