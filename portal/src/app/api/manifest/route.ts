import { validateManifest, type ManifestInput } from "@/lib/manifest";
import { manifestToToml } from "@/lib/toml-gen";

export const dynamic = "force-dynamic";

// Generate a downloadable .zxpkg.toml from query params (used by the wizard's Download link).
export async function GET(req: Request) {
  const u = new URL(req.url);
  const p = u.searchParams;
  const input: ManifestInput = {
    name: p.get("name") || undefined,
    version: p.get("version") || undefined,
    type: p.get("type") || "dot",
    description: p.get("description") || undefined,
    author: p.get("author") || undefined,
    license: p.get("license") || undefined,
    homepage: p.get("homepage") || undefined,
    machine: p.get("machine") || "next",
    os: p.getAll("os"),
    needs: p.getAll("needs"),
    minCore: p.get("min_core") || undefined,
    artifacts: [{ src: p.get("src") || undefined, command: p.get("command") || undefined }],
  };

  const { manifest, errors } = validateManifest(input);
  if (!manifest) return new Response(`# invalid manifest:\n# ${errors.join("\n# ")}\n`, { status: 400 });

  return new Response(manifestToToml(manifest), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${manifest.name}.zxpkg.toml"`,
    },
  });
}
