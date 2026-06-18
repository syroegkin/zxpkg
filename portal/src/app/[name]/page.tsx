import type { Metadata } from "next";
import { basename } from "node:path";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { getPackage } from "@/lib/queries";
import { ADMIN_COOKIE, tokenIsValid } from "@/lib/admin-auth";
import { featureLabel, splitCsv, machinesLabel } from "@/lib/manifest";
import { md2html } from "@/lib/markdown";
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
          <header className="pkg-head">
            <h1>{pkg.name}</h1>
            <span className="muted">owner: {pkg.owner}</span>
          </header>
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
  // Installable on-device ⇔ it's in the signed device index: has a binary artifact AND is
  // redistributable. Metadata/link-only entries (no artifact) can't be `.pkg-inst install`ed.
  const installable = artifacts.length > 0 && !!pkg.redistributable;
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
            {pkg.archive_state === "hidden" && <span className="badge-hidden">hidden</span>}
            {pkg.is_manual ? (
              <a href={`${bp}/admin?edit=${encodeURIComponent(pkg.name)}#manual`}>Edit</a>
            ) : null}
            <a href={`${bp}/admin?override=${encodeURIComponent(pkg.name)}#override`}>Override</a>
            <form method="post" action={`${bp}/api/admin/package/state`} className="inline-form">
              <input type="hidden" name="name" value={pkg.name} />
              <input type="hidden" name="state" value={pkg.archive_state === "hidden" ? "listed" : "hidden"} />
              <input type="hidden" name="from" value="pkg" />
              <button type="submit" className="linkish">{pkg.archive_state === "hidden" ? "Show" : "Hide"}</button>
            </form>
            <a className="btn-danger-link" href={`${bp}/admin?confirm=package&name=${encodeURIComponent(pkg.name)}`}>Delete</a>
          </div>
        )}
        <header className="pkg-head">
          <h1>{pkg.name}</h1>
          {latest && <span className="pkg-version">{latest.version}</span>}
        </header>
        {pkg.description && <p className="pkg-lead">{pkg.description}</p>}

        {installable ? (
          <div className="install-box">
            <span className="install-label">Install on your ZX Spectrum</span>
            <code>.pkg-inst install {pkg.name}</code>
          </div>
        ) : (
          <div className="install-box install-box-meta">
            <span className="install-label">Archive entry — not installable on device</span>
            <span className="muted">
              No signed binary in the registry yet, so <code>.pkg-inst</code> can&rsquo;t fetch it. Grab it
              from the source or homepage links{pkg.redistributable ? "" : " (this one is preserved link-only)"}.
            </span>
          </div>
        )}

        {pkg.readme && (
          // md2html escapes all HTML and emits only a safe tag whitelist, so this is XSS-safe.
          <div className="pkg-readme" dangerouslySetInnerHTML={{ __html: md2html(pkg.readme) }} />
        )}

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
                  <td>{v.machine_csv.split(",").join(", ")}</td>
                  <td>{v.os_csv.split(",").join(", ")}</td>
                  <td>{ymd(v.created_at)}</td>
                  <td>
                    {va.map((a) => (
                      <span key={a.command} className="file-links">
                        <a href={`${bp}/artifact/${pkg.name}/${v.version}/${a.command}`}>{a.command}</a>
                        <a className="sig" href={`${bp}/artifact/${pkg.name}/${v.version}/${a.command}.sig`}>.sig</a>
                      </span>
                    ))}
                    {pkg.source_url && v.commit_sha && (
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
        {installable ? (
          <section>
            <h3>Install</h3>
            <code className="side-install">.pkg-inst install {pkg.name}</code>
          </section>
        ) : (
          <section>
            <h3>Not installable</h3>
            <p className="muted">
              {pkg.redistributable
                ? "Metadata/archive entry — no signed binary yet. Use the source or homepage link below."
                : "Preserved but not redistributed — download via the original source link below."}
            </p>
          </section>
        )}
        {latest && (
          <section>
            <h3>Compatibility</h3>
            <div className="chips">
              <span className="chip chip-type">{latest.type}</span>
              {splitCsv(latest.machine_csv).map((m) => (
                <span key={m} className="chip">{m}</span>
              ))}
              {latest.os_csv.split(",").filter(Boolean).map((o) => (
                <span key={o} className="chip chip-os">{o}</span>
              ))}
            </div>
            <p className="muted">runs on: {machinesLabel(latest.machine_csv)}</p>
            {latest.os_version && <p className="muted">for {latest.os_version}</p>}
            {latest.min_core && <p className="muted">core ≥ {latest.min_core}</p>}
            {latest.bundled_in && <p className="muted">bundled in {latest.bundled_in}</p>}
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
            <p><a href={`${bp}/author/${encodeURIComponent(pkg.author)}`}>{pkg.author}</a></p>
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
