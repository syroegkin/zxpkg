import { one } from "@/lib/db";
import { parseRepoUrl, type Vcs } from "@/lib/repo-url";
import { store } from "@/lib/store";
import { archiveRef } from "@/lib/vcs";
import { safeSeg } from "@/lib/serve";

export const dynamic = "force-dynamic";

// On-demand source tarball generated from the mirror at the version's commit.
export async function GET(
  _req: Request,
  { params }: { params: { name: string; version: string } }
) {
  const name = params.name;
  let version = params.version;
  if (version.endsWith(".tar.gz")) version = version.slice(0, -7);

  if (![name, version].every(safeSeg)) return new Response("Bad request", { status: 400 });

  const row = await one<{ commit_sha: string; source_url: string; vcs: Vcs }>(
    `SELECT v.commit_sha, r.source_url, r.vcs
     FROM versions v JOIN packages p ON p.id = v.package_id JOIN repos r ON r.id = p.repo_id
     WHERE p.name = ? AND v.version = ?`,
    [name, version]
  );
  if (!row) return new Response("Not found", { status: 404 });

  const ref = parseRepoUrl(row.source_url, row.vcs);
  const dir = store.mirrorDir(ref.host, ref.ownerRepo);
  try {
    const tar = await archiveRef(row.vcs, dir, row.commit_sha, `${name}-${version}`);
    return new Response(new Uint8Array(tar), {
      headers: {
        "Content-Type": "application/gzip",
        "Content-Disposition": `attachment; filename="${name}-${version}.tar.gz"`,
      },
    });
  } catch {
    return new Response("archive failed", { status: 500 });
  }
}
