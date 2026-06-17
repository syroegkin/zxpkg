# ZXPkg over WiFi (Spectrum Next)

**Chosen transport: GOPHER** (decided after the HTTP bring-up round; see
`../../portal/DEPLOY.md` §A for the server side). Rationale: the HTTPS website
stays pure HTTPS (no plain-HTTP carve-out — the device talks to a separate
Gophernicus service on `:70`), and the device fetch is far simpler than HTTP —
connect, send `"<selector>\r\n"`, read raw bytes until the server closes. No
request line, headers, or status parsing. Integrity still comes from the
**Rabin-Williams signatures** (`.pkg-inst` verifies everything it consumes), so a
plaintext transport is safe by design — a tampered or truncated download is
simply refused.

**`.pkg-inst install`/`update` are self-contained** — they talk to the ESP8266
**directly over the Next UART** (`gopher_uart.inc.asm`, raw AT in transparent mode),
so **no ESPAT driver install is needed** (like `.http`/`.nxtp`). The standalone
**`.pkg-get`** diagnostic still uses the NextZXOS **ESPAT driver** (`M_DRVAPI`).

## One-time Next setup (only for the `.pkg-get` diagnostic)

`.pkg-inst install`/`update` need none of this. Only the standalone `.pkg-get` needs
the ESPAT driver installed (NextZXOS mode; `err=00` from `.pkg-get` means "driver not
installed"). Once per boot — or put it in `autoexec.bas` (the `autoexec-pluspack.bas`
sequence):

```
.install /nextzxos/espat.drv
BANK NEW m: LOAD "/nextzxos/espat.sys" BANK m,0,8192
DRIVER 78,1,m
BANK NEW b: DRIVER 78,6,b
DRIVER 78,9,0
DRIVER 78,3
```

WiFi itself must already be joined (it is — nextsync uses it).

## `update` over WiFi

```
.pkg-get <host> <port> /index/v1.dat     /ZXPKG/CACHE/INDEX.DAT
.pkg-get <host> <port> /index/v1.dat.sig /ZXPKG/CACHE/INDEX.SIG
.pkg-inst update                            -> "index updated"
.pkg list                                   -> the fresh catalogue
```

`.pkg-get` buffers the item in RAM (12 KB cap — the ESPAT docs warn the UART
drops data if the SD is written mid-receive) and writes the file after the
connection closes. Without the `[file]` argument it prints the item to screen
(diagnostic mode). EOF = server close, detected via the driver's `$FE`
end-of-file return or an idle timeout — a short read just means the signature
check refuses the file and you retry.

## `install <name>` over WiFi (smart device — one command)

`.pkg-inst install <name>` does the whole thing itself:
1. resolve `<name>` -> CMD + version from the local `/ZXPKG/INDEX.DAT`,
2. if not already cached, gopher-fetch `<prefix>/artifacts/<name>/<ver>/<CMD>(.sig)`
   into `/ZXPKG/CACHE/`, then
3. Rabin+SHA verify -> `/DOT/<CMD>`.

```
.pkg-inst update            ; refresh the local index first (if stale)
.pkg-inst install morse     ; resolve + fetch + verify + install
```

**Server config — `/ZXPKG/SERVER`** (one line: `host port prefix`). Defaults to
`gopher.zx.in.net 70 /pkg`, so on a normal Next it needs no file. Override it for a
LAN/dev gopher server (note the empty prefix — a trailing space):

```
192.168.1.50 7070 
```

The manual `.pkg-get <host> <port> <selector> [file]` still exists for diagnostics
and for pre-staging into `/ZXPKG/CACHE/` (where `install` will find and use it
without re-fetching).

## LAN bring-up (before Gophernicus is deployed)

```
make gopher-serve     # stages a signed index in gopher-root/ + prints this recipe
! cd <this dir> && python3 gopher_serve.py gopher-root 7070
```
then on the Next:
```
.pkg-get <pc-ip> 7070 /index/v1.dat     /ZXPKG/CACHE/INDEX.DAT
.pkg-get <pc-ip> 7070 /index/v1.dat.sig /ZXPKG/CACHE/INDEX.SIG
.pkg-inst update
```

`make gopher-test` proves the host half (server + reference client
`gopher_fetch.py`) delivers **byte-for-byte clean** — the same check to run
against a production Gophernicus before trusting it (see DEPLOY.md §A).

## HTTP fallback (works today, no driver needed)

NextOS's built-in `.http` drives the ESP itself, so the composed flow needs no
ESPAT driver and no code of ours — useful as a cross-check if `.pkg-get`
misbehaves:

```
make wifi-serve       # stages a signed index + python http.server recipe
.http get -h <pc-ip> -p 8000 -u /index.dat     -f /ZXPKG/CACHE/INDEX.DAT
.http get -h <pc-ip> -p 8000 -u /index.dat.sig -f /ZXPKG/CACHE/INDEX.SIG
.pkg-inst update
```

For production HTTP the portal would need a plain-HTTP carve-out
(DEPLOY.md §B) — which is exactly what gopher avoids.
