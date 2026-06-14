import type { Metadata } from "next";
import { basename } from "node:path";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { getPackage } from "@/lib/queries";
import { ADMIN_COOKIE, tokenIsValid } from "@/lib/admin-auth";
import { featureLabel, supportedMachines } from "@/lib/manifest";
import { safeHref } from "@/lib/url-guard";
import { env } from "@/lib/env";
import JsonLd from "@/app/JsonLd";

export const dynamic = "force-dynamic";

const bp = process.env.NEXT_PUBLIC_BASE_PATH || "";

function hex(n: number): string {
  return (n >>> 0).toString(16).padStart(8, "0");
}
function ymd(d: unknown): string {
  return new Date(d as any).toISOString().slice(0, 10);
}

export async function generateMetadata({ params }: { params: { name: string } }): Promise<Metadata> {
  const data = await getPackage(params.name);
  if (!data) return { title: "Not found" };
  const description = data.pkg.description || `${data.pkg.name}: a dot command for the ZX Spectrum.`;
  return {
    title: data.pkg.name,
    description,
    alternates: { canonical: `/${data.pkg.name}` },
    openGraph: { title: `${data.pkg.name} · ZXPkg`, description, type: "website" },
  };
}

export default async function PackagePage({ params }: { params: { name: string } }) {
  const data = await getPackage(params.name);
  if (!data) notFound();
  const { pkg, versions, artifacts, bundles } = data;
  const isAdmin = tokenIsValid(cookies().get(ADMIN_COOKIE)?.value);

  // Takedown states: removed shows a tombstone to everyone; hidden is unlisted (admins
  // can still view by direct link, the public gets a 404).
  if (pkg.archive_state === "removed") {
    return (
      <article className="pkg-page">
        <div className="pkg-main">
          <header className="pkg-head"><h1>{pkg.name}</h1></header>
          <p className="pkg-lead">
            This package was removed at the owner&rsquo;s request{pkg.archived_at ? ` on ${ymd(pkg.archived_at)}` : ""}.
          </p>
          <p className="muted">The files are no longer available from this archive.</p>
        </div>
      </article>
    );
  }
  if (pkg.archive_state === "hidden" && !isAdmin) notFound();

  const latest = versions.find((v) => v.is_latest) || versions[0];
  const latestArtifacts = latest ? artifacts.filter((a) => a.version_id === latest.id) : [];
  // Preservation case: an uploaded package with no upstream git repository.
  const isPreserved = !pkg.source_url;
  const bundleHref = (b: (typeof bundles)[number], version: string): string | null =>
    b.file_path ? `${bp}/source/${pkg.name}/${version}/${basename(b.file_path)}` : safeHref(b.original_url);
  const bundleName = (b: (typeof bundles)[number]): string =>
    b.label || (b.file_path ? basename(b.file_path) : b.original_url ? b.original_url.replace(/^https?:\/\//, "") : "source");

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: pkg.name,
    description: pkg.description || undefined,
    applicationCategory: latest?.type === "game" ? "GameApplication" : "UtilitiesApplication",
    operatingSystem: latest?.os_csv.split(",").join(", "),
    softwareVersion: latest?.version,
    license: pkg.license || undefined,
    author: pkg.author ? { "@type": "Person", name: pkg.author } : undefined,
    url: `${env.publicBaseUrl}${bp}/${pkg.name}`,
  };

  return (
    <article className="pkg-page">
      <JsonLd data={jsonLd} />

      <div className="pkg-main">
        {isAdmin && (
          <div className="admin-bar">
            <span>Admin</span>
            {pkg.is_manual ? (
              <a href={`${bp}/admin?edit=${encodeURIComponent(pkg.name)}#manual`}>Edit</a>
            ) : null}
            <a className="btn-danger-link" href={`${bp}/admin?confirm=package&name=${encodeURIComponent(pkg.name)}`}>Delete</a>
          </div>
        )}
        <header className="pkg-head">
          <h1>{pkg.name}</h1>
          {latest && <span className="pkg-version">{latest.version}</span>}
        </header>
        {pkg.description && <p className="pkg-lead">{pkg.description}</p>}

        <div className="install-box">
          <span className="install-label">Install on your ZX Spectrum</span>
          <code>.pkg install {pkg.name}</code>
        </div>

        <h2>Versions</h2>
        <table className="versions">
          <thead>
            <tr>
              <th>Version</th>
              <th>Machine</th>
              <th>OS</th>
              <th>Published</th>
              <th>Files</th>
            </tr>
          </thead>
          <tbody>
            {versions.map((v) => {
              const va = artifacts.filter((a) => a.version_id === v.id);
              return (
                <tr key={v.id}>
                  <td>
                    {v.version}
                    {v.is_latest ? <span className="tag-latest">latest</span> : null}
                  </td>
                  <td>{v.machine}</td>
                  <td>{v.os_csv.split(",").join(", ")}</td>
                  <td>{ymd(v.created_at)}</td>
                  <td>
                    {va.map((a) => (
                      <span key={a.command} className="file-links">
                        <a href={`${bp}/artifact/${pkg.name}/${v.version}/${a.command}`}>{a.command}</a>
                        <a className="sig" href={`${bp}/artifact/${pkg.name}/${v.version}/${a.command}.sig`}>.sig</a>
                      </span>
                    ))}
                    {pkg.source_url && (
                      <a href={`${bp}/source/${pkg.name}/${v.version}.tar.gz`}>source</a>
                    )}
                    {bundles.filter((b) => b.version_id === v.id).map((b, i) => {
                      const href = bundleHref(b, v.version);
                      return href ? (
                        <a key={i} href={href} rel="nofollow">{bundleName(b)}</a>
                      ) : null;
                    })}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <aside className="pkg-side">
        <section>
          <h3>Install</h3>
          <code className="side-install">.pkg install {pkg.name}</code>
        </section>
        {latest && (
          <section>
            <h3>Compatibility</h3>
            <div className="chips">
              <span className="chip chip-type">{latest.type}</span>
              {supportedMachines(latest.machine).map((m) => (
                <span key={m} className="chip">{m}</span>
              ))}
              {latest.os_csv.split(",").filter(Boolean).map((o) => (
                <span key={o} className="chip chip-os">{o}</span>
              ))}
            </div>
            <p className="muted">minimum model: {latest.machine}</p>
            {latest.min_core && <p className="muted">core ≥ {latest.min_core}</p>}
          </section>
        )}
        {latest && latest.needs_csv.split(",").filter(Boolean).length > 0 && (
          <section>
            <h3>Requires</h3>
            <div className="chips">
              {latest.needs_csv.split(",").filter(Boolean).map((n) => (
                <span key={n} className="chip chip-need">{featureLabel(n)}</span>
              ))}
            </div>
          </section>
        )}
        {latestArtifacts.length > 0 && (
          <section>
            <h3>Latest files</h3>
            <ul className="crc-list">
              {latestArtifacts.map((a) => (
                <li key={a.command}>
                  <code>{a.command}</code> <span className="muted">crc32c {hex(a.crc32c)} · {a.size} B</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {(pkg.license || isPreserved) && (
          <section>
            <h3>License</h3>
            {pkg.license ? <p>{pkg.license}</p> : <p className="muted">unknown — preserved in good faith</p>}
          </section>
        )}
        {pkg.author && (
          <section>
            <h3>Author</h3>
            <p>{pkg.author}</p>
          </section>
        )}
        {pkg.source_url ? (
          <section>
            <h3>Repository</h3>
            <p>
              <a href={pkg.source_url} rel="nofollow">{pkg.source_url.replace(/^https:\/\//, "")}</a>
            </p>
          </section>
        ) : (
          <section>
            <h3>Source</h3>
            {bundles.length > 0 ? (
              <>
                <ul className="crc-list">
                  {bundles.map((b, i) => {
                    const v = versions.find((vr) => vr.id === b.version_id);
                    const href = v ? bundleHref(b, v.version) : null;
                    return (
                      <li key={i}>
                        {href ? <a href={href} rel="nofollow">{bundleName(b)}</a> : bundleName(b)}
                        {b.size ? <span className="muted"> · {b.size} B</span> : <span className="muted"> · link</span>}
                      </li>
                    );
                  })}
                </ul>
                <p className="muted">Original author&rsquo;s source, preserved as-is.</p>
              </>
            ) : (
              <p className="muted">Uploaded binary, no source repository.</p>
            )}
          </section>
        )}
        {isPreserved && (
          <section>
            <p className="muted">Preserved by the archive. Rights remain with the original author.</p>
          </section>
        )}
        {safeHref(pkg.homepage) && (
          <section>
            <h3>Homepage</h3>
            <p>
              <a href={safeHref(pkg.homepage)!} rel="nofollow noopener">{pkg.homepage!.replace(/^https?:\/\//, "")}</a>
            </p>
          </section>
        )}
      </aside>
    </article>
  );
}
