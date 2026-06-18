// VCS dispatcher: the archiver/source routes call these with a `kind` ("git" | "svn")
// and we delegate to the matching backend. Both modules expose the same interface.
import * as git from "./git";
import * as svn from "./svn";
import type { Vcs } from "./repo-url";

const impl = (kind: Vcs) => (kind === "svn" ? svn : git);

export const lsRemoteHead = (kind: Vcs, cloneUrl: string) => impl(kind).lsRemoteHead(cloneUrl);
export const ensureMirror = (kind: Vcs, cloneUrl: string, dir: string) => impl(kind).ensureMirror(cloneUrl, dir);
export const listManifests = (kind: Vcs, dir: string) => impl(kind).listManifests(dir);
export const readFileAtHead = (kind: Vcs, dir: string, path: string) => impl(kind).readFileAtHead(dir, path);
export const localHead = (kind: Vcs, dir: string) => impl(kind).localHead(dir);
export const archiveRef = (kind: Vcs, dir: string, ref: string, prefix: string) => impl(kind).archiveRef(dir, ref, prefix);
