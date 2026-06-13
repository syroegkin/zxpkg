import type { Metadata } from "next";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import JsonLd from "@/app/JsonLd";
import { md2html, parseFaq } from "@/lib/markdown";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Guide: ZX Spectrum dot commands & how to install them",
  description:
    "What ZX Spectrum dot commands are, how to install them on the ZX Spectrum Next (NextZXOS) and classic esxDOS / divMMC machines, and how to publish your own package to ZXPkg.",
  alternates: { canonical: "/docs" },
};

// Single source: the same content/docs.md that the gopher mirror renders.
const md = readFileSync(join(process.cwd(), "content", "docs.md"), "utf8");

export default function Docs() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: parseFaq(md).map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  return (
    <article className="prose">
      <JsonLd data={jsonLd} />
      <div dangerouslySetInnerHTML={{ __html: md2html(md) }} />
    </article>
  );
}
