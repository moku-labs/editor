/**
 * @file recorder store — the shape every log store has (OPFS or memory) and the structural OPFS
 * handles the OPFS store reads. The editor declares no global: the handles are the members the
 * store calls, nothing more.
 */
import type { LogFileInfo } from "../types";

/**
 * Where logs live (private): OPFS or memory, behind one shape.
 */
export type LogStore = {
  readonly kind: "opfs" | "memory";
  /** Every log in the store; a log whose meta says current (a page that died while recording) lists as finished. */
  list(): Promise<LogFileInfo[]>;
  /** Appends one chunk of text to a log and rewrites its meta; creates the log on its first chunk. */
  append(info: LogFileInfo, text: string): Promise<void>;
  /** Rewrites a log's meta only (sent counts, current false at stop). */
  describe(info: LogFileInfo): Promise<void>;
  /** The whole log as one Blob of type application/x-ndjson, chunks in order. */
  read(name: string): Promise<Blob>;
  remove(name: string): Promise<void>;
  /** Bytes the store holds in memory (the memory store's text; 0 for OPFS). */
  memoryBytes(): number;
};

/**
 * What `openStore` answers: the store, and why OPFS was wanted but not used.
 */
export type OpenedStore = { readonly store: LogStore; readonly reason?: string };

/**
 * The writable stream of an OPFS file (`FileSystemWritableFileStream`), as the store uses it.
 */
export type WritableLike = {
  write(data: string): Promise<void>;
  close(): Promise<void>;
};

/**
 * An OPFS file handle (`FileSystemFileHandle`), as the store uses it.
 */
export type FileHandleLike = {
  readonly kind: "file";
  readonly name: string;
  getFile(): Promise<Blob>;
  createWritable(): Promise<WritableLike>;
};

/**
 * An OPFS directory handle (`FileSystemDirectoryHandle`), as the store uses it.
 */
export type DirectoryHandleLike = {
  readonly kind: "directory";
  readonly name: string;
  values(): AsyncIterable<FileHandleLike | DirectoryHandleLike>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryHandleLike>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLike>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
};
