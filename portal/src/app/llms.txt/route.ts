import { query } from "@/lib/db";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

// https://llmstxt.org/ — a markdown file that helps LLMs understand the site.
export async function GET() {
  const base = `${env.publicBaseUrl}${env.basePath}`;

  let pkgs: { name: string; description: string | null }[] = [];
  try {
    pkgs = await query(
      `SELECT p.name, p.description
       FROM packages p JOIN versions v ON v.package_id = p.id AND v.is_latest = 1
       WHERE p.archive_state = 'listed'
       ORDER BY p.name LIMIT 500`
    );
  } catch {
    pkgs = [];
  }

  const oneLine = (s: string | null) => (s || "").replace(/\s+/g, " ").trim();

  const lines: string[] = [];
  lines.push("# ZXPkg");
  lines.push("");
  lines.push(
    "> A package registry and preservation archive for ZX Spectrum dot commands and software, " +
      "for the ZX Spectrum Next (NextZXOS) and classic Spectrums with esxDOS / divMMC. Search and " +
      "download packages on the web, or install them on-device with the .pkg client."
  );
  lines.push("");
  lines.push(
    "ZXPkg indexes developers' git repositories, mirrors a complete copy (source + binaries) so " +
      "nothing is lost to link-rot, and serves a signed package index the on-device client installs " +
      "from. Each package has a type (dot command, game, util, …) and compatibility metadata " +
      "(16k / 48k / 128k / next, esxDOS / NextZXOS)."
  );
  lines.push("");

  lines.push("## Packages");
  if (pkgs.length === 0) {
    lines.push("- (no packages indexed yet)");
  } else {
    for (const p of pkgs) {
      const desc = oneLine(p.description);
      lines.push(`- [${p.name}](${base}/${p.name})${desc ? `: ${desc}` : ""}`);
    }
  }
  lines.push("");

  lines.push("## Pages");
  lines.push(`- [Browse and search packages](${base}/): the catalogue, filterable by type, machine and OS`);
  lines.push(`- [Guide](${base}/docs): what dot commands are and how to install them on the Next / esxDOS`);
  lines.push(`- [Publish a package](${base}/new): wizard to generate a .zxpkg.toml manifest and submit a repo`);
  lines.push("");

  lines.push("## Optional");
  lines.push(`- [Sitemap](${base}/sitemap.xml)`);
  lines.push("");

  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
