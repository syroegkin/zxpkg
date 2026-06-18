// Thin Subversion wrapper, mirroring the git.ts interface so the archiver can treat both
// the same way (see vcs.ts). execFile with argument arrays — no shell. The "mirror" here
// is a working-copy checkout (SVN has no bare mirror), so readFileAtHead/listManifests
// read the checked-out tree from disk and "HEAD" is the latest revision number.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync } from "node:fs";
import { readdir, readFile, mkdtemp, rm } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";

const pexecFile = promisify(execFile);
const MAX_BUFFER = 128 * 1024 * 1024;
const BASE = ["--non-interactive", "--trust-server-cert"];

async function svn(args: string[], cwd?: string): Promise<Buffer> {
  const { stdout } = await pexecFile("svn", args, { cwd, encoding: "buffer", maxBuffer: MAX_BUFFER });
  return stdout as unknown as Buffer;
}

// Latest remote revision (e.g. "42"), without checking out. null if unreachable.
export async function lsRemoteHead(url: string): Promise<string | null> {
  try {
    const out = (await svn(["info", "--show-item", "revision", "--no-newline", ...BASE, url])).toString("utf8").trim();
    return /^\d+$/.test(out) ? out : null;
  } catch {
    return null;
  }
}

// Check out on first sight; `svn update` on re-crawl.
export async function ensureMirror(url: string, dir: string): Promise<void> {
  if (existsSync(dir)) {
    await svn(["update", ...BASE, dir]);
  } else {
    mkdirSync(dirname(dir), { recursive: true });
    await svn(["checkout", ...BASE, url, dir]);
  }
}

// All *.zxpkg.toml in the working copy (recursive, skipping .svn). Repo-relative paths.
export async function listManifests(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(d: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === ".svn") continue;
      const full = join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.name === ".zxpkg.toml" || e.name.endsWith(".zxpkg.toml")) {
        out.push(relative(dir, full).split(sep).join("/"));
      }
    }
  }
  await walk(dir);
  return out;
}

// Read a repo-relative file from the checked-out tree. Guards against path traversal
// (manifest artifact `src` is repo-relative; never let it escape the working copy).
export async function readFileAtHead(dir: string, path: string): Promise<Buffer | null> {
  const target = resolve(dir, path);
  const root = resolve(dir);
  if (target !== root && !target.startsWith(root + sep)) return null;
  try {
    return await readFile(target);
  } catch {
    return null;
  }
}

// Local working-copy revision (used when the remote is unreachable).
export async function localHead(dir: string): Promise<string | null> {
  try {
    const out = (await svn(["info", "--show-item", "revision", "--no-newline", dir])).toString("utf8").trim();
    return /^\d+$/.test(out) ? out : null;
  } catch {
    return null;
  }
}

// Gzip tarball of the tree (on-demand source download). `ref` is ignored — we tar the
// current checkout (HEAD). Exports a clean tree (no .svn) into a prefix dir, then tars it.
export async function archiveRef(dir: string, _ref: string, prefix: string): Promise<Buffer> {
  const base = await mkdtemp(join(tmpdir(), "zxsvn-"));
  const exportDir = join(base, prefix);
  try {
    await svn(["export", "--force", ...BASE, dir, exportDir]);
    const { stdout } = await pexecFile("tar", ["-czf", "-", "-C", base, prefix], {
      encoding: "buffer",
      maxBuffer: MAX_BUFFER,
    });
    return stdout as unknown as Buffer;
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}
