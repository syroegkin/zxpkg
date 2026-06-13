// Serialize a validated Manifest into .zxpkg.toml text for the public wizard.
import type { Manifest } from "./manifest";

function q(s: string): string {
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}
function arr(xs: string[]): string {
  return "[" + xs.map(q).join(", ") + "]";
}

export function manifestToToml(m: Manifest): string {
  const lines: string[] = [];
  lines.push("[package]");
  lines.push(`name        = ${q(m.name)}`);
  lines.push(`version     = ${q(m.version)}`);
  lines.push(`type        = ${q(m.type)}`);
  if (m.description) lines.push(`description = ${q(m.description)}`);
  if (m.author) lines.push(`author      = ${q(m.author)}`);
  if (m.license) lines.push(`license     = ${q(m.license)}`);
  if (m.homepage) lines.push(`homepage    = ${q(m.homepage)}`);

  lines.push("");
  lines.push("[compat]");
  lines.push(`machine  = ${q(m.machine)}`);
  lines.push(`os       = ${arr(m.os)}`);
  lines.push(`needs    = ${arr(m.needs)}`);
  if (m.minCore) lines.push(`min_core = ${q(m.minCore)}`);

  for (const a of m.artifacts) {
    lines.push("");
    lines.push("[[artifact]]");
    lines.push(`src     = ${q(a.src)}`);
    lines.push(`command = ${q(a.command)}`);
  }

  return lines.join("\n") + "\n";
}
