import "./globals.css";
import type { Metadata } from "next";
import { Press_Start_2P } from "next/font/google";
import { env } from "@/lib/env";

// Pixel font for the logo/headings (self-hosted by next/font). An authentic ZX Spectrum
// .woff2 dropped at public/fonts/ overrides it via the @font-face in globals.css.
const pixel = Press_Start_2P({ weight: "400", subsets: ["latin"], variable: "--font-pixel", display: "swap" });

const bp = process.env.NEXT_PUBLIC_BASE_PATH || "";

export const metadata: Metadata = {
  metadataBase: new URL(env.publicBaseUrl),
  title: {
    default: "ZXPkg: ZX Spectrum dot commands, software & package manager",
    template: "%s · ZXPkg",
  },
  description:
    "Find, download and install ZX Spectrum dot commands, utilities and games for the ZX Spectrum Next (NextZXOS) and classic Spectrums with esxDOS / divMMC. A package registry and preservation archive.",
  keywords: [
    "ZX Spectrum",
    "ZX Spectrum Next",
    "dot commands",
    "NextZXOS",
    "esxDOS",
    "divMMC",
    "ZX Spectrum software",
    "ZX Spectrum utilities",
    "Spectrum Next software",
    "ZX Spectrum package manager",
    "retro computing",
  ],
  applicationName: "ZXPkg",
  openGraph: {
    title: "ZXPkg: ZX Spectrum dot commands, software & package manager",
    description:
      "Search, download and install ZX Spectrum dot commands and software for the Next (NextZXOS) and classic esxDOS/divMMC machines.",
    siteName: "ZXPkg",
    type: "website",
    locale: "en",
  },
  twitter: {
    card: "summary",
    title: "ZXPkg: ZX Spectrum dot commands & software",
    description: "A package registry, manager and preservation archive for the ZX Spectrum and ZX Spectrum Next.",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={pixel.variable}>
      <body>
        <header className="site-header">
          <div className="header-inner">
            <a className="brand" href={`${bp}/`}>
              <span className="zx-flash" aria-hidden="true">
                <i /><i /><i /><i />
              </span>
              <span className="brand-word">zx<b>pkg</b></span>
            </a>
            <form className="search" action={`${bp}/`} method="get" role="search">
              <input name="q" type="search" placeholder="Search packages…" aria-label="Search packages" />
              <button type="submit">Search</button>
            </form>
            <a className="nav-link" href={`${bp}/docs`}>Docs</a>
            <a className="nav-link" href={`${bp}/client`}>Client</a>
            <a className="nav-link" href={`${bp}/new`}>Publish</a>
          </div>
        </header>
        <main className="container">{children}</main>
        <footer className="site-footer">
          A package registry &amp; preservation archive for the ZX Spectrum. ·{" "}
          <a href={`${bp}/docs`}>Guide</a> · <a href={`${bp}/client`}>Client</a> ·{" "}
          <a href={`${bp}/new`}>Publish</a>
        </footer>
      </body>
    </html>
  );
}
