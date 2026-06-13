import Link from "next/link";
import { cookies } from "next/headers";
import { query } from "@/lib/db";
import { ADMIN_COOKIE, tokenIsValid } from "@/lib/admin-auth";
import { SUGGESTED_TYPES, MACHINES, OSES, FEATURES } from "@/lib/manifest";
import { adminPackages, getManualManifest } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false } };

const bp = process.env.NEXT_PUBLIC_BASE_PATH || "";

interface RepoRow {
  id: number;
  source_url: string;
  status: string;
  error_message: string | null;
  last_crawled_at: string | null;
  last_commit_sha: string | null;
}

type SP = Record<string, string | string[] | undefined>;

export default async function Admin({ searchParams }: { searchParams: SP }) {
  const authed = tokenIsValid(cookies().get(ADMIN_COOKIE)?.value);

  if (!authed) {
    return (
      <section className="admin-login">
        <h1>Admin</h1>
        {searchParams.bad && <p className="err">Invalid token.</p>}
        <form method="post" action={`${bp}/api/admin/login`} className="admin-form">
          <input name="token" type="password" placeholder="admin token" required autoFocus />
          <button type="submit">Sign in</button>
        </form>
      </section>
    );
  }

  const sp = searchParams;
  const spStr = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const spArr = (k: string) => {
    const v = sp[k];
    return Array.isArray(v) ? v : v ? [v] : [];
  };
  const af = spStr("af");
  const err = spStr("err");
  const editName = spStr("edit");

  // Load a manual package for editing (pre-fills the manual form).
  const edit = editName ? await getManualManifest(editName) : null;
  const em = edit?.manifest ?? {};

  // Defaults for the manual-package form: edit data > error round-trip > blanks.
  const pkg = edit
    ? {
        repo_url: edit.repoUrl,
        name: em.name || "",
        version: em.version || "",
        type: em.type || "dot",
        machine: em.machine || "next",
        os: (em.os as string[]) || ["esxdos"],
        needs: (em.needs as string[]) || [],
        command: em.artifacts?.[0]?.command || "",
        src: em.artifacts?.[0]?.src || "",
        description: em.description || "",
        license: em.license || "",
        author: em.author || "",
        homepage: em.homepage || "",
      }
    : af === "pkg"
    ? {
        repo_url: spStr("repo_url"),
        name: spStr("name"),
        version: spStr("version"),
        type: spStr("type") || "dot",
        machine: spStr("machine") || "next",
        os: spArr("os").length ? spArr("os") : ["esxdos"],
        needs: spArr("needs"),
        command: spStr("command"),
        src: spStr("src"),
        description: spStr("description"),
        license: spStr("license"),
        author: spStr("author"),
        homepage: spStr("homepage"),
      }
    : { repo_url: "", name: "", version: "", type: "dot", machine: "next", os: ["esxdos"], needs: [] as string[], command: "", src: "", description: "", license: "", author: "", homepage: "" };

  // Defaults for the upload form (error round-trip only; the file can't be restored).
  const up =
    af === "upload"
      ? {
          binary_url: spStr("binary_url"),
          name: spStr("name"),
          version: spStr("version"),
          type: spStr("type") || "dot",
          machine: spStr("machine") || "next",
          os: spArr("os").length ? spArr("os") : ["esxdos"],
          needs: spArr("needs"),
          command: spStr("command"),
          description: spStr("description"),
          license: spStr("license"),
          author: spStr("author"),
        }
      : { binary_url: "", name: "", version: "", type: "dot", machine: "next", os: ["esxdos"], needs: [] as string[], command: "", description: "", license: "", author: "" };

  const crawlUrl = af === "crawl" ? spStr("url") : "";

  const repos = await query<RepoRow>(
    "SELECT id, source_url, status, error_message, last_crawled_at, last_commit_sha FROM repos ORDER BY source_url"
  );
  const packages = await adminPackages();

  const okMsg: Record<string, string> = {
    "1": "Repository added and queued for crawl.",
    pkg: "Package saved and queued for indexing.",
    upload: "Binary uploaded and indexed.",
    del: "Package deleted.",
    repodel: "Repository and its packages deleted.",
    recrawl: "Re-crawl queued.",
  };
  const ok = okMsg[spStr("ok")];

  // Two-step delete confirmation (no client JS): a Delete link lands here first.
  const confirmKind = spStr("confirm");
  const confirmName = spStr("name");
  const confirmId = spStr("id");

  return (
    <section className="admin">
      <div className="admin-top">
        <h1>Admin</h1>
        <form method="post" action={`${bp}/api/admin/logout`}>
          <button type="submit" className="linkish">Sign out</button>
        </form>
      </div>

      {ok && <p className="ok">{ok}</p>}
      {err && <p className="err">⚠ {err}</p>}

      {confirmKind === "package" && confirmName && (
        <div className="confirm">
          <p>Delete package <strong>{confirmName}</strong> and all its versions &amp; files? This can&rsquo;t be undone.</p>
          <form method="post" action={`${bp}/api/admin/package/delete`}>
            <input type="hidden" name="name" value={confirmName} />
            <button type="submit" className="btn-danger">Yes, delete</button>
          </form>
          <a className="cancel" href={`${bp}/admin`}>Cancel</a>
        </div>
      )}
      {confirmKind === "repo" && confirmId && (
        <div className="confirm">
          <p>
            Delete repository{" "}
            <strong>{repos.find((r) => String(r.id) === confirmId)?.source_url || confirmId}</strong>{" "}
            and all its packages? This can&rsquo;t be undone.
          </p>
          <form method="post" action={`${bp}/api/admin/repo/delete`}>
            <input type="hidden" name="id" value={confirmId} />
            <button type="submit" className="btn-danger">Yes, delete</button>
          </form>
          <a className="cancel" href={`${bp}/admin`}>Cancel</a>
        </div>
      )}

      <h2>Add a repo that has a <code>.zxpkg.toml</code></h2>
      <form method="post" action={`${bp}/api/admin/crawl`} className="admin-form">
        <input name="url" type="url" placeholder="https://github.com/owner/repo" defaultValue={crawlUrl} required />
        <button type="submit">Add &amp; crawl</button>
      </form>

      <h2 id="manual">
        {edit ? <>Edit package <code>{editName}</code></> : <>Add a package manually <span className="muted">(no manifest needed)</span></>}
      </h2>
      <form method="post" action={`${bp}/api/admin/package`} className="admin-form admin-grid">
        <input name="repo_url" type="url" placeholder="repo URL (git)" defaultValue={pkg.repo_url} required />
        <input name="name" placeholder="name (e.g. morse)" defaultValue={pkg.name} readOnly={!!edit} required />
        <input name="version" placeholder="version (1.0.0)" defaultValue={pkg.version} required />
        <input name="type" list="zx-types" placeholder="type" defaultValue={pkg.type} />
        <datalist id="zx-types">
          {SUGGESTED_TYPES.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
        <select name="machine" defaultValue={pkg.machine}>
          {MACHINES.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <span className="os-select">
          <span className="grp-label">os</span>
          {OSES.map((o) => (
            <label key={o}>
              <input type="checkbox" name="os" value={o} defaultChecked={pkg.os.includes(o)} /> {o}
            </label>
          ))}
        </span>
        <span className="os-select">
          <span className="grp-label">requires</span>
          {FEATURES.map((fkey) => (
            <label key={fkey}>
              <input type="checkbox" name="needs" value={fkey} defaultChecked={pkg.needs.includes(fkey)} /> {fkey}
            </label>
          ))}
        </span>
        <input name="command" placeholder="command/file (MORSE)" defaultValue={pkg.command} required />
        <input name="src" placeholder="src: build/MORSE or https URL" defaultValue={pkg.src} required />
        <textarea name="description" placeholder="description" defaultValue={pkg.description} rows={2} className="grid-full" />
        <input name="license" placeholder="license" defaultValue={pkg.license} />
        <input name="author" placeholder="author" defaultValue={pkg.author} />
        <input name="homepage" placeholder="homepage" defaultValue={pkg.homepage} />
        <button type="submit">{edit ? "Save changes" : "Save package"}</button>
      </form>

      <h2>Upload a binary <span className="muted">(no repo at all; for orphaned files)</span></h2>
      <p className="muted">Attach a file <em>or</em> give a binary URL. The portal downloads and archives the bytes either way.</p>
      <form method="post" action={`${bp}/api/admin/upload`} encType="multipart/form-data" className="admin-form admin-grid">
        <input name="file" type="file" />
        <input name="binary_url" type="url" placeholder="…or binary URL" defaultValue={up.binary_url} />
        <input name="name" placeholder="name (e.g. morse)" defaultValue={up.name} required />
        <input name="version" placeholder="version (1.0.0)" defaultValue={up.version} required />
        <input name="type" list="zx-types" placeholder="type" defaultValue={up.type} />
        <select name="machine" defaultValue={up.machine}>
          {MACHINES.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <span className="os-select">
          <span className="grp-label">os</span>
          {OSES.map((o) => (
            <label key={o}>
              <input type="checkbox" name="os" value={o} defaultChecked={up.os.includes(o)} /> {o}
            </label>
          ))}
        </span>
        <span className="os-select">
          <span className="grp-label">requires</span>
          {FEATURES.map((fkey) => (
            <label key={fkey}>
              <input type="checkbox" name="needs" value={fkey} defaultChecked={up.needs.includes(fkey)} /> {fkey}
            </label>
          ))}
        </span>
        <input name="command" placeholder="command/file (MORSE)" defaultValue={up.command} required />
        <textarea name="description" placeholder="description" defaultValue={up.description} rows={2} className="grid-full" />
        <input name="license" placeholder="license" defaultValue={up.license} />
        <input name="author" placeholder="author" defaultValue={up.author} />
        <button type="submit">Upload &amp; index</button>
      </form>

      <h2>Packages <span className="muted">({packages.length})</span></h2>
      <table className="repos">
        <thead>
          <tr><th>Name</th><th>Type</th><th>Version</th><th>Source</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {packages.map((p) => {
            const source = p.is_manual ? "manual" : p.repo_id == null ? "uploaded" : "repo";
            return (
              <tr key={p.name}>
                <td><Link href={`/${p.name}`}>{p.name}</Link></td>
                <td>{p.type || "—"}</td>
                <td>{p.version || "—"}</td>
                <td>{source}</td>
                <td className="row-actions">
                  {p.is_manual ? <a href={`${bp}/admin?edit=${encodeURIComponent(p.name)}#manual`}>Edit</a> : null}
                  <a className="btn-danger-link" href={`${bp}/admin?confirm=package&name=${encodeURIComponent(p.name)}`}>Delete</a>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h2>Repositories <span className="muted">({repos.length})</span></h2>
      <table className="repos">
        <thead>
          <tr><th>Repository</th><th>Status</th><th>Last commit</th><th>Last crawled</th><th>Error</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {repos.map((r) => (
            <tr key={r.id}>
              <td>{r.source_url}</td>
              <td>{r.status}</td>
              <td>{r.last_commit_sha ? r.last_commit_sha.slice(0, 8) : "—"}</td>
              <td>{r.last_crawled_at ? new Date(r.last_crawled_at as any).toISOString().slice(0, 16).replace("T", " ") : "—"}</td>
              <td className="err">{r.error_message || ""}</td>
              <td className="row-actions">
                <form method="post" action={`${bp}/api/admin/recrawl`}>
                  <input type="hidden" name="id" value={r.id} />
                  <button type="submit">Re-crawl</button>
                </form>
                <a className="btn-danger-link" href={`${bp}/admin?confirm=repo&id=${r.id}`}>Delete</a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
