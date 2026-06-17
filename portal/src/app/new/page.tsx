import type { Metadata } from "next";
import { validateManifest, type ManifestInput, SUGGESTED_TYPES, MACHINES, OSES, FEATURES } from "@/lib/manifest";
import { manifestToToml } from "@/lib/toml-gen";
import CopyButton from "./CopyButton";

export const dynamic = "force-dynamic";

const bp = process.env.NEXT_PUBLIC_BASE_PATH || "";

export const metadata: Metadata = {
  title: "Create a .zxpkg.toml manifest",
  description: "Wizard to generate a .zxpkg.toml manifest for publishing a ZX Spectrum package to ZXPkg.",
  alternates: { canonical: "/new" },
};

type SP = Record<string, string | string[] | undefined>;

export default function NewManifest({ searchParams }: { searchParams: SP }) {
  const sp = searchParams;
  const spStr = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const spArr = (k: string) => {
    const v = sp[k];
    return Array.isArray(v) ? v : v ? [v] : [];
  };
  const submitted = spStr("submitted") === "1";

  // Smart prefill: derive a package name from a pasted repo URL.
  const repoUrl = spStr("repo_url");
  const guessName = (() => {
    try {
      const parts = new URL(repoUrl).pathname.replace(/\.git$/, "").split("/").filter(Boolean);
      return (parts[parts.length - 1] || "").toLowerCase().replace(/[^a-z0-9._-]/g, "-");
    } catch {
      return "";
    }
  })();

  const v = (k: string, fb = "") => (submitted ? spStr(k) : fb);
  const osChecked = (o: string) => (submitted ? spArr("os").includes(o) : o === "esxdos");
  const machineChecked = (m: string) => (submitted ? spArr("machine").includes(m) : m === "next");
  const needChecked = (f: string) => (submitted ? spArr("needs").includes(f) : false);

  let toml: string | null = null;
  let errors: string[] = [];
  if (submitted) {
    const input: ManifestInput = {
      name: spStr("name") || guessName,
      version: spStr("version"),
      type: spStr("type") || "dot",
      description: spStr("description"),
      author: spStr("author"),
      license: spStr("license"),
      homepage: spStr("homepage") || repoUrl,
      redistributable: spStr("redistributable") || undefined,
      bundledIn: spStr("bundled_in") || undefined,
      machine: spArr("machine"),
      os: spArr("os"),
      needs: spArr("needs"),
      minCore: spStr("min_core"),
      artifacts: [{ src: spStr("src"), command: spStr("command") }],
    };
    const r = validateManifest(input);
    if (r.manifest) toml = manifestToToml(r.manifest);
    else errors = r.errors;
  }

  // Build the download URL from the current query.
  const qs = new URLSearchParams();
  for (const [k, val] of Object.entries(sp)) {
    if (Array.isArray(val)) val.forEach((x) => qs.append(k, x));
    else if (val != null) qs.set(k, val);
  }
  const downloadUrl = `${bp}/api/manifest?${qs.toString()}`;

  return (
    <section className="wizard">
      <h1>Create a package manifest</h1>
      <p className="muted">
        One manifest describes <strong>one package</strong>. Fill this in, save the result in your
        repository (see the filename hint below), then add the repo to ZXPkg. Run the wizard again for
        each package in a multi-command repo. Bump <code>version</code> to publish updates.
      </p>

      {spStr("submitted_repo") && (
        <p className="ok">
          Thanks! <strong>{spStr("submitted_repo")}</strong> {spStr("dup") ? "is already known, re-checking now" : "is now being watched"}. It will appear in the catalog once it has a <code>.zxpkg.toml</code>.
        </p>
      )}
      {spStr("submit_err") && <p className="err">⚠ {spStr("submit_err")}</p>}

      <div className="submit-box">
        <h2>Add your repo</h2>
        <p className="muted">
          Already pushed a <code>.zxpkg.toml</code>? Submit your public git repo and ZXPkg will watch it,
          index it, and re-index when you push updates. GitHub, GitLab, Codeberg, Bitbucket, or sr.ht.
        </p>
        <form method="post" action={`${bp}/api/submit`} className="admin-form">
          <input name="repo_url" type="url" placeholder="https://github.com/you/your-repo" defaultValue={repoUrl} required />
          <button type="submit">Submit repo</button>
        </form>
      </div>

      <h2>Generate a manifest</h2>
      {errors.length > 0 && (
        <div className="wizard-errors">
          <strong>Please fix:</strong>
          <ul>{errors.map((e) => <li key={e}>{e}</li>)}</ul>
        </div>
      )}

      <form method="get" action={`${bp}/new`} className="admin-form admin-grid">
        <input type="hidden" name="submitted" value="1" />
        <input name="repo_url" type="url" placeholder="repo URL (optional; prefills name &amp; homepage)" defaultValue={repoUrl} />
        <input name="name" placeholder="name (e.g. morse)" defaultValue={v("name") || guessName} required />
        <input name="version" placeholder="version (1.0.0)" defaultValue={v("version", "1.0.0")} required />
        <input name="type" list="zx-types" placeholder="type" defaultValue={v("type", "dot")} />
        <datalist id="zx-types">
          {SUGGESTED_TYPES.map((t) => <option key={t} value={t} />)}
        </datalist>
        <span className="os-select">
          <span className="grp-label">runs on</span>
          {MACHINES.map((m) => (
            <label key={m}><input type="checkbox" name="machine" value={m} defaultChecked={machineChecked(m)} /> {m}</label>
          ))}
        </span>
        <span className="os-select">
          <span className="grp-label">os</span>
          {OSES.map((o) => (
            <label key={o}><input type="checkbox" name="os" value={o} defaultChecked={osChecked(o)} /> {o}</label>
          ))}
        </span>
        <span className="os-select">
          <span className="grp-label">requires</span>
          {FEATURES.map((f) => (
            <label key={f}><input type="checkbox" name="needs" value={f} defaultChecked={needChecked(f)} /> {f}</label>
          ))}
        </span>
        <input name="command" placeholder="command/file in /DOT (MORSE)" defaultValue={v("command")} required />
        <input name="src" placeholder="src: build/MORSE or release URL" defaultValue={v("src")} required />
        <textarea name="description" placeholder="description" defaultValue={v("description")} rows={2} className="grid-full" />
        <input name="author" placeholder="author" defaultValue={v("author")} />
        <input name="license" placeholder="license (auto-detected at crawl if blank)" defaultValue={v("license")} />
        <input name="homepage" placeholder="homepage URL" defaultValue={v("homepage") || repoUrl} />
        <input name="min_core" placeholder="min Next core (optional)" defaultValue={v("min_core")} />
        <input name="bundled_in" placeholder="bundled in (e.g. esxdos 0.8.7) — optional" defaultValue={v("bundled_in")} />
        <label className="redist-field">
          redistributable
          <select name="redistributable" defaultValue={v("redistributable", "true")}>
            <option value="true">yes — portal may rehost</option>
            <option value="false">no — link-only (paid/restricted)</option>
          </select>
        </label>
        <button type="submit">Generate</button>
      </form>

      {toml && (
        <div className="wizard-out">
          <div className="wizard-out-head">
            <h2><code>{spStr("name")}.zxpkg.toml</code></h2>
            <span className="wizard-out-actions">
              <CopyButton text={toml} />
              <a href={downloadUrl} download={`${spStr("name")}.zxpkg.toml`}>Download</a>
            </span>
          </div>
          <pre><code>{toml}</code></pre>
          <div className="wizard-help">
            <p><strong>Where to put it</strong> (one manifest = one package; the crawler reads every <code>*.zxpkg.toml</code> in your repo):</p>
            <ul>
              <li><strong>Only package in the repo</strong> → save as <code>.zxpkg.toml</code> in the repo root.</li>
              <li><strong>One of several</strong>, flat layout → save as <code>{spStr("name")}.zxpkg.toml</code> in the root.</li>
              <li><strong>One of several</strong>, with a folder per command → save as <code>.zxpkg.toml</code> inside <code>{spStr("name")}/</code>.</li>
            </ul>
            <p className="muted">Then add the repo on the portal (or ask an admin to). Bump <code>version</code> and re-push to publish an update. For more packages, run this wizard again, one file each.</p>
          </div>
        </div>
      )}
    </section>
  );
}
