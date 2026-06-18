import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { packagesByAuthor } from "@/lib/queries";
import { splitCsv } from "@/lib/manifest";

export const dynamic = "force-dynamic";

// Next URL-decodes route params, so params.author is the plain author string.
export async function generateMetadata({ params }: { params: { author: string } }): Promise<Metadata> {
  const author = params.author;
  return {
    title: `Packages by ${author}`,
    description: `ZX Spectrum packages and dot commands by ${author}.`,
    alternates: { canonical: `/author/${encodeURIComponent(author)}` },
  };
}

export default async function AuthorPage({ params }: { params: { author: string } }) {
  const data = await packagesByAuthor(params.author);
  if (!data) notFound();
  return (
    <section className="author-page">
      <h1 className="results-heading">
        Packages by {data.author} <span className="count">({data.items.length})</span>
      </h1>
      <ul className="pkg-list">
        {data.items.map((p) => (
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
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
