# ZXPkg Portal

The web portal, registry and **preservation archive** for ZX Spectrum dot commands —
the server half of [ZXPkg](../plans/00-overview.md). It indexes developers' repos, mirrors
a full copy (source + binaries), serves a signed device-facing index, and presents an
npm-style catalog. Intended to run at `pkg.zx.in.net`.

## What it does

- **Indexes repos** that contain a `.zxpkg.toml` manifest (see `examples/.zxpkg.toml`).
- **Archives** each repo with `git clone --mirror` and mirrors every artifact binary, so the
  catalog keeps working even if upstream disappears.
- **Signs** every artifact and the compiled `index.dat` (Rabin-Williams-1024 over SHA-256; see
  `../plans/01-spec.md` §5 — verifies in a single modular squaring on a plain Z80).
- **Serves** a browsable/searchable catalog (SSR) plus device + machine endpoints.

## Architecture

- **web** — Next.js (App Router, server-rendered) catalog + JSON API + device endpoints.
- **worker** — background process: applies the DB schema, seeds repos, drains manual crawl
  requests, and re-crawls every ~6 h.
- **MariaDB** — registry.
- **store/** volume — git mirrors, artifacts + signatures, compiled `index.dat`.

## Quick start (Docker Compose)

```sh
cp .env.example .env
# edit .env: set ADMIN_TOKEN, DB_PASSWORD, PUBLIC_BASE_URL (e.g. https://pkg.zx.in.net)

# generate the signing keypair into ./keys (mounted at /data/keys)
docker compose run --rm web npm run genkey -- /data/keys

docker compose up -d --build
# web on http://localhost:3000 ; worker seeds repos.yaml and crawls on boot
```

**Migrations** run automatically: a one-shot `migrate` service applies `db/schema.sql`
(CREATE-IF-NOT-EXISTS plus idempotent `ALTER … ADD COLUMN IF NOT EXISTS`) before `web`
and `worker` start, so existing databases are upgraded on every `up`. To upgrade after
pulling changes: `docker compose up -d --build` (re-runs `migrate`).

> The seed repo (`syroegkin/dots`) needs a `.zxpkg.toml` at its default branch before it
> will index — until then it shows as `errored` in `/admin` (manifest not found). Add the
> manifest (see `examples/.zxpkg.toml`) or register another repo via `/admin`.

## Local development

```sh
npm install
npm run genkey                 # writes ./keys/{private,public}.json
# point a local MariaDB via .env (DB_HOST=127.0.0.1), then:
npm run worker                 # schema + seed + crawl loop
npm run dev                    # Next dev server on :3000
```

## Endpoints

Human (HTTPS):

| path | purpose |
|------|---------|
| `/` | catalog + search (`?q=&machine=&os=`) |
| `/<name>` | package page (SSR, JSON-LD, canonical) |
| `/admin` | admin console — **cookie login** with `ADMIN_TOKEN`; hidden from non-admins. Add `.zxpkg.toml` repos, **add packages manually** (no manifest needed), view repo status |
| `/sitemap.xml`, `/robots.txt` | SEO |

Machine / device (plain HTTP is fine — integrity comes from signatures):

| path | purpose |
|------|---------|
| `/index/v1.dat` (+ `.sig`) | compiled binary index |
| `/artifact/<name>/<version>/<command>` (+ `.sig`) | a verified binary |
| `/source/<name>/<version>.tar.gz` | on-demand source tarball |
| `/api/search`, `/api/package/<name>`, `/api/crc/<hex>` | JSON |
| `/pubkey` | signing public key (PEM) + `X-Key-Id` |

## Publishing a package

**Don't want to hand-write TOML?** The public **wizard at `/new`** (linked as "Publish" in the
header) generates a `.zxpkg.toml` from a form — copy the output or download the file, drop it
in your repo root, then add the repo below.

### Layout: one manifest per package

The crawler reads **every `*.zxpkg.toml` in the repo**, and each file describes **one
package**. (We deliberately don't use a single root file listing many packages — one file
per package keeps the format simple and self-contained.)

- **Single package** → `.zxpkg.toml` in the repo root.
- **Many packages, per-package folders** → `morse/.zxpkg.toml`, `md5sum/.zxpkg.toml`, …
- **Many packages, flat layout** (binaries in `build/`) → `morse.zxpkg.toml`,
  `md5sum.zxpkg.toml`, … in the root.

Several files that install together as **one** tool stay in a single manifest with multiple
`[[artifact]]` blocks. An invalid manifest only fails its own package, not the whole repo.

### Adding it

**Self-serve (anyone):** use the **wizard at `/new`** — generate the manifest, commit it, then
**"Add your repo"** submits the public git URL. The portal watches it and indexes it once a
`.zxpkg.toml` is present (and re-indexes on every push). No admin needed.

> Public submissions are restricted to known git hosts (GitHub, GitLab, Codeberg, Bitbucket,
> sr.ht) and validated against SSRF (no loopback/private/metadata hosts). Repos without a
> manifest sit as **watching** and never appear in the catalog until indexed; admins can prune
> the repo list. Rate-limiting/claim hardening is a later step.

**Admin ways:**

1. **With a manifest** — add `.zxpkg.toml` (see `examples/`) to your repo's default branch,
   then register the repo in `repos.yaml` (seed) or via `/admin`. Bump `package.version` to
   publish a new version; the worker archives it on the next crawl.
2. **Manually (admin)** — for repos you can't modify or that have no manifest (e.g. a
   collection like `syroegkin/dots` with several commands), use the **Add a package
   manually** form in `/admin`. Define name, version, `type`, compat, and each `command` +
   `src` (a repo path *or* a binary URL). Add multiple packages to one repo this way.
   **If a `.zxpkg.toml` later appears in that repo, it automatically supersedes the manual
   entry of the same name** (the repo's own manifest wins; the manual stopgap is dropped).
3. **Upload a binary (admin)** — when there's **no repo at all** (orphaned file, source
   lost), use the **Upload a binary** form in `/admin`: attach the file + metadata and the
   portal archives it directly (CRC + signature + index), repo-less. No source download for
   these.

If you leave **`description`** or **`license`** blank, the crawler fills them in from the
repo's **README** (first prose line) and **LICENSE/COPYING** file respectively.

Every package has a **`type`** (free-form slug: `dot`, `game`, `util`, `demo`, …; default
`dot`) telling the device where to install it. Self-service claim + a manifest wizard come
in a later step (`../plans/06-dev-selfservice.md`).

## Branding

The logo uses the **ZX Spectrum rainbow** (red `#ff0002` / yellow `#fdff00` / green `#00ff03`
/ cyan `#01fffe`) and a pixel wordmark. The pixel font defaults to **Press Start 2P**
(self-hosted via `next/font`). To use an **authentic ZX Spectrum font**, drop a `.woff2` at
`public/fonts/zx-spectrum.woff2` — the `@font-face` in `globals.css` will pick it up
automatically (e.g. ZX Spectrum-7). Mind licensing for any font you bundle.

## Hosting

Runs on its own subdomain (`pkg.zx.in.net`); `BASE_PATH` stays empty. To host under a
subdirectory instead, set `BASE_PATH=/pkg`.

## Configuration

See `.env.example`. Key vars: `DB_*`, `ADMIN_TOKEN`, `STORE_DIR`, `SIGN_*`,
`POLL_INTERVAL_MS`, `SEED_FILE`, `PUBLIC_BASE_URL`, `BASE_PATH`.
