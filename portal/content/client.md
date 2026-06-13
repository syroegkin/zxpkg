# The on-device client: .pkg & .pkg-inst

ZXPkg's client runs on the Spectrum as two standard dot commands, each under
7 KB so they work on classic esxDOS machines as well as the Next:

- .pkg — the query half: what's installed, what's in the registry, what's
  outdated.
- .pkg-inst — the trust half: installs and updates, gated by signature
  verification (Rabin-Williams over SHA-256, checked on the Z80 itself).

## Install in one line (ZX Spectrum Next)

On a Next with WiFi, the built-in .http command can fetch the installer, which
then sets everything up — downloads both dots, creates the folders, fetches and
verifies the package index, and scans your /dot:

```
.http get -h pkg.zx.in.net -u /install.bas -f install.bas
LOAD "install.bas": RUN
```

## Manual setup (classic machines, or no WiFi)

1. Copy the two command files PKG and PKG-INST into /dot on your SD card.
2. Run .pkg-inst setup — it creates the /ZXPKG folder (registry index, download
   cache and the installed-package database all live under it).

## .pkg — query commands

- .pkg scan — CRC every file in /DOT, identify each against the registry, and
  build the installed-package database (/ZXPKG/INSTALL.DAT). Run this first, and
  again after changes.
- .pkg / .pkg status — instant report from that database: each managed package
  as "name vVER ok" or "update" (a newer version exists), plus a tally of
  unmanaged files.
- .pkg list — the registry catalogue (packages compatible with your machine).
- .pkg search <term> — search the registry by name.
- .pkg info <name> — full details for one package: version, command, machine,
  size, description.
- .pkg remove <name> — delete /DOT/<name> (refuses to remove the client itself).
- .pkg help — usage summary.

## .pkg-inst — install & update

- .pkg-inst update — fetch (or use a staged) registry index, verify its
  signature, and only if valid store it as the trusted /ZXPKG/INDEX.DAT.
- .pkg-inst install <name> — resolve <name> to its command and version from the
  local index, fetch the signed artifact over WiFi (or use a staged copy in
  /ZXPKG/CACHE), verify it, and only if valid install to /DOT. A tampered or
  corrupt file is refused.

Over WiFi the client fetches from the registry's gopher server. The target is
configurable in /ZXPKG/SERVER ("host port prefix"); it defaults to
"gopher.zx.in.net 70 /pkg", so a normal Next needs no configuration. See
"Installing packages over WiFi" for the full flow. You can also stage files into
/ZXPKG/CACHE by hand (copy from any machine) and install offline.

## The trust model

The transport is never trusted — the signature is. Every artifact and the index
itself are signed by the registry; .pkg-inst verifies the signature on-device
against its embedded public key before anything is installed or believed.
Identification (scan) uses fast CRC-32C; acceptance always requires the
signature. That's why downloads can travel over plain HTTP, Gopher, or
sneakernet: a modified file simply fails verification and is refused.
