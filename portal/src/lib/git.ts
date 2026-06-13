// Thin git wrapper using execFile (argument arrays — no shell, binary-safe output).
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const pexecFile = promisify(execFile);
const MAX_BUFFER = 128 * 1024 * 1024; // generous cap for archives/binaries

async function git(args: string[], cwd?: string): Promise<Buffer> {
  const { stdout } = await pexecFile("git", args, {
    cwd,
    encoding: "buffer",
    maxBuffer: MAX_BUFFER,
  });
  return stdout as unknown as Buffer;
}

// Resolve the remote default-branch commit without cloning.
export async function lsRemoteHead(cloneUrl: string): Promise<string | null> {
  const out = (await git(["ls-remote", cloneUrl, "HEAD"])).toString("utf8");
  const m = out.match(/^([0-9a-f]{40})\s+HEAD/m);
  return m ? m[1] : null;
}

// Create the bare mirror on first sight, or incrementally fetch on re-crawl.
export async function ensureMirror(cloneUrl: string, dir: string): Promise<void> {
  if (existsSync(dir)) {
    await git(["-C", dir, "remote", "update", "--prune"]);
  } else {
    mkdirSync(dirname(dir), { recursive: true });
    await git(["clone", "--mirror", cloneUrl, dir]);
  }
}

// List all manifest files in the repo at HEAD: the root `.zxpkg.toml` and any
// `*.zxpkg.toml` (so one repo can ship many packages). Returns repo-relative paths.
export async function listManifests(dir: string): Promise<string[]> {
  try {
    const out = (await git(["-C", dir, "ls-tree", "-r", "--name-only", "HEAD"])).toString("utf8");
    return out
      .split("\n")
      .map((s) => s.trim())
      .filter((p) => p === ".zxpkg.toml" || p.endsWith(".zxpkg.toml"));
  } catch {
    return [];
  }
}

// Read a file at the mirror's HEAD (works on a bare repo). Buffer or null if absent.
export async function readFileAtHead(dir: string, path: string): Promise<Buffer | null> {
  try {
    return await git(["-C", dir, "show", `HEAD:${path}`]);
  } catch {
    return null;
  }
}

// Commit at the mirror's local HEAD (used when the remote is unreachable).
export async function localHead(dir: string): Promise<string | null> {
  try {
    return (await git(["-C", dir, "rev-parse", "HEAD"])).toString("utf8").trim();
  } catch {
    return null;
  }
}

// Gzip tarball of the tree at a given ref/commit (on-demand source download).
export async function archiveRef(dir: string, ref: string, prefix: string): Promise<Buffer> {
  return git(["-C", dir, "archive", "--format=tar.gz", `--prefix=${prefix}/`, ref]);
}
