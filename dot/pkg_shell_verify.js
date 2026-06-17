// pkg_shell_verify.js — host side of `make esx-shell`.  Given a command string,
// derive the output the `.pkg` command SHOULD print (from the same index.json the
// device reads as index.dat) and compare it byte-for-byte to /OUT.TXT that the
// Z80 harness (pkg_shell_esx.asm + pkg_main.inc.asm) actually wrote.  This is a
// Node<->Z80 parity check of the whole dispatch/query/format surface.
//
//   node pkg_shell_verify.js <esxroot> "<command>"
//
// Machine filter mirrors set_machine: srch_mach = $FF (all bits) -> everything
// compatible. machine is a known-good SET (bitfield), matched by AND-overlap.

const fs = require("fs");
const path = require("path");

const esxroot = process.argv[2];
const command = process.argv[3] || "";
const idx = require("../spec/vectors/index.json");

const CR = "\r"; // device prints byte 13
const SRCH_MACH = 0xff; // set_machine default = $FF (all bits; no HW filter yet)
const MACH_BIT = { "16k": 1, "48k": 2, "128k": 4, "next": 8, "zxuno": 16 };
const MACH_ORDER = ["16k", "48k", "128k", "next", "zxuno"]; // bit order (print_mach)

function machBits(r) {
  return (r.machine_csv || "")
    .split(",").map((s) => s.trim()).filter(Boolean)
    .reduce((f, m) => f | (MACH_BIT[m] || 0), 0);
}
// Mirror print_mach: each set bit's name in bit order, each followed by a space.
function machNames(r) {
  const bits = machBits(r);
  let s = "";
  for (let i = 0; i < MACH_ORDER.length; i++) if (bits & (1 << i)) s += MACH_ORDER[i] + " ";
  return s;
}

function summary(r) {
  return `${r.name} v${r.version}${CR}`;
}
function detail(r) {
  // info prints the latest-version detail, then a "versions:" list of every version
  // of the same package (device walks all index records with a matching name).
  const versions = idx.rows.filter((x) => x.name === r.name);
  return (
    `name: ${r.name}${CR}` +
    `ver:  ${r.version}${CR}` +
    `type: ${r.type}${CR}` +
    `cmd:  ${r.command}${CR}` +
    `mach: ${machNames(r)}${CR}` +
    `size: ${r.size}${CR}` +
    `desc: ${r.description}${CR}` +
    `versions:${CR}` +
    versions.map((x) => `  v${x.version}${CR}`).join("")
  );
}
function compatible(r) {
  return (machBits(r) & SRCH_MACH) !== 0;
}

const USAGE =
  "ZXPkg .pkg commands:" + CR +
  " status          installed" + CR +
  " list            registry" + CR +
  " search <term>" + CR +
  " info <name>" + CR +
  " scan            rebuild DB" + CR +
  " remove <name>" + CR +
  " env             machine/os" + CR +
  " (install/update: .pkg-inst)" + CR;

function expectedFor(cmd) {
  const sp = cmd.indexOf(" ");
  const tok = (sp < 0 ? cmd : cmd.slice(0, sp)).toLowerCase();
  const arg = sp < 0 ? "" : cmd.slice(sp + 1).replace(/^ +/, "");
  const rows = idx.rows;

  if (tok === "") {
    throw new Error("empty command (scan) is not driven by esx-shell");
  }
  if (tok === "list" || tok === "search") {
    const needle = (tok === "search" ? arg : "").toLowerCase();
    const hits = rows.filter(
      (r) => compatible(r) && r.name.includes(needle)
    );
    return hits.length ? hits.map(summary).join("") : "no matches" + CR;
  }
  if (tok === "info") {
    if (arg === "") return "usage: info <name>" + CR;
    const r = rows.find((x) => x.name === arg.toLowerCase());
    return r ? detail(r) : "not found" + CR;
  }
  if (tok === "help") return USAGE;
  // install/update now live in the separate .pkg-inst dot
  if (tok === "install" || tok === "update") return "use .pkg-inst" + CR;
  if (tok === "remove") return "/DOT/" + arg + " - not removed" + CR;
  // unknown command: "unknown command\r" + usage
  return "unknown command" + CR + USAGE;
}

const expected = Buffer.from(expectedFor(command), "latin1");
const outPath = path.join(esxroot, "OUT.TXT");
let got;
try {
  got = fs.readFileSync(outPath);
} catch {
  console.log(`esx-shell "${command}": FAIL — no OUT.TXT written`);
  process.exit(1);
}

if (Buffer.compare(got, expected) === 0) {
  console.log(`esx-shell "${command}": PASS`);
} else {
  console.log(`esx-shell "${command}": FAIL`);
  console.log("  expected:", JSON.stringify(expected.toString("latin1")));
  console.log("  got:     ", JSON.stringify(got.toString("latin1")));
  process.exit(1);
}
