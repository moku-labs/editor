/**
 * @file files plugin — type definitions. The wire shapes (FileEntry, FileText, FileBinary,
 * WriteResult) come from the protocol (R1); files declares only its config, state, api, the
 * `files:written` payload and its domain context.
 */
import type { Log } from "@moku-labs/common/browser";
import type { EmitFn } from "@moku-labs/core";
import type { ServerEvents } from "../../config";
import type { FileBinary, FileEntry, FileText, WriteResult } from "../registry/protocol";

/**
 * Resolved config of the files plugin. Shallow-merged; arrays replace the default entirely.
 *
 * @example
 * ```ts
 * createApp({ pluginConfigs: { files: { root: `${import.meta.dir}/..` } } });
 * ```
 */
export type FilesConfig = {
  /** Project root. Absolute, or relative to process.cwd() at init. Default ".". */
  root: string;
  /** Globs (relative to root, posix) a file must match to be read or written. */
  allow: readonly string[];
  /** Globs that are never listed, read or written. Matched case-insensitively. */
  deny: readonly string[];
};

/**
 * Files state. The compiled globs live here (the spec's State lists only rootReal and locks; the
 * globs compiled in onInit need a home, see Skeleton notes).
 */
export type FilesState = {
  /** Real (symlink-resolved) absolute root. Set once in onInit. "" before init. */
  rootReal: string;
  /** Compiled allow globs (case-sensitive). */
  allowGlobs: readonly RegExp[];
  /** Compiled deny globs (case-insensitive). */
  denyGlobs: readonly RegExp[];
  /** Per-path write lock: the tail promise of the last write to that relative path. */
  locks: Map<string, Promise<void>>;
};

/**
 * What a write was about, classified from its path.
 */
export type WrittenKind = "code" | "style" | "note" | "layout" | "capture" | "other";

/**
 * Payload of the global server event `files:written`.
 */
export type FilesWritten = {
  readonly path: string;
  readonly bytes: number;
  readonly kind: WrittenKind;
};

/**
 * The file operation a sandbox check is made for.
 */
export type FileOperation = "list" | "read" | "write" | "readBinary" | "writeBinary";

/**
 * The files api (`app.files`, `ctx.require(filesPlugin)`). Every rejection is an
 * `Error & WireError` built with the protocol's wireError.
 *
 * @example
 * ```ts
 * const { text, version } = await app.files.read("features/ui/styles.ts");
 * ```
 */
export type FilesApi = {
  /** Direct children of a folder: folders first, then allowed files. */
  list(dir: string): Promise<FileEntry[]>;
  /** A UTF-8 text file and its sha1 version. */
  read(path: string): Promise<FileText>;
  /** Atomic text write with optional optimistic concurrency. */
  write(path: string, text: string, version?: string): Promise<WriteResult>;
  /** Atomic image write under `.moku/captures/`. */
  writeBinary(path: string, bytes: Uint8Array): Promise<WriteResult>;
  /** An image as a data URL with its version (R3). */
  readBinary(path: string): Promise<FileBinary>;
  /** Full synchronous check; the absolute real path. */
  resolve(path: string): string;
  /** The real project root (R3). */
  root(): string;
};

/**
 * Domain context of files: the kernel context is assignable to it.
 */
export type FilesCtx = {
  readonly config: Readonly<FilesConfig>;
  state: FilesState;
  readonly emit: EmitFn<Pick<ServerEvents, "files:written">>;
  readonly log: Log.LogApi;
};
