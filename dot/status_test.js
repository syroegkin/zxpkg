// status_test.js — fixture + checker for `.pkg status` (run via the pkg_shell_esx
// harness).  `setup` writes a controlled /PKG/INDEX.DAT and /DOT/* into the esxDOS
// root; `check` reads the /OUT.TXT the device wrote and compares it (order-
// independently — readdir order isn't fixed) to what status should print.
//
//   node status_test.js setup <esxroot>
//   node status_test.js check <esxroot>
//
// Packages exercised: MORSE (file CRC == registry latest -> "ok"), SNAKE (file
// differs from latest -> "UPD"), RANDOM (no matching command -> unmanaged).

const fs = require("fs");
const path = require("path");
const { crc32c } = require("./crc32c");

// the controlled scenario
const MORSE = Buffer.from("morse command v2.0 body");   // installed == latest
const SNAKE_LATEST = Buffer.from("snake command v3.0 body"); // registry's latest
const SNAKE_INSTALLED = Buffer.from("snake command v2.0 OLD");// installed (older)
const RANDOM = Buffer.from("not a registry package");        // unmanaged

// registry records: [crc(latest), cmd, name, ver]
const recs = [
  { crc: crc32c(MORSE),        cmd: "MORSE", name: "morse", ver: "2.0", type: "dot", desc: "" },
  { crc: crc32c(SNAKE_LATEST), cmd: "SNAKE", name: "snake", ver: "3.0", type: "dot", desc: "" },
];

function encStr(s) { const b = Buffer.from(s); return Buffer.concat([Buffer.from([b.length]), b]); }
function encRec(r) {
  const head = Buffer.alloc(10);
  head.writeUInt32LE(r.crc >>> 0, 0);
  head[4] = 0; head[5] = 0; head[6] = 0;            // machine/os/feat (status ignores these)
  head[7] = 0; head[8] = 0; head[9] = 0;            // u24 size
  return Buffer.concat([head, encStr(r.type), encStr(r.cmd), encStr(r.name), encStr(r.ver), encStr(r.desc)]);
}
function encIndex(rs) {
  const hdr = Buffer.from([1, 1, rs.length & 0xff, (rs.length >> 8) & 0xff]); // schema, key_id, u16 count
  return Buffer.concat([hdr, ...rs.map(encRec)]);
}

const CR = "\r";
function expectedLines() {
  // managed lines (order-independent set) + the tally
  return {
    set: new Set([`morse v2.0  ok`, `snake v3.0  update`]),
    tally: `(2 managed, 1 other)`,
  };
}

const mode = process.argv[2];
const root = path.resolve(process.argv[3] || "esxdos_root");

if (mode === "setup") {
  fs.rmSync(path.join(root, "DOT"), { recursive: true, force: true });
  fs.rmSync(path.join(root, "BIN"), { recursive: true, force: true }); // scan walks /BIN too — keep it empty here
  fs.mkdirSync(path.join(root, "DOT"), { recursive: true });
  fs.mkdirSync(path.join(root, "ZXPKG"), { recursive: true });
  fs.writeFileSync(path.join(root, "ZXPKG", "INDEX.DAT"), encIndex(recs));
  fs.writeFileSync(path.join(root, "DOT", "MORSE"), MORSE);
  fs.writeFileSync(path.join(root, "DOT", "SNAKE"), SNAKE_INSTALLED);
  fs.writeFileSync(path.join(root, "DOT", "RANDOM"), RANDOM);
  process.exit(0);
}

if (mode === "check") {
  let out;
  try { out = fs.readFileSync(path.join(root, "OUT.TXT"), "latin1"); }
  catch { console.log("status: FAIL — no OUT.TXT"); process.exit(1); }
  // status reads the cached /INSTALL.DAT — clean lines, no progress dots
  const lines = out.split(CR).filter((l) => l.length);
  const exp = expectedLines();
  const tally = lines[lines.length - 1];
  const body = new Set(lines.slice(0, -1));
  const sameSet = body.size === exp.set.size && [...exp.set].every((l) => body.has(l));
  if (sameSet && tally === exp.tally) {
    console.log("status: PASS");
  } else {
    console.log("status: FAIL");
    console.log("  expected lines:", [...exp.set], "tally:", JSON.stringify(exp.tally));
    console.log("  got lines:     ", [...body], "tally:", JSON.stringify(tally));
    process.exit(1);
  }
}
