// Helpers for serving binary files from the store and validating URL path segments.
import { readFile } from "node:fs/promises";

// A path segment is safe if it has no separators or parent refs.
export function safeSeg(s: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(s) && !s.includes("..");
}

export async function serveFile(path: string, contentType: string, filename?: string): Promise<Response> {
  let data: Buffer;
  try {
    data = await readFile(path);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Content-Length": String(data.length),
  };
  if (filename) headers["Content-Disposition"] = `attachment; filename="${filename}"`;
  return new Response(new Uint8Array(data), { headers });
}
