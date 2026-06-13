// Background worker: applies schema, seeds repos, drains manual crawl requests,
// and re-crawls all repos on a ~6h sweep. Owns the DB lifecycle.
import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { bootstrap, query, exec, one } from "../lib/db";
import { crawlRepo, type RepoRow } from "../lib/archiver";
import { parseRepoUrl } from "../lib/repo-url";
import { env } from "../lib/env";

function log(msg: string): void {
  console.log(`[worker ${new Date().toISOString()}] ${msg}`);
}

async function seedRepos(): Promise<void> {
  let text: string;
  try {
    text = readFileSync(env.seedFile, "utf8");
  } catch {
    log(`no seed file at ${env.seedFile} — skipping`);
    return;
  }
  const doc: any = parseYaml(text) || {};
  const urls: string[] = Array.isArray(doc.repos) ? doc.repos : [];
  for (const url of urls) {
    try {
      const ref = parseRepoUrl(url);
      await exec("INSERT IGNORE INTO repos (source_url, host) VALUES (?,?)", [ref.cloneUrl, ref.host]);
    } catch (e: any) {
      log(`bad seed url "${url}": ${e.message}`);
    }
  }
}

let sweeping = false;
async function crawlAll(): Promise<void> {
  if (sweeping) return;
  sweeping = true;
  try {
    const repos = await query<RepoRow>("SELECT id, source_url, last_commit_sha FROM repos");
    log(`sweep: ${repos.length} repo(s)`);
    for (const r of repos) {
      try {
        const res = await crawlRepo(r);
        log(`  ${res.repo}: ${res.status}${res.version ? " v" + res.version : ""}${res.message ? " — " + res.message : ""}`);
      } catch (e: any) {
        log(`  ${r.source_url}: crawl threw — ${e.message}`);
      }
    }
  } finally {
    sweeping = false;
  }
}

let draining = false;
async function drainQueue(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    const items = await query<{ id: number; repo_id: number }>(
      "SELECT id, repo_id FROM crawl_queue WHERE status='pending' ORDER BY id LIMIT 10"
    );
    for (const it of items) {
      const repo = await one<RepoRow>("SELECT id, source_url, last_commit_sha FROM repos WHERE id=?", [it.repo_id]);
      try {
        if (repo) {
          const res = await crawlRepo(repo);
          log(`queue #${it.id} ${res.repo}: ${res.status}`);
        }
        await exec("UPDATE crawl_queue SET status='done' WHERE id=?", [it.id]);
      } catch (e: any) {
        log(`queue #${it.id} error: ${e.message}`);
        await exec("UPDATE crawl_queue SET status='error' WHERE id=?", [it.id]);
      }
    }
  } finally {
    draining = false;
  }
}

async function main(): Promise<void> {
  log("starting; applying schema…");
  await bootstrap();
  await seedRepos();
  await crawlAll(); // initial sweep on boot

  setInterval(() => crawlAll().catch((e) => log(`sweep error: ${e.message}`)), env.pollIntervalMs);
  setInterval(() => drainQueue().catch((e) => log(`drain error: ${e.message}`)), 5000);
  log(`running. sweep every ${Math.round(env.pollIntervalMs / 1000)}s; queue every 5s.`);
}

main().catch((e) => {
  console.error("[worker] fatal:", e);
  process.exit(1);
});
