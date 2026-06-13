import type { Metadata } from "next";
import Link from "next/link";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "The on-device client: .pkg & .pkg-inst",
  description:
    "How to install and use the ZXPkg on-device client on the ZX Spectrum Next and classic esxDOS machines: scan installed packages, check for updates, and install signed packages with .pkg and .pkg-inst.",
  alternates: { canonical: "/client" },
};

export default function Client() {
  return (
    <article className="prose">
      <h1>The on-device client: <code>.pkg</code> &amp; <code>.pkg-inst</code></h1>
      <p>
        ZXPkg&rsquo;s client runs <em>on the Spectrum</em> as two standard dot commands, each
        under 7&nbsp;KB so they work on classic esxDOS machines as well as the Next:
      </p>
      <ul>
        <li>
          <strong><code>.pkg</code></strong> — the query half: what&rsquo;s installed, what&rsquo;s
          in the registry, what&rsquo;s outdated.
        </li>
        <li>
          <strong><code>.pkg-inst</code></strong> — the trust half: installs and updates, gated by
          signature verification (Rabin-Williams over SHA-256, checked on the Z80 itself).
        </li>
      </ul>

      <h2>Install in one line (ZX Spectrum Next)</h2>
      <p>
        On a Next with WiFi, the built-in <code>.http</code> command can fetch the installer,
        which then sets everything up — downloads both dots, creates the folders, fetches and
        verifies the package index, and scans your <code>/dot</code>:
      </p>
      <pre>{`.http get -h pkg.zx.in.net -u /install.bas -f install.bas
LOAD "install.bas": RUN`}</pre>

      <h2>Manual setup (classic machines, or no WiFi)</h2>
      <ol>
        <li>
          Copy the two command files <code>PKG</code> and <code>PKG-INST</code> into{" "}
          <code>/dot</code> on your SD card (<a href="/dist/PKG">PKG</a>,{" "}
          <a href="/dist/PKG-INST">PKG-INST</a>).
        </li>
        <li>
          Run <code>.pkg-inst setup</code> — it creates the <code>/PKG</code> (local registry
          index) and <code>/CACHE</code> (download staging) folders for you.
        </li>
      </ol>

      <h2><code>.pkg</code> — query commands</h2>
      <table>
        <tbody>
          <tr><td><code>.pkg scan</code></td><td>CRC every file in <code>/DOT</code>, identify each against the registry, and build the installed-package database (<code>/INSTALL.DAT</code>). Run this first, and again after changes.</td></tr>
          <tr><td><code>.pkg</code> / <code>.pkg status</code></td><td>Instant report from that database: each managed package as <code>name vVER&nbsp;&nbsp;ok</code> or <code>update</code> (a newer version exists), plus a tally of unmanaged files.</td></tr>
          <tr><td><code>.pkg list</code></td><td>The registry catalogue (packages compatible with your machine).</td></tr>
          <tr><td><code>.pkg search &lt;term&gt;</code></td><td>Search the registry by name.</td></tr>
          <tr><td><code>.pkg info &lt;name&gt;</code></td><td>Full details for one package: version, command, machine, size, description.</td></tr>
          <tr><td><code>.pkg remove &lt;name&gt;</code></td><td>Delete <code>/DOT/&lt;name&gt;</code> (refuses to remove the client itself).</td></tr>
          <tr><td><code>.pkg help</code></td><td>Usage summary.</td></tr>
        </tbody>
      </table>

      <h2><code>.pkg-inst</code> — install &amp; update</h2>
      <table>
        <tbody>
          <tr><td><code>.pkg-inst update</code></td><td>Verify the staged registry index (<code>/CACHE/INDEX.DAT</code> + <code>.SIG</code>) and, only if the signature is valid, store it as the trusted <code>/PKG/INDEX.DAT</code>.</td></tr>
          <tr><td><code>.pkg-inst install &lt;CMD&gt;</code></td><td>Verify the staged package (<code>/CACHE/&lt;CMD&gt;</code> + <code>.SIG</code>) and, only if valid, install it to <code>/DOT/&lt;CMD&gt;</code>. A tampered or corrupt file is refused.</td></tr>
        </tbody>
      </table>
      <p>
        Both read from <code>/CACHE</code>. Getting files there: on the Next, fetch them over WiFi
        — e.g. with the built-in <code>.http</code> command — or copy them onto the SD card from
        any machine. A native fetch built into the client is in development, so this staging step
        will disappear.
      </p>
      <pre>{`.http get -h pkg.zx.in.net -u /index/v1.dat     -f /CACHE/INDEX.DAT
.http get -h pkg.zx.in.net -u /index/v1.dat.sig -f /CACHE/INDEX.SIG
.pkg-inst update`}</pre>

      <h2>The trust model</h2>
      <p>
        The transport is never trusted — the <strong>signature</strong> is. Every artifact and the
        index itself are signed by the registry; <code>.pkg-inst</code> verifies the signature
        on-device against its embedded public key before anything is installed or believed.
        Identification (<code>scan</code>) uses fast CRC-32C; <em>acceptance</em> always requires
        the signature. That&rsquo;s why downloads can travel over plain HTTP, Gopher, or
        sneakernet: a modified file simply fails verification and is refused.
      </p>

      <p>
        <Link href="/docs">← Back to the guide</Link>
      </p>
    </article>
  );
}
