# ZX Spectrum dot commands & software: a guide

ZXPkg is a package registry, manager and preservation archive for the ZX
Spectrum and ZX Spectrum Next. Browse and download packages on the web, or
install them on-device.

## What are dot commands?

Dot commands are small utility programs you run from BASIC by typing a dot and a
name, e.g. .morse. They live in the /DOT folder of your SD card and run under
esxDOS and NextZXOS. They're command-line tools for the Spectrum: file
utilities, format converters, network tools.

## How to install

1. Open a package page and download the command file (and its .sig if you
   verify signatures).
2. Copy it into the /DOT folder on your SD card (c:/dot on the Next).
3. Run it from BASIC with a leading dot, e.g. .morse.

Or use the [on-device client](/client) — two dot commands, .pkg (search, list, identify
what's installed and outdated) and .pkg-inst (install and update, gated by
on-device signature verification). Works on the Next and on classic esxDOS
machines.

## Which machines are supported?

Each package declares a minimum machine (16k, 48k, 128k or next) and runs on
that model and every higher one, since Spectrum software is upward-compatible.
It also lists the OS it works under: esxDOS, NextZXOS, or both. Filter the
catalogue by machine and OS to see what runs on yours.

## Publish your own

Use the [manifest wizard](/new) to generate a .zxpkg.toml, commit it to your
public git repo (one manifest per package), then submit the repo. ZXPkg watches
it and indexes it once the manifest appears, and keeps a full mirror so it's
preserved even if the original goes offline.

## FAQ

### What are ZX Spectrum dot commands?

Dot commands are small utility programs for the ZX Spectrum that you run from
BASIC by typing a dot followed by the name, e.g. .morse. They live in the /DOT
folder of the SD card and work under esxDOS and NextZXOS. Think of them as
command-line tools for the Spectrum.

### How do I install a dot command on the ZX Spectrum Next?

Download the command file from its package page and copy it into the /DOT folder
on your SD card (c:/dot on the Next). Then run it from BASIC or the command line
with a leading dot, e.g. .morse. ZXPkg also has an on-device client — the .pkg
and .pkg-inst dot commands — that lists, identifies and installs packages with
signature verification.

### Does this work on a classic ZX Spectrum, not just the Next?

Yes. esxDOS dot commands run on classic 48K/128K Spectrums with a divMMC /
DivIDE interface. Each package lists its minimum machine (16k, 48k, 128k or
next) and which OS it supports (esxDOS, NextZXOS).

### How do I publish my own package?

Use the manifest wizard to generate a .zxpkg.toml, commit it to your public git
repo (one manifest per package), then submit the repo. ZXPkg watches the repo
and indexes it automatically once the manifest is present.

### Where are the files kept?

ZXPkg is also a preservation archive: it clones each repo and mirrors every
binary, so packages keep working and stay downloadable even if the original
repository or website disappears.
