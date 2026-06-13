# Installing packages over WiFi

The on-device client can fetch and install packages straight from the registry
over WiFi — no PC, no SD-card shuffling. This needs a ZX Spectrum Next (or a
machine with the NextZXOS ESPAT WiFi driver) with WiFi already joined.

## One-time setup

1. Install the client (.pkg and .pkg-inst) — see "The on-device client".
2. Run .pkg-inst setup — it creates /ZXPKG and /ZXPKG/CACHE on the SD card.
3. Optional: point the client at a server by writing one line to /ZXPKG/SERVER:

```
host port prefix
```

It defaults to "gopher.zx.in.net 70 /pkg", so a normal Next needs no file. Use
this only for a local/dev gopher server (a trailing space means "no prefix").

## Update the catalogue

```
.pkg-inst update
.pkg list
```

update fetches the registry index over WiFi and verifies its signature before
storing it; list then shows what's available for your machine.

## Install a package

```
.pkg-inst install <name>
```

The client resolves <name> to its command and version from the local index,
fetches the signed artifact over gopher, verifies it on the Z80 (Rabin-Williams
over SHA-256), and installs it to /DOT/<command>. Run .pkg afterwards to confirm
it shows as current.

## Why gopher / why this is safe

Gopher is a tiny, text-simple protocol — easy for a Z80 to speak and easy to
serve. The transport isn't trusted: a tampered or truncated download fails the
on-device signature check and is refused. So plain gopher carrying signed files
is safe by design.
