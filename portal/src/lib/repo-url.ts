// Parse a repo URL into the pieces the archive needs. Supports git and Subversion.
export type Vcs = "git" | "svn";

export interface RepoRef {
  host: string; // github.com, gitlab.com, svn.code.sf.net, ...
  owner: string;
  repo: string;
  ownerRepo: string; // owner/repo (also the mirror-dir slug)
  cloneUrl: string; // normalized clone/checkout URL
  vcs: Vcs;
}

// Heuristic SVN detection from the URL (used when the admin didn't state the type).
function looksLikeSvn(u: URL): boolean {
  const host = u.hostname.replace(/^www\./, "");
  return (
    u.protocol === "svn:" ||
    u.protocol === "svn+ssh:" ||
    /(^|\.)svn\./.test(host) || // svn.code.sf.net, svn.example.org
    /\/svn(\/|$)/.test(u.pathname) // .../svn/... path segment
  );
}

// `hint` forces the type ("git"/"svn"); "auto"/undefined uses URL heuristics.
export function parseRepoUrl(url: string, hint?: Vcs | "auto"): RepoRef {
  const raw = url.trim();
  const u = new URL(raw);
  const host = u.hostname.replace(/^www\./, "");
  const vcs: Vcs = hint === "svn" || hint === "git" ? hint : looksLikeSvn(u) ? "svn" : "git";
  const parts = u.pathname.replace(/^\/+/, "").replace(/\.git$/, "").split("/").filter(Boolean);
  const owner = parts[0] || "unknown";
  const repo = parts.slice(1).join("/") || "repo";
  return {
    host,
    owner,
    repo,
    ownerRepo: `${owner}/${repo}`,
    // git URLs are normalized to https .git; svn checkout URLs are kept verbatim.
    cloneUrl: vcs === "svn" ? raw : `https://${host}/${owner}/${repo}.git`,
    vcs,
  };
}
