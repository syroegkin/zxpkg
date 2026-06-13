// Best-effort license detection from a repo's LICENSE/COPYING file.
// Used to fill in a package's license when the manifest doesn't state one.
import * as git from "./git";

const CANDIDATES = [
  "LICENSE", "LICENSE.md", "LICENSE.txt", "LICENCE", "LICENCE.md", "LICENCE.txt",
  "COPYING", "COPYING.txt", "COPYING.md", "UNLICENSE", "UNLICENSE.txt",
];

// Match common licenses by their characteristic phrasing. Returns an SPDX-ish id or null.
export function detectLicenseText(text: string): string | null {
  const t = text.toLowerCase();
  const has = (s: string) => t.includes(s);
  if (has("do what the f")) return "WTFPL";
  if (has("unencumbered software released into the public domain")) return "Unlicense";
  if (has("apache license") && has("version 2.0")) return "Apache-2.0";
  if (has("gnu affero general public license")) return "AGPL-3.0";
  if (has("gnu lesser general public license")) return has("version 3") ? "LGPL-3.0" : "LGPL-2.1";
  if (has("gnu general public license")) {
    if (has("version 3")) return "GPL-3.0";
    if (has("version 2")) return "GPL-2.0";
    return "GPL";
  }
  if (has("mozilla public license") && has("2.0")) return "MPL-2.0";
  if (has("isc license") || has("internet systems consortium")) return "ISC";
  if (has("permission is hereby granted, free of charge")) return "MIT";
  if (has("redistribution and use in source and binary forms")) {
    return has("neither the name") ? "BSD-3-Clause" : "BSD-2-Clause";
  }
  return null;
}

export async function detectRepoLicense(mirrorDir: string): Promise<string | null> {
  for (const name of CANDIDATES) {
    const buf = await git.readFileAtHead(mirrorDir, name);
    if (buf) {
      const lic = detectLicenseText(buf.toString("utf8").slice(0, 4000));
      if (lic) return lic;
    }
  }
  return null;
}
