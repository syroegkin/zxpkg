// The ZXPkg one-line installer, as NextBASIC source.  Served tokenized at
// /install.bas (via txt2bas) so the user can:
//   .http get -h <host> -u /install.bas -f install.bas
//   LOAD "install.bas": RUN
// It uses only what ships with the Next (.http) plus the files it downloads:
//  1. fetch the client dots (stable /dist URLs) into /dot
//  2. .pkg-inst setup       — creates /PKG + /CACHE (the dot does its own mkdir)
//  3. fetch the signed index into /CACHE
//  4. .pkg-inst update      — signature-verified index install
//  5. .pkg scan             — build the installed-package DB
// Trust model: step 1 is trusted-by-download (you can't verify before you have
// the verifier — the documented bootstrap); everything after is signature-gated.
//
// NB: .http argument values must be literals (its BASIC variable support is
// limited to single-letter string vars), hence the host is baked in here.

export function installBasSource(host: string, port: number): string {
  // `.http` defaults to port 80; only emit -p when it differs (dev portals).
  const p = port === 80 ? "" : ` -p ${port}`;
  return [
    `10 REM ZXPkg installer - ${host}`,
    `20 PRINT "ZXPkg installer"`,
    `30 PRINT "fetching client..."`,
    `40 .http get -h ${host}${p} -u /dist/PKG -f /dot/PKG`,
    `50 .http get -h ${host}${p} -u /dist/PKG-INST -f /dot/PKG-INST`,
    `60 .pkg-inst setup`,
    `70 PRINT "fetching signed index..."`,
    `80 .http get -h ${host}${p} -u /index/v1.dat -f /CACHE/INDEX.DAT`,
    `90 .http get -h ${host}${p} -u /index/v1.dat.sig -f /CACHE/INDEX.SIG`,
    `100 PRINT "verifying index..."`,
    `110 .pkg-inst update`,
    `120 PRINT "scanning installed packages..."`,
    `130 .pkg scan`,
    `140 PRINT "ready! try: .pkg list"`,
  ].join("\n") + "\n";
}
