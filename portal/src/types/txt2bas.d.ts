// Minimal types for remysharp's txt2bas (no bundled declarations).
declare module "txt2bas" {
  /** Tokenize a NextBASIC text listing into a +3DOS-headered .bas file. */
  export function file2bas(src: string, options?: Record<string, unknown>): Uint8Array;
  /** Detokenize a .bas file back to a text listing. */
  export function file2txt(src: Uint8Array, options?: Record<string, unknown>): string;
}
