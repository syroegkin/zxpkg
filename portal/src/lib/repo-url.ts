// Parse an https repo URL into the pieces the archive needs.
export interface RepoRef {
  host: string; // github.com, gitlab.com, ...
  owner: string;
  repo: string;
  ownerRepo: string; // owner/repo
  cloneUrl: string; // normalized https clone URL
}

export function parseRepoUrl(url: string): RepoRef {
  const u = new URL(url.trim());
  const host = u.hostname.replace(/^www\./, "");
  const parts = u.pathname.replace(/^\/+/, "").replace(/\.git$/, "").split("/").filter(Boolean);
  const owner = parts[0] || "unknown";
  const repo = parts.slice(1).join("/") || "repo";
  return {
    host,
    owner,
    repo,
    ownerRepo: `${owner}/${repo}`,
    cloneUrl: `https://${host}/${owner}/${repo}.git`,
  };
}
