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
  /**
   * Lists the direct children of a folder inside the project root.
   *
   * @param dir - Relative folder path; `""` or `"."` for the root.
   * @returns Folders first, then allowed files, each sorted by path. `size` is 0 for folders.
   * @throws {Error} -32004 `forbidden_path` when a sandbox rule refuses the path, -32601
   * `unknown_id` when the folder is missing.
   * @example
   * ```ts
   * // The files panel opens the `src/nodes` folder of the tree.
   * await app.files.list("src/nodes"); // [{ path: "src/nodes/await-intent.ts", kind: "file", size: 812 }, …]
   * ```
   */
  list(dir: string): Promise<FileEntry[]>;

  /**
   * Reads a regular file as UTF-8 (invalid bytes become U+FFFD) with its version: the lowercase
   * hex sha1 of the bytes. Max 2 MiB.
   *
   * @param path - Relative file path.
   * @returns `{ text, version }`.
   * @throws {Error} -32004 `forbidden_path`, -32601 `unknown_id` when missing, -32000 over 2 MiB.
   * @example
   * ```ts
   * // Load a style file before editing it; keep the version for the save.
   * const { text, version } = await app.files.read("features/ui/styles.ts");
   * ```
   */
  read(path: string): Promise<FileText>;

  /**
   * Atomic text write. Missing parent folders are created inside the root. Emits `files:written`
   * after the rename. Max 2 MiB.
   *
   * @param path - Relative file path.
   * @param text - The new content.
   * @param version - Optional version from the last read; a stale one fails with -32005.
   * @returns `{ path, bytes, version }` of the written file.
   * @throws {Error} -32004 `forbidden_path`, -32005 `version_conflict` when the file changed
   * meanwhile, -32602 `invalid_input` (`field: "text"`) over 2 MiB.
   * @example
   * ```ts
   * // Save the edited text only if nobody changed the file since it was read.
   * const { version } = await app.files.read("features/ui/styles.ts");
   * await app.files.write("features/ui/styles.ts", edited, version); // { path, bytes, version }
   * ```
   */
  write(path: string, text: string, version?: string): Promise<WriteResult>;

  /**
   * Atomic image write, only under `.moku/captures/` and only for png, jpg, jpeg, webp and gif.
   * Missing parent folders are created. Emits `files:written` with `kind: "capture"`. Max 16 MiB.
   *
   * @param path - Relative capture path.
   * @param bytes - The image bytes (hub decodes them with `decodeDataUrl`).
   * @returns `{ path, bytes, version }` of the written image.
   * @throws {Error} -32004 `forbidden_path` outside `.moku/captures/` or without an image
   * extension, -32602 `invalid_input` (`field: "data"`) over 16 MiB.
   * @example
   * ```ts
   * // Store a board screenshot the capture panel took.
   * await app.files.writeBinary(".moku/captures/2026-09-24-1012-board.png", bytes);
   * ```
   */
  writeBinary(path: string, bytes: Uint8Array): Promise<WriteResult>;

  /**
   * Reads an image back as a data URL with its version (R3). Emits nothing. Max 16 MiB.
   *
   * @param path - Relative image path.
   * @returns `{ dataUrl, version }`.
   * @throws {Error} -32004 `forbidden_path` without an image extension, -32601 `unknown_id` when
   * missing, -32000 over 16 MiB.
   * @example
   * ```ts
   * // Show a stored capture again.
   * const { dataUrl } = await app.files.readBinary(".moku/captures/2026-09-24-1012-board.png");
   * // dataUrl: "data:image/png;base64,…"
   * ```
   */
  readBinary(path: string): Promise<FileBinary>;

  /**
   * Synchronous full sandbox check, as for a write. A missing file gives the path it would have.
   *
   * @param path - Relative file path.
   * @returns The real absolute path.
   * @throws {Error} -32004 `forbidden_path` when a sandbox rule refuses the path.
   * @example
   * ```ts
   * // Turn a project path into the absolute path an "Open in editor" link needs.
   * app.files.resolve("src/main.ts"); // "/Users/alex/game/src/main.ts"
   * ```
   */
  resolve(path: string): string;

  /**
   * The real, symlink-resolved project root (R3), for "Open in editor" links.
   *
   * @returns The absolute root.
   * @example
   * ```ts
   * // pages puts the root into the tools boot JSON.
   * const files = ctx.require(filesPlugin);
   * const boot = { root: files.root() }; // { root: "/Users/alex/game" }
   * ```
   */
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
