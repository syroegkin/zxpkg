import type { Metadata } from "next";
import Link from "next/link";
import JsonLd from "@/app/JsonLd";

export const dynamic = "force-static";

const bp = process.env.NEXT_PUBLIC_BASE_PATH || "";

export const metadata: Metadata = {
  title: "Guide: ZX Spectrum dot commands & how to install them",
  description:
    "What ZX Spectrum dot commands are, how to install them on the ZX Spectrum Next (NextZXOS) and classic esxDOS / divMMC machines, and how to publish your own package to ZXPkg.",
  alternates: { canonical: "/docs" },
};

const FAQ: { q: string; a: string }[] = [
  {
    q: "What are ZX Spectrum dot commands?",
    a: "Dot commands are small utility programs for the ZX Spectrum that you run from BASIC by typing a dot followed by the name, e.g. .morse. They live in the /DOT folder of the SD card and work under esxDOS and NextZXOS. Think of them as command-line tools for the Spectrum.",
  },
  {
    q: "How do I install a dot command on the ZX Spectrum Next?",
    a: "Download the command file from its package page and copy it into the /DOT folder on your SD card (c:/dot on the Next). Then run it from BASIC or the command line with a leading dot, e.g. .morse. ZXPkg also has an on-device client — the .pkg and .pkg-inst dot commands — that lists, identifies and installs packages with signature verification.",
  },
  {
    q: "Does this work on a classic ZX Spectrum, not just the Next?",
    a: "Yes. esxDOS dot commands run on classic 48K/128K Spectrums with a divMMC / DivIDE interface. Each package lists its minimum machine (16k, 48k, 128k or next) and which OS it supports (esxDOS, NextZXOS).",
  },
  {
    q: "How do I publish my own package?",
    a: "Use the manifest wizard to generate a .zxpkg.toml, commit it to your public git repo (one manifest per package), then submit the repo. ZXPkg watches the repo and indexes it automatically once the manifest is present.",
  },
  {
    q: "Where are the files kept?",
    a: "ZXPkg is also a preservation archive: it clones each repo and mirrors every binary, so packages keep working and stay downloadable even if the original repository or website disappears.",
  },
];

export default function Docs() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  return (
    <article className="prose">
      <JsonLd data={jsonLd} />

      <h1>ZX Spectrum dot commands &amp; software: a guide</h1>
      <p>
        <strong>ZXPkg</strong> is a package registry, manager and preservation archive for the{" "}
        <strong>ZX Spectrum</strong> and <strong>ZX Spectrum Next</strong>. Browse and download
        packages on the web, or install them on-device. <Link href="/">Browse the catalogue →</Link>
      </p>

      <h2>What are dot commands?</h2>
      <p>
        Dot commands are small utility programs you run from BASIC by typing a dot and a name,
        e.g. <code>.morse</code>. They live in the <code>/DOT</code> folder of your SD card and run
        under <strong>esxDOS</strong> and <strong>NextZXOS</strong>. They&rsquo;re command-line tools
        for the Spectrum: file utilities, format converters, network tools.
      </p>

      <h2>How to install</h2>
      <ol>
        <li>Open a package page and download the command file (and its <code>.sig</code> if you verify signatures).</li>
        <li>Copy it into the <code>/DOT</code> folder on your SD card (<code>c:/dot</code> on the Next).</li>
        <li>Run it from BASIC with a leading dot, e.g. <code>.morse</code>.</li>
      </ol>
      <p>
        Or use the <Link href="/client">on-device client</Link> — two dot commands,{" "}
        <code>.pkg</code> (search, list, identify what&rsquo;s installed and outdated) and{" "}
        <code>.pkg-inst</code> (install and update, gated by on-device signature verification).
        Works on the Next and on classic esxDOS machines.
      </p>

      <h2>Which machines are supported?</h2>
      <p>
        Each package declares a <strong>minimum machine</strong> (<code>16k</code>, <code>48k</code>,{" "}
        <code>128k</code> or <code>next</code>) and runs on that model and every higher one, since
        Spectrum software is upward-compatible. It also lists the OS it works under: <code>esxDOS</code>,{" "}
        <code>NextZXOS</code>, or both. Filter the catalogue by machine and OS to see what runs on yours.
      </p>

      <h2>Publish your own</h2>
      <p>
        Use the <Link href="/new">manifest wizard</Link> to generate a <code>.zxpkg.toml</code>,
        commit it to your public git repo (one manifest per package), then submit the repo. ZXPkg
        watches it and indexes it once the manifest appears, and keeps a full mirror so it&rsquo;s
        preserved even if the original goes offline.
      </p>

      <h2>FAQ</h2>
      <dl className="faq">
        {FAQ.map((f) => (
          <div key={f.q}>
            <dt>{f.q}</dt>
            <dd>{f.a}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}
