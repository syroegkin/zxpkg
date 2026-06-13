import { ImageResponse } from "next/og";
import { getPackage } from "@/lib/queries";
import { machineLabel } from "@/lib/manifest";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "ZXPkg package";

// Auto-generated social card for each package page.
export default async function Image({ params }: { params: { name: string } }) {
  const data = await getPackage(params.name);
  const name = data?.pkg.name ?? params.name;
  const desc = (data?.pkg.description ?? "A ZX Spectrum package").slice(0, 150);
  const latest = data ? data.versions.find((v) => v.is_latest) || data.versions[0] : null;
  const type = latest?.type ?? "dot";
  const machine = latest ? machineLabel(latest.machine) : "";
  const version = latest?.version ?? "";

  const bars = ["#ff0000", "#ffff00", "#00ff00", "#0000ff"];

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          background: "#ffffff",
          padding: "64px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", transform: "skewX(-14deg)", marginBottom: 44 }}>
          {bars.map((c) => (
            <div key={c} style={{ width: 34, height: 88, background: c }} />
          ))}
        </div>

        <div style={{ display: "flex", fontSize: 82, fontWeight: 700, color: "#1f2933" }}>{name}</div>

        <div style={{ display: "flex", gap: 16, marginTop: 24 }}>
          <span style={{ fontSize: 30, color: "#41338a", background: "#ece7fb", padding: "6px 18px", borderRadius: 20 }}>{type}</span>
          {machine && (
            <span style={{ fontSize: 30, color: "#2b3a3a", background: "#f0f3f4", padding: "6px 18px", borderRadius: 20 }}>{machine}</span>
          )}
          {version && <span style={{ display: "flex", fontSize: 30, color: "#6b7280", padding: "6px 4px" }}>v{version}</span>}
        </div>

        <div style={{ display: "flex", fontSize: 34, color: "#333333", marginTop: 40, maxWidth: 1040 }}>{desc}</div>

        <div style={{ marginTop: "auto", display: "flex", fontSize: 28, color: "#6b7280" }}>zxpkg · pkg.zx.in.net</div>
      </div>
    ),
    size
  );
}
