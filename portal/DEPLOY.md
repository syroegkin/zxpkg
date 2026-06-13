# Deploying ZXPkg Portal — serving files to the device

The portal is HTTPS for humans, but the Spectrum (Next) can't do TLS. Every file
the device consumes is **signed (Rabin-Williams / SHA-256)** and verified on-device,
so the transport doesn't need to be trusted — it just needs to deliver the bytes
**unmodified**. Two ways to serve the device; pick one.

| | Device transport | Pro | Con |
|---|---|---|---|
| **A. Gopher** (recommended) | Gophernicus on `:70` | website stays **pure HTTPS** (no plain-HTTP carve-out); trivial protocol | must serve **binary-clean** (see gotcha); we write the device fetch |
| **B. HTTP** | the Next's `.http` over plain HTTP | `.http` is built-in (zero device code) | needs a plain-HTTP carve-out in the reverse proxy |

Either way the **deploy checklist** at the bottom applies.

---

## A. Gopher (Gophernicus)

Gopher item retrieval is "connect → send selector + CRLF → read bytes → server
closes." Gophernicus serves a filesystem tree where **selector = path under the
gopher root**. We expose only the device files (never `mirrors/`).

### Gopher root layout (symlinks into the store — zero copy)

The worker already writes the signed files into the store. Symlink just the two
device subtrees into the gopher root:

```sh
STORE=/data/store          # your STORE_DIR volume
GROOT=/srv/gopher/zxpkg    # gophernicus root (use -r)

mkdir -p "$GROOT"
ln -s "$STORE/index"     "$GROOT/index"       # -> /index/v1.dat (+ .sig)
ln -s "$STORE/artifacts" "$GROOT/artifacts"   # -> /artifacts/<pkg>/<ver>/<cmd> (+ .sig)
# do NOT link $STORE/mirrors (git clones; internal, large)
```

Resulting **selectors** the device fetches:

| selector | file |
|---|---|
| `/index/v1.dat` | signed index |
| `/index/v1.dat.sig` | its signature |
| `/artifacts/<pkg>/<ver>/<cmd>` | an artifact |
| `/artifacts/<pkg>/<ver>/<cmd>.sig` | its signature |

### Run Gophernicus

```sh
# standalone (port 70 needs root or a cap); -h = the hostname clients use
gophernicus -r /srv/gopher/zxpkg -h pkg.zx.in.net -p 70
# (or via systemd socket / inetd — see gophernicus docs)
```

### ⚠️ The one make-or-break gotcha: serve BINARY, not gopher-text

If Gophernicus treats `index.dat`/`.sig`/artifacts as gopher **text** (type `0`)
it will mangle them — CRLF translation, dot-stuffing lines that start with `.`,
and a trailing `.` terminator — and **the signature verify will fail**. They must
be served as **binary** (raw bytes, no terminator). Gophernicus generally detects
binary content and serves it raw, but the no-extension command files and `.dat`/
`.sig` are exactly the borderline cases, so **verify it** (next section). If it
mangles, force binary via Gophernicus's filetype mapping / a per-dir gophermap, or
give the files a binary-recognised extension.

### Verify binary-clean delivery (do this before trusting it)

Fetch a file over gopher and byte-compare to the original:

```sh
printf '/index/v1.dat\r\n' | nc pkg.zx.in.net 70 > got.dat
cmp got.dat /data/store/index/v1.dat && echo "BINARY-CLEAN OK" || echo "MANGLED -> fix types"
```

`cmp` clean = the device will verify. Any difference = Gophernicus altered the
bytes; fix the type handling before going further.

### Device side

The device fetch (`.pkg-get`, eventually folded into `.pkg-inst`) connects to
`host:70`, sends `"/index/v1.dat\r\n"`, reads raw until the server closes ->
that's the file. No request line, no headers to parse — much simpler than HTTP.

### ⚠️ Bootstrap still needs a small plain-HTTP set

A stock Next has **no gopher client** — its built-in fetcher is `.http` (plain
HTTP). So the **one-line installer** path requires these to answer on plain
HTTP (`:80`, no redirect) even in a gopher deployment:

| path | used by |
|---|---|
| `/install.bas` | the user's first `.http get` (tokenized NextBASIC installer) |
| `/dist/PKG`, `/dist/PKG-INST` (+ `.sig`) | the installer fetching the client |
| `/index/v1.dat` (+ `.sig`) | the installer's first index update |

After bootstrap, the client's own fetches use gopher. (Skip this carve-out only
if you're happy telling users to copy the client onto the SD by hand.)

---

## B. HTTP (alternative — works today with `.http`)

If you'd rather use HTTP, the device's built-in `.http` handles it (no device code
from us). These five paths must answer on **port 80, plain HTTP, no redirect**:

| path | serves |
|---|---|
| `/index/v1.dat` (+ `.sig`) | signed index |
| `/artifact/<name>/<version>/<command>` (+ `.sig`) | artifact |
| `/pubkey` | public key |

Everything else (`/`, `/<name>`, `/api/*`, `/admin`) stays HTTPS-only. Reverse-proxy
the device paths on `:80` and redirect the rest to `:443`:

```nginx
server {                       # :80 — device paths pass through; humans -> HTTPS
    listen 80; server_name pkg.zx.in.net;
    location /index/    { proxy_pass http://127.0.0.1:3000; }
    location /artifact/ { proxy_pass http://127.0.0.1:3000; }
    location = /pubkey  { proxy_pass http://127.0.0.1:3000; }
    location / { return 301 https://$host$request_uri; }
}
server { listen 443 ssl; server_name pkg.zx.in.net; location / { proxy_pass http://127.0.0.1:3000; } }
```

The Next app never force-redirects, so it serves these over plain HTTP as-is.
Verify: `curl -sI http://pkg.zx.in.net/index/v1.dat` -> `200` + `Content-Length`.
Device: `.http get -h pkg.zx.in.net -u /index/v1.dat -f /CACHE/INDEX.DAT` (see
`dot/WIFI.md`).

---

## Deploy checklist (first live run — transport-agnostic)

Not yet exercised end-to-end against a live DB, so on the first deploy, in order:

1. **`.env`** — from `.env.example`; set `DB_PASSWORD`, `ADMIN_TOKEN`, `PUBLIC_BASE_URL`.
2. **Generate the signing key BEFORE first `up`** (else sigs/pubkey break):
   `docker compose run --rm web npm run genkey -- /data/keys`
3. **Seed ≥1 repo** in `repos.yaml` — **`index/v1.dat` doesn't exist until the
   worker has crawled a package and compiled the index** (a fresh empty registry
   has no index file to serve; that's expected).
4. `docker compose up -d --build` — `migrate` applies schema, `web` on `:3000`,
   `worker` crawls.
5. Put the chosen front (Gophernicus on `:70`, and/or the HTTPS proxy) in place.
6. **Verify binary-clean delivery** (gopher: `cmp`; http: `curl -sI`) before
   pointing the Next at it.
