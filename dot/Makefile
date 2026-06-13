# ZXPkg device crypto PoC — build/run the cycle-accurate harness PoCs and the
# Fuse demos. Toolchain (sjasmplus, ZEsarUX, 48K ROM) lives in ../.toolchain.

TOOLCHAIN := $(abspath ../.toolchain)
SJASM     := $(TOOLCHAIN)/bin/sjasmplus
ROM       := $(TOOLCHAIN)/roms/48.rom
FUSE      ?= fuse
ZESARUX   := $(TOOLCHAIN)/bin/zesarux
CC        := gcc
CFLAGS    := -O2
Z80H_URL  := https://raw.githubusercontent.com/floooh/chips/master/chips/z80.h

.PHONY: all rsa sha bench sha-kat tap test-tap fuse fuse-sha fuse-test zesarux \
        rabin rabin-vec rabin-tap fuse-rabin clean help

help:
	@echo "Targets:"
	@echo "  make rsa       - assemble + run Rabin/RSA modmul PoC (cycle-accurate, checks vs host)"
	@echo "  make sha       - assemble + run SHA-256 PoC (checks SHA-256(\"abc\"))"
	@echo "  make bench     - SHA-256 marginal per-block timing (nrep=10)"
	@echo "  make sha-kat   - SHA-256 known-answer tests in the sim (empty/abc/56/64/120 byte)"
	@echo "  make rabin     - full Rabin-Williams verify: 4 (e,f) vectors + tamper, cycle-accurate"
	@echo "  make rabin-vec - (re)generate the Rabin verify vectors (.bin + .inc)"
	@echo "  make tap       - build sha_zx.tap (SHA timing demo)"
	@echo "  make test-tap  - build sha_test.tap (on-device SHA known-answer test)"
	@echo "  make rabin-tap - build rabin_zx.tap (on-device full verify: OK/BAD + timing)"
	@echo "  make fuse      - build + launch sha_zx.tap (timing) in Fuse (48K)"
	@echo "  make fuse-test - build + launch sha_test.tap (correctness) in Fuse (48K)"
	@echo "  make fuse-rabin- build + launch rabin_zx.tap (full verify) in Fuse (48K)"
	@echo "  make zesarux   - build + launch sha_zx.tap in ZEsarUX (48K, our ROM)"
	@echo "  make clean"
	@echo ""
	@echo "Device (.pkg) — sim-tested logic + real-Next deploy:"
	@echo "  make cmd          - subcommand parse/dispatch tests (cycle-accurate)"
	@echo "  make esx-shell    - headless dispatch/query/format test (Node<->Z80 parity)"
	@echo "  make esx-identify - .pkg scan: CRC /DOT, name via index -> /INSTALLED.DAT"
	@echo "  make esx-pkg-inst - end-to-end .pkg-inst install/update (crypto, via harness)"
	@echo "  make pkg          - build the .pkg dot (query/scan/status) -> PKG"
	@echo "  make pkg-inst     - build the .pkg-inst dot (install/update) -> PKG-INST"
	@echo "  make pkg-get      - build the .pkg-get gopher-fetch dot (Next, HW-only) -> PKG-GET"
	@echo "  make gopher-serve - stage a signed index in a gopher root + LAN test recipe"
	@echo "  make gopher-test  - host self-test: gopher fetch is byte-for-byte clean"
	@echo "  make pkgdiag      - build the .pkgdiag HW diagnostic dot -> PKGDIAG"
	@echo "  make pkgclean     - build the .pkgclean cleanup dot -> PKGCLEAN"
	@echo ""
	@echo "  make esx-pkg-install - end-to-end .pkg install via the merged dot (crypto)"
	@echo ""
	@echo "Push to / clean the Next (Jari Komppa's NextSync; run '.sync' on the Next):"
	@echo "  make next-sync    - stage the mirror folder (PKG, PKGDIAG, PKGCLEAN, INDEX.DAT)"
	@echo "  make next-push    - stage + start the sync server (then '.sync' on the Next)"
	@echo "  make next-install NAME=C FILE=f - stage a signed artifact for '.pkg install C'"
	@echo "  make next-clean   - push PKGCLEAN, then run '.pkgclean' on the Next to delete"
	@echo "                      everything we pushed (incl. itself)"

all: rsa sha tap

# ---- shared deps ----
z80.h:
	curl -sS -o z80.h $(Z80H_URL)

vectors/vectors.bin:
	node vectors/gen.js

# ---- cycle-accurate C-harness PoCs ----
runner: runner.c z80.h
	$(CC) $(CFLAGS) -o runner runner.c

sha_runner: sha_runner.c z80.h
	$(CC) $(CFLAGS) -o sha_runner sha_runner.c

rsa_verify.bin: rsa_verify.asm bn_core.inc.asm
	$(SJASM) --raw=rsa_verify.bin rsa_verify.asm

sha256.bin: sha256.asm
	$(SJASM) --raw=sha256.bin sha256.asm

rsa: rsa_verify.bin runner vectors/vectors.bin
	./runner rsa_verify.bin vectors/vectors.bin

sha: sha256.bin sha_runner
	./sha_runner sha256.bin 1

bench: sha256.bin sha_runner
	./sha_runner sha256.bin 10

# SHA-256 known-answer tests (cycle-accurate sim; expected digests from python hashlib)
sha_full_test.bin: sha_full_test.asm sha_core.inc.asm
	$(SJASM) --raw=sha_full_test.bin sha_full_test.asm
sha_full_runner: sha_full_runner.c z80.h
	$(CC) $(CFLAGS) -o sha_full_runner sha_full_runner.c
sha-kat: sha_full_test.bin sha_full_runner
	@for m in "" "abc" "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq" \
	          "$$(python3 -c 'print("a"*64)')" "$$(python3 -c 'print("a"*120)')"; do \
	  exp=$$(python3 -c "import hashlib,sys;print(hashlib.sha256(sys.argv[1].encode()).hexdigest())" "$$m"); \
	  ./sha_full_runner sha_full_test.bin "$$m" "$$exp"; \
	done

# ---- full Rabin-Williams verify (SHA + s^2 mod n + untweak + redundancy) ----
vectors/rabin_vectors.bin vectors/rabin_vectors.inc.asm &: vectors/rabin_sign.js
	node vectors/rabin_sign.js
rabin-vec: vectors/rabin_vectors.bin

rabin_verify.bin: rabin_verify.asm rabin_core.inc.asm bn_core.inc.asm sha_core.inc.asm
	$(SJASM) --raw=rabin_verify.bin rabin_verify.asm
rabin_runner: rabin_runner.c z80.h
	$(CC) $(CFLAGS) -o rabin_runner rabin_runner.c
rabin: rabin_verify.bin rabin_runner vectors/rabin_vectors.bin
	./rabin_runner rabin_verify.bin vectors/rabin_vectors.bin

# wire-format verify: blob + 130-byte .sig + 130-byte pubkey entry (spec §5.4/§5.6)
verify_sig.bin: verify_sig.asm rabin_core.inc.asm bn_core.inc.asm sha_core.inc.asm
	$(SJASM) --raw=verify_sig.bin verify_sig.asm
verify_sig_runner: verify_sig_runner.c z80.h
	$(CC) $(CFLAGS) -o verify_sig_runner verify_sig_runner.c
verify-sig: verify_sig.bin verify_sig_runner

# index.dat v1 decoder (spec §6): round-trip walk + unknown-schema reject
index_demo.bin: index_demo.asm index_core.inc.asm
	$(SJASM) --raw=index_demo.bin index_demo.asm
index_runner: index_runner.c z80.h
	$(CC) $(CFLAGS) -o index_runner index_runner.c
index: index_demo.bin index_runner ../spec/vectors/index.dat
	./index_runner index_demo.bin ../spec/vectors/index.dat

# CRC-32C identity hash (spec §3): check against the host
crc_demo.bin: crc_demo.asm crc_core.inc.asm
	$(SJASM) --raw=crc_demo.bin crc_demo.asm
crc_runner: crc_runner.c z80.h
	$(CC) $(CFLAGS) -o crc_runner crc_runner.c
crc: crc_demo.bin crc_runner
	@node -e 'const v=require("../spec/vectors/crc32c.json");for(const c of v.cases)console.log(c.crc32c+" "+c.input_hex)' \
	  | while read exp h; do ./crc_runner crc_demo.bin "$$h" "$$exp"; done

# `.pkg search`/`list` query layer (device-only logic) against the fixture index
IDX := ../spec/vectors/index.dat
search_demo.bin: search_demo.asm index_core.inc.asm index_search.inc.asm
	$(SJASM) --raw=search_demo.bin search_demo.asm
search_runner: search_runner.c z80.h
	$(CC) $(CFLAGS) -o search_runner search_runner.c
search: search_demo.bin search_runner $(IDX)
	@./search_runner search_demo.bin $(IDX) ""      3 "0,1,2"   # list all on Next
	@./search_runner search_demo.bin $(IDX) ""      1 "0"       # list all on 48k (compat filter)
	@./search_runner search_demo.bin $(IDX) "snake" 3 "2"       # name substring
	@./search_runner search_demo.bin $(IDX) "n"     3 "1,2"     # substring matches nxtel+snake
	@./search_runner search_demo.bin $(IDX) "MORSE" 3 "0"       # case-folded
	@./search_runner search_demo.bin $(IDX) "nope"  3 "none"    # no match

# `.pkg` command-line parse + subcommand dispatch + info name lookup
cmd_demo.bin: cmd_demo.asm index_core.inc.asm index_search.inc.asm cmd_core.inc.asm
	$(SJASM) --raw=cmd_demo.bin cmd_demo.asm
cmd_runner: cmd_runner.c z80.h
	$(CC) $(CFLAGS) -o cmd_runner cmd_runner.c
cmd: cmd_demo.bin cmd_runner $(IDX)
	@./cmd_runner cmd_demo.bin $(IDX) "search morse" 1 "-"     # dispatch search
	@./cmd_runner cmd_demo.bin $(IDX) "list"         2 "-"     # dispatch list
	@./cmd_runner cmd_demo.bin $(IDX) "info nxtel"   3 "1"     # info -> record 1
	@./cmd_runner cmd_demo.bin $(IDX) "info snake"   3 "2"     # info -> record 2
	@./cmd_runner cmd_demo.bin $(IDX) "INFO morse"   3 "0"     # case-folded dispatch + lookup
	@./cmd_runner cmd_demo.bin $(IDX) "info ghost"   3 "none"  # info -> not found
	@./cmd_runner cmd_demo.bin $(IDX) "install foo"  4 "-"     # dispatch install
	@./cmd_runner cmd_demo.bin $(IDX) "scan"         7 "-"     # dispatch scan
	@./cmd_runner cmd_demo.bin $(IDX) "UPDATE"       8 "-"     # case-folded dispatch update
	@./cmd_runner cmd_demo.bin $(IDX) "bogus x"      0 "-"     # unknown command

# on-device index demo (list/search/info, prints via RST $10) — run in Fuse
pkg_zx.tap: pkg_zx.asm index_core.inc.asm index_search.inc.asm $(IDX)
	$(SJASM) pkg_zx.asm
pkg-tap: pkg_zx.tap
fuse-pkg: pkg_zx.tap
	$(FUSE) --machine 48 --rom-48 $(ROM) --auto-load --tape pkg_zx.tap

# esxDOS file I/O via ZEsarUX's host-dir handler (no SD image / firmware / sudo).
#   esxDOS API: RST $08 : db <cmd>.  Filename/buffer pointer = IX (upper-RAM caller).
#   Snapshots (SAVESNA) boot straight into the program; files land in $(ESXROOT).
ESXROOT  := $(abspath esxdos_root)
ZX_ESX    = $(ZESARUX) --machine 48k --romfile $(ROM) --vo null --ao null --noconfigfile \
            --emulatorspeed 10000 --enable-esxdos-handler --esxdos-root-dir $(ESXROOT)
smoke_esx.sna: smoke_esx.asm
	$(SJASM) smoke_esx.asm
esx-smoke: smoke_esx.sna
	@mkdir -p $(ESXROOT) && rm -f $(ESXROOT)/PKGTEST.TXT
	@timeout 5 $(ZX_ESX) --snap smoke_esx.sna >/dev/null 2>&1 || true
	@if [ -f $(ESXROOT)/PKGTEST.TXT ]; then \
	  echo "esx-smoke: PASS — wrote PKGTEST.TXT:"; cat $(ESXROOT)/PKGTEST.TXT; \
	else echo "esx-smoke: FAIL (no file written)"; exit 1; fi

# `.pkg scan`: enumerate /DOT, CRC each file, write /SCAN.DAT; verify vs host.
scan_esx.sna: scan_esx.asm crc_core.inc.asm scan_core.inc.asm
	$(SJASM) scan_esx.asm
esx-scan: scan_esx.sna
	@mkdir -p $(ESXROOT)/DOT && rm -f $(ESXROOT)/SCAN.DAT
	@printf 'abc'        > $(ESXROOT)/DOT/ABC      # crc32c 364b3fb7
	@printf '123456789'  > $(ESXROOT)/DOT/CHECK    # crc32c e3069283
	@printf ''           > $(ESXROOT)/DOT/EMPTY    # crc32c 00000000
	@timeout 8 $(ZX_ESX) --snap scan_esx.sna >/dev/null 2>&1 || true
	@node scan_verify.js $(ESXROOT)

# `.pkg scan` with identification: CRC each /DOT file, look it up in the index -> /INSTALLED.DAT
identify_esx.sna: identify_esx.asm crc_core.inc.asm index_core.inc.asm identify_core.inc.asm
	$(SJASM) identify_esx.asm
esx-identify: identify_esx.sna
	@cd ../portal && npx tsx src/scripts/gen-identify-fixture.ts $(ESXROOT) >/dev/null
	@rm -f $(ESXROOT)/INSTALLED.DAT
	@timeout 8 $(ZX_ESX) --snap identify_esx.sna >/dev/null 2>&1 || true
	@node identify_verify.js $(ESXROOT)

# the real `.pkg` dot command (v2 = subcommand dispatch) -> uploadable file PKG.
# ($2000 is divMMC-paged RAM on the Next; can't be sim-run on bare-48K ZEsarUX,
#  so it is HARDWARE-tested only — the dispatch/query/format path is validated
#  headlessly by `make esx-shell`, and scan by `make esx-identify`.)
PKG: pkg_dot.asm pkg_main.inc.asm index_core.inc.asm index_search.inc.asm \
     cmd_core.inc.asm crc_core.inc.asm identify_core.inc.asm
	$(SJASM) pkg_dot.asm
pkg: PKG ## build the .pkg dot command (query/scan/status; copy to /dot, run .pkg)
	@echo "built dot command: PKG ($$(stat -c%s PKG) bytes, <7KB classic-ok: $$([ $$(stat -c%s PKG) -lt 7168 ] && echo yes || echo NO))"

# .pkg-inst — the crypto half (install/update); separate dot so each stays <7KB.
PKG-INST: pkg_inst.asm pkg_inst_main.inc.asm rabin_core.inc.asm bn_core.inc.asm \
          sha_core.inc.asm sha_stream.inc.asm install_core.inc.asm pubkey.bin
	$(SJASM) pkg_inst.asm
pkg-inst: PKG-INST ## build the .pkg-inst dot command (install/update, signature-gated)
	@echo "built dot command: PKG-INST ($$(stat -c%s PKG-INST) bytes, <7KB classic-ok: $$([ $$(stat -c%s PKG-INST) -lt 7168 ] && echo yes || echo NO))"

# .pkg-get — HW bring-up for Next WiFi: GOPHER fetch over the ESPAT driver,
# print to screen or save to a file (e.g. /ZXPKG/CACHE/INDEX.DAT).
# *** untested on HW (no ESP in our sim); host side proven by `make gopher-test` ***
PKG-GET: pkg_get.asm
	$(SJASM) pkg_get.asm
pkg-get: PKG-GET ## build the .pkg-get gopher-fetch dot (Next; HW-test only)
	@echo "built dot command: PKG-GET ($$(stat -c%s PKG-GET) bytes) — gopher fetch; '.pkg-get host port selector [file]'"

# tiny diagnostic dot: dumps entry registers HL/DE/BC/IX + their memory, to confirm
# a $2000 dot loads/prints/returns on real HW and to NAIL the command-tail convention.
PKGDIAG: pkgdiag.asm
	$(SJASM) pkgdiag.asm
pkgdiag: PKGDIAG ## build the .pkgdiag hardware diagnostic dot command
	@echo "built diagnostic: PKGDIAG ($$(stat -c%s PKGDIAG) bytes) — run '.pkgdiag hello world' on the Next"

# cleanup dot: deletes every file the PoC pushes onto the Next (itself last).
PKGCLEAN: pkgclean.asm
	$(SJASM) pkgclean.asm
pkgclean: PKGCLEAN ## build the .pkgclean cleanup dot command
	@echo "built cleanup: PKGCLEAN ($$(stat -c%s PKGCLEAN) bytes) — run '.pkgclean' on the Next to wipe our files"

# next-sync / next-clean share a name with the directories they create, so without
# .PHONY make would see the dir and skip the recipe (leaving a stale syncpoint.dat
# -> "0 files to sync").  Mark them phony so the staging always runs.
.PHONY: next-sync next-push next-clean next-install publish-client wifi-serve gopher-serve gopher-test \
        pkg pkg-inst pkg-get pkgdiag pkgclean

# stage a NextSync mirror folder ($(SYNCDIR)) holding exactly the SD files we need:
#   dot/PKG  dot/PKGDIAG  ZXPKG/INDEX.DAT
# Then push with Jari Komppa's NextSync: run the server from $(SYNCDIR) and `.sync`
# on the Next (the server mirrors $(SYNCDIR) to the SD root).  `.pkg scan` reads
# /DOT, which IS /dot (FAT is case-insensitive) — i.e. your real dot-command dir.
# /dot exists on the SD; /ZXPKG (+ /ZXPKG/CACHE) are created by `.pkg-inst setup`.
# NextSync server (Jari Komppa, unlicense), vendored into the toolchain alongside
# sjasmplus/zesarux; next-push uses -o = sync once then quit.
NEXTSYNC := $(TOOLCHAIN)/bin/nextsync.py
SYNCDIR  := next-sync
next-sync: PKG PKG-INST PKG-GET PKGDIAG PKGCLEAN ## stage the NextSync mirror folder for pushing to the Next
	@mkdir -p $(SYNCDIR)/dot $(SYNCDIR)/ZXPKG
	@cp PKG PKG-INST PKG-GET PKGDIAG PKGCLEAN $(SYNCDIR)/dot/
	@cp ../spec/vectors/index.dat $(SYNCDIR)/ZXPKG/INDEX.DAT
	@printf 'syncpoint.dat\nsyncignore.txt\n' > $(SYNCDIR)/syncignore.txt  # keep bookkeeping off the SD
	@rm -f $(SYNCDIR)/syncpoint.dat               # force a full re-send on next .sync
	@echo "staged $(SYNCDIR)/ :"
	@find $(SYNCDIR) -type f | sed 's,^$(SYNCDIR),  SD:,'
	@echo ""
	@echo "next: 'make next-push' to start the server, then run '.sync' on the Next"
	@echo "      (first time only: run '.pkg-inst setup' on the Next to create /ZXPKG; /dot already exists)"

# gopher: the chosen device transport (see ../portal/DEPLOY.md §A).  Stage a
# signed index in a gopher root + self-test that our server delivers it
# byte-for-byte (the make-or-break requirement for the signature check).
GOPHERROOT := gopher-root
GOPHERPORT := 7070
gopher-serve: ## stage a signed index in a gopher root; print the LAN test recipe
	@mkdir -p $(GOPHERROOT)/index
	@cp ../spec/vectors/index.dat $(GOPHERROOT)/index/v1.dat
	@cd ../portal && npx tsx src/scripts/sign-file.ts "$(CURDIR)/$(GOPHERROOT)/index/v1.dat" "$(CURDIR)/$(GOPHERROOT)/index/v1.dat.sig" >/dev/null
	@echo "staged $(GOPHERROOT)/index/v1.dat (+ .sig, testkey)"
	@echo ""
	@echo "1) serve it (binary-clean gopher):"
	@echo "     ! cd $(CURDIR) && python3 gopher_serve.py $(GOPHERROOT) $(GOPHERPORT)"
	@echo "2) on the Next (needs espat.drv installed; use your PC's LAN IP):"
	@echo "     .pkg-get <pc-ip> $(GOPHERPORT) /index/v1.dat /ZXPKG/CACHE/INDEX.DAT"
	@echo "     .pkg-get <pc-ip> $(GOPHERPORT) /index/v1.dat.sig /ZXPKG/CACHE/INDEX.SIG"
	@echo "     .pkg-inst update      -> 'index updated'  (then .pkg list)"

gopher-test: gopher-serve ## self-test: fetch via our gopher server, byte-compare
	@python3 gopher_serve.py $(GOPHERROOT) $(GOPHERPORT) >/dev/null 2>&1 & SRV=$$!; sleep 1; \
	timeout 5 python3 gopher_fetch.py 127.0.0.1 $(GOPHERPORT) /index/v1.dat > /tmp/gopher_got.dat; \
	kill $$SRV 2>/dev/null; \
	if cmp -s /tmp/gopher_got.dat $(GOPHERROOT)/index/v1.dat; then echo "gopher-test: PASS - byte-for-byte clean"; else echo "gopher-test: FAIL - bytes mangled"; exit 1; fi

WIFISERVE := wifi-serve
wifi-serve: ## stage a signed index + serve it over plain HTTP to test update-over-WiFi (http fallback)
	@mkdir -p $(WIFISERVE)
	@cp ../spec/vectors/index.dat $(WIFISERVE)/index.dat
	@cd ../portal && npx tsx src/scripts/sign-file.ts "$(CURDIR)/$(WIFISERVE)/index.dat" "$(CURDIR)/$(WIFISERVE)/index.dat.sig" >/dev/null
	@echo "staged signed index in $(WIFISERVE)/ (index.dat + index.dat.sig, testkey)"
	@echo ""
	@echo "1) serve it on your LAN (plain HTTP):"
	@echo "     ! cd $(CURDIR)/$(WIFISERVE) && python3 -m http.server 8000"
	@echo "2) on the Next (use your PC's LAN IP):"
	@echo "     .http get -h <pc-ip> -p 8000 -u /index.dat     -f /ZXPKG/CACHE/INDEX.DAT"
	@echo "     .http get -h <pc-ip> -p 8000 -u /index.dat.sig -f /ZXPKG/CACHE/INDEX.SIG"
	@echo "     .pkg-inst update      -> 'index updated'  (then .pkg list)"

# publish the built client into the portal's store as the stable /dist bootstrap
# files the BASIC installer downloads (PKG, PKG-INST + .sig).  PORTAL_STORE
# defaults to the portal's dev store; point it at the live STORE_DIR on deploy.
PORTAL_STORE ?= ../portal/store
publish-client: PKG PKG-INST ## copy + sign PKG/PKG-INST into the portal store /dist
	@mkdir -p $(PORTAL_STORE)/dist
	@cp PKG $(PORTAL_STORE)/dist/PKG
	@cp PKG-INST $(PORTAL_STORE)/dist/PKG-INST
	@cd ../portal && npx tsx src/scripts/sign-file.ts "$(abspath $(PORTAL_STORE))/dist/PKG" "$(abspath $(PORTAL_STORE))/dist/PKG.sig" >/dev/null
	@cd ../portal && npx tsx src/scripts/sign-file.ts "$(abspath $(PORTAL_STORE))/dist/PKG-INST" "$(abspath $(PORTAL_STORE))/dist/PKG-INST.sig" >/dev/null
	@echo "published to $(PORTAL_STORE)/dist: PKG ($$(stat -c%s PKG)B) PKG-INST ($$(stat -c%s PKG-INST)B) + .sig"

next-install: ## stage a signed artifact for `.pkg install`:  make next-install NAME=MYCMD FILE=path
	@test -n "$(NAME)" && test -n "$(FILE)" || { echo "usage: make next-install NAME=<cmd> FILE=<path>"; exit 2; }
	@mkdir -p $(SYNCDIR)/ZXPKG/CACHE
	@cp "$(FILE)" "$(SYNCDIR)/ZXPKG/CACHE/$(NAME)"
	@cd ../portal && npx tsx src/scripts/sign-file.ts "$(CURDIR)/$(SYNCDIR)/ZXPKG/CACHE/$(NAME)" "$(CURDIR)/$(SYNCDIR)/ZXPKG/CACHE/$(NAME).SIG" >/dev/null
	@rm -f $(SYNCDIR)/syncpoint.dat
	@echo "staged /ZXPKG/CACHE/$(NAME) (+ .SIG) for install.  (.pkg-inst setup creates /ZXPKG on the SD.)"
	@echo "  next: make next-push  ->  on the Next: .sync  then  .pkg install $(NAME)"

next-push: next-sync ## stage + start the NextSync server; then run '.sync' on the Next
	@echo ""
	@echo "NextSync server up in $(SYNCDIR)/ — now run '.sync' on the Next."
	@echo "(it syncs once then quits; re-run 'make next-push' for another push)"
	@echo ""
	cd $(SYNCDIR) && python3 $(NEXTSYNC) -o

# clean the Next: push ONLY the cleanup dot (so we don't re-push the rubbish), then
# run '.sync' + '.pkgclean' on the device.  '.pkgclean' deletes PKG, PKGDIAG,
# INDEX.DAT, INSTALLED.DAT, and PKGCLEAN itself, leaving the card clean.
CLEANDIR := next-clean
next-clean: PKGCLEAN ## push the cleanup dot; then '.sync' + '.pkgclean' on the Next
	@mkdir -p $(CLEANDIR)/dot
	@cp PKGCLEAN $(CLEANDIR)/dot/
	@rm -f $(CLEANDIR)/syncpoint.dat
	@echo "NextSync server up in $(CLEANDIR)/ — on the Next run:  .sync   then   .pkgclean"
	@echo "(.pkgclean deletes PKG, PKGDIAG, INDEX.DAT, INSTALLED.DAT, and itself)"
	@echo ""
	cd $(CLEANDIR) && python3 $(NEXTSYNC) -o

# headless test of the `.pkg` dispatch/query/format path (pkg_main, shared with the
# real dot command): feed a command tail via /CMD.TXT, run pkg_run at $8000, check
# the /OUT.TXT it writes against output derived from index.json (Node<->Z80 parity).
pkg_shell_esx.sna: pkg_shell_esx.asm pkg_main.inc.asm index_core.inc.asm index_search.inc.asm \
                   cmd_core.inc.asm crc_core.inc.asm identify_core.inc.asm
	$(SJASM) pkg_shell_esx.asm
esx-shell: pkg_shell_esx.sna
	@mkdir -p $(ESXROOT)/ZXPKG
	@rm -rf $(ESXROOT)/ZXPKG/CACHE   # install/update cases test the missing-file path (no crypto)
	@cp ../spec/vectors/index.dat $(ESXROOT)/ZXPKG/INDEX.DAT
	@for c in "list" "search n" "search morse" "search zzz" \
	          "info nxtel" "info snake" "info ghost" "info" \
	          "help" "install foo" "update" "bogus arg"; do \
	  printf '%s' "$$c" > $(ESXROOT)/CMD.TXT; \
	  rm -f $(ESXROOT)/OUT.TXT; \
	  timeout 4 $(ZX_ESX) --snap pkg_shell_esx.sna >/dev/null 2>&1 || true; \
	  node pkg_shell_verify.js $(ESXROOT) "$$c" || exit 1; \
	done

# end-to-end test of the `.pkg-inst` dot (parse + crypto verify + copy) via its $5E00
# harness: install valid/tampered, update valid/tampered.  (timeout 10: Rabin+SHA run.)
pkg_inst_esx.sna: pkg_inst_esx.asm pkg_inst_main.inc.asm rabin_core.inc.asm bn_core.inc.asm \
                  sha_core.inc.asm sha_stream.inc.asm install_core.inc.asm pubkey.bin
	$(SJASM) pkg_inst_esx.asm
esx-pkg-inst: pkg_inst_esx.sna
	@mkdir -p $(ESXROOT)/ZXPKG/CACHE $(ESXROOT)/DOT   # ensure_dirs must (re)create /ZXPKG + /ZXPKG/CACHE
	@cp ../spec/vectors/index.dat $(ESXROOT)/ZXPKG/INDEX.DAT   # install resolves <name>->CMD via the local index
	@printf 'hello package payload v1' > $(ESXROOT)/ZXPKG/CACHE/MORSE   # staged under the resolved CMD (morse->MORSE)
	@cd ../portal && npx tsx src/scripts/sign-file.ts $(ESXROOT)/ZXPKG/CACHE/MORSE $(ESXROOT)/ZXPKG/CACHE/MORSE.SIG >/dev/null
	@rm -f $(ESXROOT)/DOT/MORSE
	@printf 'install morse' > $(ESXROOT)/CMD.TXT
	@timeout 10 $(ZX_ESX) --snap pkg_inst_esx.sna >/dev/null 2>&1 || true
	@if cmp -s $(ESXROOT)/ZXPKG/CACHE/MORSE $(ESXROOT)/DOT/MORSE; then echo "pkg-inst install (by-name->cached): PASS - morse resolved, /DOT/MORSE written"; else echo "pkg-inst install (valid): FAIL"; exit 1; fi
	@E=$(ESXROOT) node -e 'const fs=require("fs"),p=process.env.E+"/ZXPKG/CACHE/MORSE",b=fs.readFileSync(p);b[5]^=1;fs.writeFileSync(p,b)'
	@rm -f $(ESXROOT)/DOT/MORSE
	@printf 'install morse' > $(ESXROOT)/CMD.TXT
	@timeout 10 $(ZX_ESX) --snap pkg_inst_esx.sna >/dev/null 2>&1 || true
	@if [ -f $(ESXROOT)/DOT/MORSE ]; then echo "pkg-inst install (tampered): FAIL - should be refused"; exit 1; else echo "pkg-inst install (tampered): PASS - refused"; fi
	@cp ../spec/vectors/index.dat $(ESXROOT)/ZXPKG/CACHE/INDEX.DAT
	@cd ../portal && npx tsx src/scripts/sign-file.ts $(ESXROOT)/ZXPKG/CACHE/INDEX.DAT $(ESXROOT)/ZXPKG/CACHE/INDEX.SIG >/dev/null
	@rm -f $(ESXROOT)/ZXPKG/INDEX.DAT   # update must (re)write /ZXPKG/INDEX.DAT (ensure_dirs makes the dir)
	@printf 'update' > $(ESXROOT)/CMD.TXT
	@timeout 10 $(ZX_ESX) --snap pkg_inst_esx.sna >/dev/null 2>&1 || true
	@if cmp -s $(ESXROOT)/ZXPKG/CACHE/INDEX.DAT $(ESXROOT)/ZXPKG/INDEX.DAT; then echo "pkg-inst update (valid):     PASS - /ZXPKG/INDEX.DAT stored"; else echo "pkg-inst update (valid):     FAIL"; exit 1; fi

# `.pkg status`: scan builds the DB (MORSE=current, SNAKE=outdated, RANDOM=unmanaged),
# then status reads /INSTALL.DAT and reports (no re-CRC).
esx-status: pkg_shell_esx.sna
	@node status_test.js setup $(ESXROOT)
	@printf 'scan' > $(ESXROOT)/CMD.TXT; rm -f $(ESXROOT)/OUT.TXT
	@timeout 6 $(ZX_ESX) --snap pkg_shell_esx.sna >/dev/null 2>&1 || true
	@printf 'status' > $(ESXROOT)/CMD.TXT; rm -f $(ESXROOT)/OUT.TXT
	@timeout 6 $(ZX_ESX) --snap pkg_shell_esx.sna >/dev/null 2>&1 || true
	@node status_test.js check $(ESXROOT)

# `.pkg remove <name>`: F_UNLINK /DOT/<name> (case must match the host file in sim)
esx-remove: pkg_shell_esx.sna
	@mkdir -p $(ESXROOT)/DOT
	@printf 'bye' > $(ESXROOT)/DOT/VICTIM
	@printf 'remove VICTIM' > $(ESXROOT)/CMD.TXT
	@rm -f $(ESXROOT)/OUT.TXT
	@timeout 5 $(ZX_ESX) --snap pkg_shell_esx.sna >/dev/null 2>&1 || true
	@if [ -f $(ESXROOT)/DOT/VICTIM ]; then echo "remove: FAIL - /DOT/VICTIM still present"; exit 1; else echo "remove: PASS - /DOT/VICTIM deleted"; fi

# streaming SHA-256 over a file (any size) — validate vs host across padding edge cases
sha_file_esx.sna: sha_file_esx.asm sha_core.inc.asm sha_stream.inc.asm
	$(SJASM) sha_file_esx.asm
esx-sha-file: sha_file_esx.sna
	@node sha_file_test.js $(ESXROOT)

# `.pkg install`: verify a staged artifact's signature, copy to /DOT only if valid.
pubkey.bin: ../spec/vectors/rabin.json
	@node -e 'const fs=require("fs"),v=require("../spec/vectors/rabin.json");fs.writeFileSync("pubkey.bin",Buffer.concat([Buffer.from([v.key_id,1]),Buffer.from(v.n_le_hex,"hex")]))'
install_esx.sna: install_esx.asm rabin_core.inc.asm bn_core.inc.asm sha_core.inc.asm sha_stream.inc.asm install_core.inc.asm pubkey.bin
	$(SJASM) install_esx.asm
esx-install: install_esx.sna
	@mkdir -p $(ESXROOT)/ZXPKG/CACHE $(ESXROOT)/DOT
	@cd ../portal && npx tsx src/scripts/gen-install-artifact.ts $(ESXROOT) 1234   # large (>180B) signed artifact
	@rm -f $(ESXROOT)/DOT/ART
	@timeout 8 $(ZX_ESX) --snap install_esx.sna >/dev/null 2>&1 || true
	@if cmp -s $(ESXROOT)/ZXPKG/CACHE/ART $(ESXROOT)/DOT/ART; then echo "install (valid sig, 1234B): PASS — /DOT/ART written, matches artifact"; else echo "install (valid sig): FAIL"; exit 1; fi
	@E=$(ESXROOT) node -e 'const fs=require("fs"),p=process.env.E+"/ZXPKG/CACHE/ART",b=fs.readFileSync(p);b[100]^=1;fs.writeFileSync(p,b)'   # tamper 1 byte
	@rm -f $(ESXROOT)/DOT/ART
	@timeout 8 $(ZX_ESX) --snap install_esx.sna >/dev/null 2>&1 || true
	@if [ -f $(ESXROOT)/DOT/ART ]; then echo "install (tampered):        FAIL — should have been refused"; exit 1; else echo "install (tampered):        PASS — refused, /DOT/ART not created"; fi

# `.pkg update`: verify the staged index.dat's signature, store to /PKG only if valid.
update_esx.sna: update_esx.asm rabin_core.inc.asm bn_core.inc.asm sha_core.inc.asm sha_stream.inc.asm install_core.inc.asm pubkey.bin
	$(SJASM) update_esx.asm
esx-update: update_esx.sna
	@mkdir -p $(ESXROOT)/ZXPKG/CACHE
	@cp ../spec/vectors/index.dat $(ESXROOT)/ZXPKG/CACHE/INDEX.DAT
	@cd ../portal && npx tsx src/scripts/sign-file.ts $(ESXROOT)/ZXPKG/CACHE/INDEX.DAT $(ESXROOT)/ZXPKG/CACHE/INDEX.SIG >/dev/null
	@rm -f $(ESXROOT)/ZXPKG/INDEX.DAT
	@timeout 8 $(ZX_ESX) --snap update_esx.sna >/dev/null 2>&1 || true
	@if cmp -s $(ESXROOT)/ZXPKG/CACHE/INDEX.DAT $(ESXROOT)/ZXPKG/INDEX.DAT; then echo "update (valid sig):   PASS — index verified + stored to /ZXPKG/INDEX.DAT"; else echo "update (valid sig):   FAIL"; exit 1; fi
	@E=$(ESXROOT) node -e 'const fs=require("fs"),p=process.env.E+"/ZXPKG/CACHE/INDEX.DAT",b=fs.readFileSync(p);b[20]^=1;fs.writeFileSync(p,b)'   # tamper the index
	@rm -f $(ESXROOT)/ZXPKG/INDEX.DAT
	@timeout 8 $(ZX_ESX) --snap update_esx.sna >/dev/null 2>&1 || true
	@if [ -f $(ESXROOT)/ZXPKG/INDEX.DAT ]; then echo "update (tampered):    FAIL — should have been refused"; exit 1; else echo "update (tampered):    PASS — refused, /ZXPKG/INDEX.DAT not stored"; fi

# ---- ZX taps + emulators ----
rabin_zx.tap: rabin_zx.asm rabin_core.inc.asm bn_core.inc.asm sha_core.inc.asm vectors/rabin_vectors.inc.asm
	$(SJASM) rabin_zx.asm
rabin-tap: rabin_zx.tap
fuse-rabin: rabin_zx.tap
	$(FUSE) --machine 48 --rom-48 $(ROM) --auto-load --tape rabin_zx.tap

sha_zx.tap: sha_zx.asm sha_core.inc.asm
	$(SJASM) sha_zx.asm
sha_test.tap: sha_test.asm sha_core.inc.asm sha_test_vectors.inc.asm
	$(SJASM) sha_test.asm

tap: sha_zx.tap
test-tap: sha_test.tap

fuse fuse-sha: sha_zx.tap
	$(FUSE) --machine 48 --rom-48 $(ROM) --auto-load --tape sha_zx.tap

fuse-test: sha_test.tap
	$(FUSE) --machine 48 --rom-48 $(ROM) --auto-load --tape sha_test.tap

# ZEsarUX with our installed genuine 48K ROM (built without SDL: uses its
# X/curses driver — may need a display/terminal). Best-effort.
zesarux: sha_zx.tap
	$(ZESARUX) --romfile $(ROM) --machine 48k --tape sha_zx.tap

clean:
	rm -f runner *_runner *.bin *.tap *.sna \
	      PKG PKG-INST PKG-GET PKGCLEAN PKGDIAG \
	      vectors/vectors.bin vectors/rabin_vectors.bin vectors/rabin_vectors.inc.asm vectors/portal_vector.bin
	-rm -rf esxdos_root   # leading '-' : tolerate scratch files owned by another user on shared mounts
# (z80.h is left in place — it's a fetched dependency, not a build product; build.sh re-fetches it.)
