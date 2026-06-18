// Best-effort description from a repo's README — used when a package states none.
import * as vcs from "./vcs";
import type { Vcs } from "./repo-url";

const CANDIDATES = ["README.md", "README", "README.txt", "README.markdown", "readme.md", "Readme.md"];

function stripMd(s: string): string {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links -> text
    .replace(/[*_`~>#]/g, "") // emphasis / marks
    .replace(/\s+/g, " ")
    .trim();
}

// First prose line of the README (skips headings, badges, HTML, rules). Max ~240 chars.
export async function detectRepoDescription(kind: Vcs, mirrorDir: string): Promise<string | null> {
  for (const name of CANDIDATES) {
    const buf = await vcs.readFileAtHead(kind, mirrorDir, name);
    if (!buf) continue;
    for (const raw of buf.toString("utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith("#")) continue; // heading
      if (line.startsWith("![") || line.startsWith("[![")) continue; // badge / image
      if (line.startsWith("<")) continue; // HTML
      if (/^[-=*_]{3,}$/.test(line)) continue; // horizontal rule
      const text = stripMd(line);
      if (text.length >= 8) return text.slice(0, 240);
    }
  }
  return null;
}
