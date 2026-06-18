import Link from "next/link";
import { cookies } from "next/headers";
import { query } from "@/lib/db";
import { ADMIN_COOKIE, tokenIsValid } from "@/lib/admin-auth";
import { SUGGESTED_TYPES, MACHINES, OSES, FEATURES, OS_VERSION_OPTIONS, splitCsv } from "@/lib/manifest";
import { adminPackages, getManualManifest, getOverrideEditData, machineCollisions } from "@/lib/queries";

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
  vcs: string;
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

  // Load a package's base+override data for the per-field override form (any package).
  const overrideName = spStr("override");
  const ovr = overrideName ? await getOverrideEditData(overrideName) : null;

  // Load base data for the simple base-edit form (auto-added / poorly-parsed metadata).
  const editBaseName = spStr("editbase");
  const eb = editBaseName ? await getOverrideEditData(editBaseName) : null;

  // Defaults for the manual-package form: edit data > error round-trip > blanks.
  const pkg = edit
    ? {
        repo_url: edit.repoUrl,
        name: em.name || "",
        version: em.version || "",
        type: em.type || "dot",
        machine: (em.machine as string[]) || ["next"],
        os: (em.os as string[]) || ["esxdos"],
        needs: (em.needs as string[]) || [],
        redistributable: em.redistributable === false ? "false" : "true",
        bundled_in: (em.bundledIn as string) || "",
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
        machine: spArr("machine").length ? spArr("machine") : ["next"],
        os: spArr("os").length ? spArr("os") : ["esxdos"],
        needs: spArr("needs"),
        redistributable: spStr("redistributable") || "true",
        bundled_in: spStr("bundled_in"),
        command: spStr("command"),
        src: spStr("src"),
        description: spStr("description"),
        license: spStr("license"),
        author: spStr("author"),
        homepage: spStr("homepage"),
      }
    : { repo_url: "", name: "", version: "", type: "dot", machine: ["next"] as string[], os: ["esxdos"], needs: [] as string[], redistributable: "true", bundled_in: "", command: "", src: "", description: "", license: "", author: "", homepage: "" };

  // Defaults for the upload form (error round-trip only; the file can't be restored).
  const up =
    af === "upload"
      ? {
          binary_url: spStr("binary_url"),
          name: spStr("name"),
          version: spStr("version"),
          type: spStr("type") || "dot",
          machine: spArr("machine").length ? spArr("machine") : ["next"],
          os: spArr("os").length ? spArr("os") : ["esxdos"],
          needs: spArr("needs"),
          redistributable: spStr("redistributable") || "true",
          bundled_in: spStr("bundled_in"),
          command: spStr("command"),
          description: spStr("description"),
          license: spStr("license"),
          author: spStr("author"),
          homepage: spStr("homepage"),
          source_url: spStr("source_url"),
          source_label: spStr("source_label"),
        }
      : { binary_url: "", name: "", version: "", type: "dot", machine: ["next"] as string[], os: ["esxdos"], needs: [] as string[], redistributable: "true", bundled_in: "", command: "", description: "", license: "", author: "", homepage: "", source_url: "", source_label: "" };

  const crawlUrl = af === "crawl" ? spStr("url") : "";

  const repos = await query<RepoRow>(
    "SELECT id, source_url, status, error_message, last_crawled_at, last_commit_sha, vcs FROM repos ORDER BY source_url"
  );
  const pkgPage = await adminPackages({ page: parseInt(spStr("pkgpage") || "1", 10) || 1 });
  const packages = pkgPage.items;
  const pkgPageHref = (p: number) => `${bp}/admin?pkgpage=${p}#packages`;
  const pkgPageNums: number[] = [];
  for (let p = Math.max(1, pkgPage.page - 2); p <= Math.min(pkgPage.pages, pkgPage.page + 2); p++) pkgPageNums.push(p);
  const collisions = await machineCollisions();

  const okMsg: Record<string, string> = {
    "1": "Repository added and queued for crawl.",
    pkg: "Package saved and queued for indexing.",
    upload: "Binary uploaded and indexed.",
    del: "Package deleted.",
    repodel: "Repository and its packages deleted.",
    recrawl: "Re-crawl queued.",
    state: "Package state updated.",
    override: "Overrides saved; index & gopher rebuilt.",
    overridedrop: "Overrides dropped; base source restored.",
    metahidden: `Hid ${spStr("n")} metadata-only package(s).`,
    metalisted: `Re-listed ${spStr("n")} metadata-only package(s).`,
    editbase: "Metadata saved; index & gopher rebuilt.",
  };
  const ok = okMsg[spStr("ok")];

  // Two-step delete confirmation (no client JS): a Delete link lands here first.
  const confirmKind = spStr("confirm");
  const confirmName = spStr("name");
  const confirmId = spStr("id");

  // Override-form helpers: effective value = override (if set) else base.
  const ovEff = (field: string) =>
    ovr ? ((ovr.override?.[field as keyof typeof ovr.override] as string | null) ?? ovr.base[field as keyof typeof ovr.base] ?? "") : "";
  const ovIsSet = (field: string) => !!(ovr?.override && ovr.override[field as keyof typeof ovr.override] != null);
  const ovEffSet = (field: string) => splitCsv(ovEff(field));
  const ovRedist = ovr ? ((ovr.override?.redistributable ?? ovr.base.redistributable) === "0" ? "false" : "true") : "true";
  const ovTextFields = [
    { key: "homepage", label: "homepage" },
    { key: "license", label: "license" },
    { key: "author", label: "author" },
    { key: "bundled_in", label: "bundled in" },
  ];
  // base-edit form helpers (direct base values, no override layer)
  const ebSet = (field: string) => splitCsv((eb?.base[field as keyof typeof eb.base] as string) ?? "");
  const ebRedist = eb && eb.base.redistributable === "0" ? "false" : "true";

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
      {confirmKind === "remove" && confirmName && (
        <div className="confirm">
          <p>
            Remove <strong>{confirmName}</strong> at the owner&rsquo;s request? Its files (artifact,
            signature, source bundles) are deleted and it&rsquo;s pulled from the catalog &amp; device
            index. A tombstone is kept so it can&rsquo;t be silently re-archived.
          </p>
          <form method="post" action={`${bp}/api/admin/package/state`}>
            <input type="hidden" name="name" value={confirmName} />
            <input type="hidden" name="state" value="removed" />
            <button type="submit" className="btn-danger">Yes, remove</button>
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
        <input name="url" type="url" placeholder="https://github.com/owner/repo or svn URL" defaultValue={crawlUrl} required />
        <select name="type" defaultValue="auto" title="version-control type">
          <option value="auto">auto-detect</option>
          <option value="git">git</option>
          <option value="svn">svn (Subversion)</option>
        </select>
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
        <datalist id="zx-osversions">
          {OS_VERSION_OPTIONS.map((ov) => (
            <option key={ov} value={ov} />
          ))}
        </datalist>
        <span className="os-select">
          <span className="grp-label">runs on</span>
          {MACHINES.map((m) => (
            <label key={m}>
              <input type="checkbox" name="machine" value={m} defaultChecked={pkg.machine.includes(m)} /> {m}
            </label>
          ))}
        </span>
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
        <input name="bundled_in" placeholder="bundled in (e.g. esxdos 0.8.7)" defaultValue={pkg.bundled_in} />
        <label className="redist-field">redistributable
          <select name="redistributable" defaultValue={pkg.redistributable}>
            <option value="true">yes — rehost</option>
            <option value="false">no — link-only</option>
          </select>
        </label>
        <button type="submit">{edit ? "Save changes" : "Save package"}</button>
      </form>

      {eb && (
        <section className="override-edit">
          <h2 id="editbase">
            Edit metadata for <code>{eb.name}</code> <span className="muted">(owner {eb.owner})</span>
          </h2>
          <p className="muted">
            Edits the package&rsquo;s source fields directly — for auto-added / poorly-parsed metadata
            entries. (For repo-crawled packages use <strong>Override</strong> instead, since a re-crawl
            rewrites these.)
          </p>
          <form method="post" action={`${bp}/api/admin/package/edit-base`} encType="multipart/form-data" className="admin-form admin-grid">
            <input type="hidden" name="name" value={eb.name} />
            <input name="version" placeholder="version" defaultValue={eb.version} />
            <input name="type" list="zx-types" placeholder="type" defaultValue={eb.base.type ?? "dot"} />
            <input name="os_version" list="zx-osversions" placeholder="OS version (e.g. esxdos 0.8.7)" defaultValue={eb.base.os_version ?? ""} />
            <span className="os-select">
              <span className="grp-label">runs on</span>
              {MACHINES.map((m) => (
                <label key={m}><input type="checkbox" name="machine" value={m} defaultChecked={ebSet("machine_csv").includes(m)} /> {m}</label>
              ))}
            </span>
            <span className="os-select">
              <span className="grp-label">os</span>
              {OSES.map((o) => (
                <label key={o}><input type="checkbox" name="os" value={o} defaultChecked={ebSet("os_csv").includes(o)} /> {o}</label>
              ))}
            </span>
            <span className="os-select">
              <span className="grp-label">requires</span>
              {FEATURES.map((fk) => (
                <label key={fk}><input type="checkbox" name="needs" value={fk} defaultChecked={ebSet("needs_csv").includes(fk)} /> {fk}</label>
              ))}
            </span>
            <textarea name="description" placeholder="short description (cards + device)" defaultValue={eb.base.description ?? ""} rows={2} className="grid-full" />
            <textarea name="readme" placeholder="long description / readme — markdown, images ok (package page only)" defaultValue={eb.base.readme ?? ""} rows={8} className="grid-full readme-edit" />
            <input name="homepage" placeholder="homepage" defaultValue={eb.base.homepage ?? ""} />
            <input name="license" placeholder="license" defaultValue={eb.base.license ?? ""} />
            <input name="author" placeholder="author" defaultValue={eb.base.author ?? ""} />
            <input name="bundled_in" placeholder="bundled in (e.g. esxdos 0.8.7 final)" defaultValue={eb.base.bundled_in ?? ""} />
            <input name="repo_url" type="url" placeholder="repo URL (source link)" defaultValue={eb.repoUrl ?? ""} />
            <input name="download_url" type="url" placeholder="original download URL" defaultValue={eb.downloadUrl ?? ""} />
            <label className="redist-field">redistributable
              <select name="redistributable" defaultValue={ebRedist}>
                <option value="true">yes — rehost</option>
                <option value="false">no — link-only</option>
              </select>
            </label>
            <p className="muted grid-full">
              Attach a binary to make it installable (<code>.pkg-inst install {eb.name}</code>): give a command
              name plus a file <em>or</em> a binary URL. The portal signs + indexes it.
            </p>
            <input name="command" placeholder="command (e.g. ZXDBDL)" defaultValue="" />
            <input name="binary_file" type="file" />
            <input name="binary_url" type="url" placeholder="…or binary URL to fetch" defaultValue="" />
            <button type="submit">Save metadata</button>
          </form>
        </section>
      )}

      {ovr && (
        <section className="override-edit">
          <h2 id="override">
            Override fields for <code>{ovr.name}</code> <span className="muted">(owner {ovr.owner})</span>
          </h2>
          <p className="muted">
            Per-field edits that win over the package&rsquo;s source (seed / repo <code>.zxpkg.toml</code> / upload)
            and survive re-crawls. Tick <em>inherit</em> to clear a field back to its base value; leave a field
            untouched to keep tracking the source.
          </p>
          <form method="post" action={`${bp}/api/admin/package/override`} className="admin-form override-form">
            <input type="hidden" name="name" value={ovr.name} />

            <div className="override-field grid-full">
              <label className="of-label">description <span className="muted">(short; shown on cards + device)</span> {ovIsSet("description") && <span className="of-tag">overridden</span>}</label>
              <textarea name="description" rows={2} defaultValue={ovEff("description")} />
              <label className="of-inherit"><input type="checkbox" name="inherit_description" /> inherit</label>
              <div className="override-base">base: {ovr.base.description ? ovr.base.description : <em>(empty)</em>}</div>
            </div>

            <div className="override-field grid-full">
              <label className="of-label">readme <span className="muted">(markdown; rendered on the package page — headings, lists, code, links, ![images](url))</span> {ovIsSet("readme") && <span className="of-tag">overridden</span>}</label>
              <textarea name="readme" rows={10} defaultValue={ovEff("readme")} className="readme-edit" />
              <label className="of-inherit"><input type="checkbox" name="inherit_readme" /> inherit</label>
            </div>

            {ovTextFields.map((tf) => (
              <div className="override-field" key={tf.key}>
                <label className="of-label">{tf.label} {ovIsSet(tf.key) && <span className="of-tag">overridden</span>}</label>
                <input name={tf.key} defaultValue={ovEff(tf.key)} />
                <label className="of-inherit"><input type="checkbox" name={`inherit_${tf.key}`} /> inherit</label>
                <div className="override-base">base: {ovr.base[tf.key as keyof typeof ovr.base] || <em>(empty)</em>}</div>
              </div>
            ))}

            <div className="override-field">
              <label className="of-label">type {ovIsSet("type") && <span className="of-tag">overridden</span>}</label>
              <input name="type" list="zx-types" defaultValue={ovEff("type")} />
              <label className="of-inherit"><input type="checkbox" name="inherit_type" /> inherit</label>
              <div className="override-base">base: {ovr.base.type}</div>
            </div>

            <div className="override-field grid-full">
              <label className="of-label">runs on {ovIsSet("machine_csv") && <span className="of-tag">overridden</span>}</label>
              <span className="os-select">
                {MACHINES.map((m) => (
                  <label key={m}><input type="checkbox" name="machine" value={m} defaultChecked={ovEffSet("machine_csv").includes(m)} /> {m}</label>
                ))}
              </span>
              <label className="of-inherit"><input type="checkbox" name="inherit_machine" /> inherit</label>
              <div className="override-base">base: {ovr.base.machine_csv || <em>(none)</em>}</div>
            </div>

            <div className="override-field grid-full">
              <label className="of-label">os {ovIsSet("os_csv") && <span className="of-tag">overridden</span>}</label>
              <span className="os-select">
                {OSES.map((o) => (
                  <label key={o}><input type="checkbox" name="os" value={o} defaultChecked={ovEffSet("os_csv").includes(o)} /> {o}</label>
                ))}
              </span>
              <label className="of-inherit"><input type="checkbox" name="inherit_os" /> inherit</label>
              <div className="override-base">base: {ovr.base.os_csv || <em>(none)</em>}</div>
            </div>

            <div className="override-field grid-full">
              <label className="of-label">requires {ovIsSet("needs_csv") && <span className="of-tag">overridden</span>}</label>
              <span className="os-select">
                {FEATURES.map((fk) => (
                  <label key={fk}><input type="checkbox" name="needs" value={fk} defaultChecked={ovEffSet("needs_csv").includes(fk)} /> {fk}</label>
                ))}
              </span>
              <label className="of-inherit"><input type="checkbox" name="inherit_needs" /> inherit</label>
              <div className="override-base">base: {ovr.base.needs_csv || <em>(none)</em>}</div>
            </div>

            <div className="override-field">
              <label className="of-label">OS version {ovIsSet("os_version") && <span className="of-tag">overridden</span>}</label>
              <input name="os_version" list="zx-osversions" defaultValue={ovEff("os_version")} />
              <label className="of-inherit"><input type="checkbox" name="inherit_os_version" /> inherit</label>
              <div className="override-base">base: {ovr.base.os_version || <em>(none)</em>}</div>
            </div>

            <div className="override-field">
              <label className="of-label">redistributable {ovIsSet("redistributable") && <span className="of-tag">overridden</span>}</label>
              <select name="redistributable" defaultValue={ovRedist}>
                <option value="true">yes — rehost</option>
                <option value="false">no — link-only</option>
              </select>
              <label className="of-inherit"><input type="checkbox" name="inherit_redistributable" /> inherit</label>
              <div className="override-base">base: {ovr.base.redistributable === "0" ? "no" : "yes"}</div>
            </div>

            <div className="override-field grid-full">
              <label className="of-label">note <span className="muted">(why; admin-only)</span></label>
              <input name="note" defaultValue={ovr.override?.note ?? ""} />
            </div>

            <button type="submit">Save overrides</button>
          </form>
          {ovr.override && (
            <form method="post" action={`${bp}/api/admin/package/override/drop`} className="admin-form">
              <input type="hidden" name="name" value={ovr.name} />
              <button type="submit" className="btn-danger">Drop all overrides</button>
            </form>
          )}
        </section>
      )}

      <h2>Upload a binary <span className="muted">(no repo at all; for orphaned files)</span></h2>
      <p className="muted">Attach a file <em>or</em> give a binary URL. The portal downloads and archives the bytes either way.</p>
      <form method="post" action={`${bp}/api/admin/upload`} encType="multipart/form-data" className="admin-form admin-grid">
        <input name="file" type="file" />
        <input name="binary_url" type="url" placeholder="…or binary URL" defaultValue={up.binary_url} />
        <input name="name" placeholder="name (e.g. morse)" defaultValue={up.name} required />
        <input name="version" placeholder="version (1.0.0 or date 2017.11.21)" defaultValue={up.version} required />
        <input name="type" list="zx-types" placeholder="type" defaultValue={up.type} />
        <span className="os-select">
          <span className="grp-label">runs on</span>
          {MACHINES.map((m) => (
            <label key={m}>
              <input type="checkbox" name="machine" value={m} defaultChecked={up.machine.includes(m)} /> {m}
            </label>
          ))}
        </span>
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
        <input name="homepage" type="url" placeholder="homepage / original post URL" defaultValue={up.homepage} />
        <input name="bundled_in" placeholder="bundled in (e.g. esxdos 0.8.7)" defaultValue={up.bundled_in} />
        <label className="redist-field">redistributable
          <select name="redistributable" defaultValue={up.redistributable}>
            <option value="true">yes — rehost</option>
            <option value="false">no — link-only</option>
          </select>
        </label>
        <p className="muted grid-full">
          Preserve the author&rsquo;s original source (optional): attach a file <em>and/or</em> give an upstream URL
          to mirror. Stored as a download-only bundle — never signed, never sent to devices.
        </p>
        <input name="source_file" type="file" />
        <input name="source_url" type="url" placeholder="…or source URL to mirror (e.g. cowsay.zip)" defaultValue={up.source_url} />
        <input name="source_label" placeholder="source label (e.g. source + binary zip)" defaultValue={up.source_label} className="grid-full" />
        <button type="submit">Upload &amp; index</button>
      </form>

      {collisions.length > 0 && (
        <section className="collisions">
          <h2>⚠ Name collisions <span className="muted">({collisions.length})</span></h2>
          <p className="muted">
            Same name, overlapping machine set — two packages contend for one command on a platform.
            Mark one <code>preferred</code> per name (it wins on the site + device); the others stay archived.
          </p>
          <ul>
            {collisions.map((c) => (
              <li key={c.name}>
                <code>{c.name}</code>:{" "}
                {c.entries.map((e) => `${e.owner} [${e.machine.join(",")}]`).join("  vs  ")}
              </li>
            ))}
          </ul>
        </section>
      )}

      <h2 id="packages">Packages <span className="muted">({pkgPage.total})</span></h2>
      <div className="admin-bulk">
        <span className="muted">Metadata-only (no binary):</span>
        <form method="post" action={`${bp}/api/admin/packages/hide-metadata`}>
          <input type="hidden" name="state" value="hidden" />
          <button type="submit" className="linkish">Hide all</button>
        </form>
        <form method="post" action={`${bp}/api/admin/packages/hide-metadata`}>
          <input type="hidden" name="state" value="listed" />
          <button type="submit" className="linkish">Show all</button>
        </form>
      </div>
      <table className="repos">
        <thead>
          <tr><th>Name</th><th>Type</th><th>Version</th><th>Source</th><th>Kind</th><th>State</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {packages.map((p) => {
            const source = p.is_manual ? "manual" : p.repo_id == null ? "uploaded" : "repo";
            return (
              <tr key={p.name}>
                <td><Link href={`/${p.name}`}>{p.name}</Link></td>
                <td>{p.type || "—"}</td>
                <td>{p.version || "—"}</td>
                <td>{source}{p.is_overridden ? <span className="badge-ov">override</span> : null}</td>
                <td>
                  {p.has_artifact
                    ? <span className="badge-bin">binary</span>
                    : <span className="badge-meta">metadata</span>}
                </td>
                <td>
                  {p.archive_state === "listed"
                    ? "—"
                    : <span className={p.archive_state === "hidden" ? "badge-hidden" : "badge-removed"}>{p.archive_state}</span>}
                </td>
                <td className="row-actions">
                  {p.is_manual
                    ? <a href={`${bp}/admin?edit=${encodeURIComponent(p.name)}#manual`}>Edit</a>
                    : !p.has_artifact
                    ? <a href={`${bp}/admin?editbase=${encodeURIComponent(p.name)}#editbase`}>Edit</a>
                    : null}
                  <a href={`${bp}/admin?override=${encodeURIComponent(p.name)}#override`}>Override</a>
                  {p.archive_state !== "removed" && (
                    <>
                      <form method="post" action={`${bp}/api/admin/package/state`}>
                        <input type="hidden" name="name" value={p.name} />
                        <input type="hidden" name="state" value={p.archive_state === "hidden" ? "listed" : "hidden"} />
                        <button type="submit" className="linkish">{p.archive_state === "hidden" ? "Show" : "Hide"}</button>
                      </form>
                      <a href={`${bp}/admin?confirm=remove&name=${encodeURIComponent(p.name)}`}>Remove</a>
                    </>
                  )}
                  <a className="btn-danger-link" href={`${bp}/admin?confirm=package&name=${encodeURIComponent(p.name)}`}>Delete</a>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {pkgPage.pages > 1 && (
        <nav className="pager" aria-label="Packages pagination">
          {pkgPage.page > 1 ? <a href={pkgPageHref(pkgPage.page - 1)}>‹ Prev</a> : <span className="disabled">‹ Prev</span>}
          {pkgPageNums[0] > 1 && (
            <>
              <a href={pkgPageHref(1)}>1</a>
              {pkgPageNums[0] > 2 && <span className="gap">…</span>}
            </>
          )}
          {pkgPageNums.map((p) =>
            p === pkgPage.page ? <span key={p} className="current">{p}</span> : <a key={p} href={pkgPageHref(p)}>{p}</a>
          )}
          {pkgPageNums[pkgPageNums.length - 1] < pkgPage.pages && (
            <>
              {pkgPageNums[pkgPageNums.length - 1] < pkgPage.pages - 1 && <span className="gap">…</span>}
              <a href={pkgPageHref(pkgPage.pages)}>{pkgPage.pages}</a>
            </>
          )}
          {pkgPage.page < pkgPage.pages ? <a href={pkgPageHref(pkgPage.page + 1)}>Next ›</a> : <span className="disabled">Next ›</span>}
        </nav>
      )}

      <h2>Repositories <span className="muted">({repos.length})</span></h2>
      <table className="repos">
        <thead>
          <tr><th>Repository</th><th>Status</th><th>Last commit</th><th>Last crawled</th><th>Error</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {repos.map((r) => (
            <tr key={r.id}>
              <td>{r.source_url}{r.vcs === "svn" ? <span className="badge-meta">svn</span> : null}</td>
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
