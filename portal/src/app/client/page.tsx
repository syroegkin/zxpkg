import type { Metadata } from "next";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { md2html } from "@/lib/markdown";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "The on-device client: .pkg & .pkg-inst",
  description:
    "How to install and use the ZXPkg on-device client on the ZX Spectrum Next and classic esxDOS machines: scan installed packages, check for updates, and install signed packages with .pkg and .pkg-inst.",
  alternates: { canonical: "/client" },
};

// Single source: the same content/client.md that the gopher mirror renders.
const md = readFileSync(join(process.cwd(), "content", "client.md"), "utf8");

export default function Client() {
  return <article className="prose" dangerouslySetInnerHTML={{ __html: md2html(md) }} />;
}
