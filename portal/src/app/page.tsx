import Link from "next/link";
import { searchPackages } from "@/lib/queries";
import { MACHINES, OSES, SUGGESTED_TYPES, splitCsv } from "@/lib/manifest";
import { env } from "@/lib/env";
import JsonLd from "@/app/JsonLd";

export const dynamic = "force-dynamic";

const bp = process.env.NEXT_PUBLIC_BASE_PATH || "";

export default async function Home({
  searchParams,
}: {
  searchParams: { q?: string; type?: string; machine?: string; os?: string };
}) {
  const q = searchParams.q || "";
  const type = searchParams.type || "";
  const machine = searchParams.machine || "";
  const os = searchParams.os || "";
  const results = await searchPackages({
    q: q || undefined,
    type: type || undefined,
    machine: machine || undefined,
    os: os || undefined,
  });

  const noFilters = !q && !type && !machine && !os;
  const siteUrl = `${env.publicBaseUrl}${bp}`;
  const websiteLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "ZXPkg",
    url: `${siteUrl}/`,
    description: "Package registry and archive for ZX Spectrum dot commands and software.",
    potentialAction: {
      "@type": "SearchAction",
      target: `${siteUrl}/?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };

  return (
    <>
      <JsonLd data={websiteLd} />
      {noFilters && (
        <p className="home-intro">
          Download and install <strong>ZX Spectrum dot commands</strong>, utilities and games for the
          <strong> ZX Spectrum Next</strong> (NextZXOS) and classic Spectrums with esxDOS / divMMC.
        </p>
      )}
      <form method="get" action={`${bp}/`} className="filter-form">
        <input type="hidden" name="q" value={q} />
        <label>
          Type
          <select name="type" defaultValue={type}>
            <option value="">any</option>
            {SUGGESTED_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>
        <label>
          Runs on
          <select name="machine" defaultValue={machine}>
            <option value="">any</option>
            {MACHINES.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </label>
        <label>
          OS
          <select name="os" defaultValue={os}>
            <option value="">any</option>
            {OSES.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </label>
        <button type="submit">Filter</button>
      </form>

      <h1 className="results-heading">
        {q ? `Results for “${q}”` : "ZX Spectrum packages & dot commands"} <span className="count">({results.length})</span>
      </h1>

      <ul className="pkg-list">
        {results.map((p) => (
          <li key={p.name} className="pkg-card">
            <Link className="pkg-name" href={`/${p.name}`}>{p.name}</Link>
            <span className="pkg-version">{p.version}</span>
            {p.description && <p className="pkg-desc">{p.description}</p>}
            <div className="chips">
              <span className="chip chip-type">{p.type}</span>
              {splitCsv(p.machine_csv).map((m) => (
                <span key={m} className="chip">{m}</span>
              ))}
              {p.os_csv.split(",").filter(Boolean).map((o) => (
                <span key={o} className="chip chip-os">{o}</span>
              ))}
              {p.author && <span className="pkg-author">by {p.author}</span>}
            </div>
          </li>
        ))}
      </ul>
      {results.length === 0 && <p className="empty">No packages found.</p>}
    </>
  );
}
