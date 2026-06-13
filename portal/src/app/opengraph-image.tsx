import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "ZXPkg: ZX Spectrum dot commands, software & package manager";

// Default social card for the site (home, docs, and any page without its own).
export default function Image() {
  const bars = ["#ff0000", "#ffff00", "#00ff00", "#0000ff"];
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          background: "#ffffff",
          padding: "72px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", transform: "skewX(-14deg)", marginBottom: 40 }}>
          {bars.map((c) => (
            <div key={c} style={{ width: 44, height: 120, background: c }} />
          ))}
        </div>
        <div style={{ display: "flex", fontSize: 96, fontWeight: 700, color: "#1f2933" }}>zxpkg</div>
        <div style={{ display: "flex", fontSize: 40, color: "#333333", marginTop: 16, maxWidth: 1000 }}>
          ZX Spectrum dot commands, software &amp; package manager
        </div>
        <div style={{ display: "flex", fontSize: 28, color: "#6b7280", marginTop: 24 }}>
          registry &amp; preservation archive · pkg.zx.in.net
        </div>
      </div>
    ),
    size
  );
}
