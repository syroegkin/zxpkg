# gopher-hub (maintainer notes — not served)

The Gophernicus hub for `gopher.zx.in.net:70`. Serves ONE tree composed by
bind-mounting each service's subtree under `/srv/gopher` (see `../docker-compose.yml`).

`root/gophermap` is the **client-facing** root menu — keep it client-only (a title
+ one link per service). No build/maintenance text in there; that's what this file
is for.

## Add a service

1. In `../docker-compose.yml`, add a read-only mount:
   `./<svc>/gopher:/srv/gopher/<svc>:ro`
2. Pre-create the mountpoint (the parent `/srv/gopher` is read-only, so Docker
   can't mkdir it): `mkdir -p root/<svc>`
3. Add one line to `root/gophermap`:
   `1<Display name>` `<TAB>` `/<svc>` `<TAB>` `gopher.zx.in.net` `<TAB>` `70`
4. The service produces its own subtree (a `gophermap` + files) in its own repo.

## Notes
- `-w 64` matches nihirash's Moon Rabbit ZX client width; keep gophermap display
  text ≤ 64 columns.
- Gophernicus runs as `nobody` (via socat `su=`); mounted files must be world-readable.
- `gopher.zx.in.net` must be grey-cloud (DNS-only) — Cloudflare doesn't proxy gopher.
- First build is unverified-from-source — confirm `docker compose build gopher`,
  then byte-compare a fetched file against the source before trusting it.
