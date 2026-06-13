// Filesystem layout of the archive (STORE_DIR volume).
import { join } from "node:path";
import { env } from "./env";

const root = env.storeDir;

export const store = {
  root,
  mirrorDir(host: string, ownerRepo: string): string {
    return join(root, "mirrors", host, `${ownerRepo}.git`);
  },
  packageDir(pkg: string): string {
    return join(root, "artifacts", pkg);
  },
  artifactDir(pkg: string, version: string): string {
    return join(root, "artifacts", pkg, version);
  },
  artifactFile(pkg: string, version: string, command: string): string {
    return join(root, "artifacts", pkg, version, command);
  },
  sigFile(pkg: string, version: string, command: string): string {
    return join(root, "artifacts", pkg, version, `${command}.sig`);
  },
  indexDat(): string {
    return join(root, "index", "v1.dat");
  },
  indexSig(): string {
    return join(root, "index", "v1.dat.sig");
  },
  // Stable bootstrap copies of the on-device client (PKG, PKG-INST + .sig) for
  // the BASIC installer — published here by the device build, served by /dist.
  distFile(name: string): string {
    return join(root, "dist", name);
  },
  // Gopher human face (mirrors the website): the store IS the /pkg subtree the
  // hub mounts, so these land at /pkg/gophermap and /pkg/p/<name>/gophermap.
  gopherRootMap(): string {
    return join(root, "gophermap");
  },
  gopherPkgDir(pkg: string): string {
    return join(root, "p", pkg);
  },
  gopherPkgMap(pkg: string): string {
    return join(root, "p", pkg, "gophermap");
  },
  gopherDocFile(slug: string): string {   // rendered help/how-to text doc (type 0)
    return join(root, slug);
  },
};
