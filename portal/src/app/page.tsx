import Link from "next/link";
import { cookies } from "next/headers";
import { searchPackages } from "@/lib/queries";
import { ADMIN_COOKIE, tokenIsValid } from "@/lib/admin-auth";
import { MACHINES, OSES, SUGGESTED_TYPES, splitCsv } from "@/lib/manifest";
import { env } from "@/lib/env";
import JsonLd from "@/app/JsonLd";

export const dynamic = "force-dynamic";

const bp = process.env.NEXT_PUBLIC_BASE_PATH || "";

export default async function Home({
  searchParams,
}: {
  searchParams: { q?: string; type?: string; machine?: string; os?: string; page?: string };
}) {
  const q = searchParams.q || "";
  const type = searchParams.type || "";
  const machine = searchParams.machine || "";
  const os = searchParams.os || "";
  // Admins also see hidden packages in the catalog (badged), so they can find + manage them.
  const isAdmin = tokenIsValid(cookies().get(ADMIN_COOKIE)?.value);
  const { items: results, total, page, pages } = await searchPackages({
    q: q || undefined,
    type: type || undefined,
    machine: machine || undefined,
    os: os || undefined,
    page: parseInt(searchParams.page || "1", 10) || 1,
    includeHidden: isAdmin,
  });
  // page link preserving the active filters
  const pageHref = (p: number) => {
    const u = new URLSearchParams();
    if (q) u.set("q", q);
    if (type) u.set("type", type);
    if (machine) u.set("machine", machine);
    if (os) u.set("os", os);
    u.set("page", String(p));
    return `${bp}/?${u.toString()}`;
  };
  // windowed page numbers around the current page
  const pageNums: number[] = [];
  for (let p = Math.max(1, page - 2); p <= Math.min(pages, page + 2); p++) pageNums.push(p);

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
        {q ? `Results for “${q}”` : "ZX Spectrum packages & dot commands"} <span className="count">({total})</span>
      </h1>

      <ul className="pkg-list">
        {results.map((p) => (
          <li key={p.name} className="pkg-card">
            <Link className="pkg-name" href={`/${p.name}`}>{p.name}</Link>
            <span className="pkg-version">{p.version}</span>
            {p.archive_state === "hidden" && <span className="badge-hidden">hidden</span>}
            {p.description && <p className="pkg-desc">{p.description}</p>}
            <div className="chips">
              <span className="chip chip-type">{p.type}</span>
              {splitCsv(p.machine_csv).map((m) => (
                <span key={m} className="chip">{m}</span>
              ))}
              {p.os_csv.split(",").filter(Boolean).map((o) => (
                <span key={o} className="chip chip-os">{o}</span>
              ))}
              {p.author && <Link className="pkg-author" href={`/author/${encodeURIComponent(p.author)}`}>by {p.author}</Link>}
            </div>
          </li>
        ))}
      </ul>
      {results.length === 0 && <p className="empty">No packages found.</p>}

      {pages > 1 && (
        <nav className="pager" aria-label="Pagination">
          {page > 1 ? <Link href={pageHref(page - 1)} rel="prev">‹ Prev</Link> : <span className="disabled">‹ Prev</span>}
          {pageNums[0] > 1 && (
            <>
              <Link href={pageHref(1)}>1</Link>
              {pageNums[0] > 2 && <span className="gap">…</span>}
            </>
          )}
          {pageNums.map((p) =>
            p === page ? <span key={p} className="current" aria-current="page">{p}</span> : <Link key={p} href={pageHref(p)}>{p}</Link>
          )}
          {pageNums[pageNums.length - 1] < pages && (
            <>
              {pageNums[pageNums.length - 1] < pages - 1 && <span className="gap">…</span>}
              <Link href={pageHref(pages)}>{pages}</Link>
            </>
          )}
          {page < pages ? <Link href={pageHref(page + 1)} rel="next">Next ›</Link> : <span className="disabled">Next ›</span>}
        </nav>
      )}
    </>
  );
}
