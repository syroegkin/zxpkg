import type { Metadata } from "next";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { md2html } from "@/lib/markdown";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Installing ZX Spectrum packages over WiFi",
  description:
    "Use the ZXPkg on-device client to fetch and install signed packages straight from the registry over WiFi on the ZX Spectrum Next — .pkg-inst update and install <name>.",
  alternates: { canonical: "/wifi" },
};

// Single source: the same content/wifi.md that the gopher mirror renders.
const md = readFileSync(join(process.cwd(), "content", "wifi.md"), "utf8");

export default function Wifi() {
  return <article className="prose" dangerouslySetInnerHTML={{ __html: md2html(md) }} />;
}
