import type {
  FileBinary,
  FileEntry,
  FileText,
  WireError,
  WriteResult
} from "../../registry/protocol";
import { errorCode, wireError } from "../../registry/protocol";

// ─────────────────────────────────────────────────────────────────────────────
// An in-memory files sandbox with the files channel's behaviour: direct-child
// listing (folders first), versions, version conflicts (-32005), missing files
// (-32601) and parent folders created by a write. Used by the unit mocks and by
// the integration hub.
// ─────────────────────────────────────────────────────────────────────────────

/** One stored file: text or a data URL, with its version. */
type Stored = { text: string; dataUrl: string | undefined; version: string };

/** The store: the files client plus test controls. */
export type FilesStore = {
  list(dir: string): Promise<readonly FileEntry[]>;
  read(path: string): Promise<FileText>;
  write(path: string, text: string, version?: string): Promise<WriteResult>;
  writeBinary(path: string, dataUrl: string): Promise<WriteResult>;
  readBinary(path: string): Promise<FileBinary>;
  /** Every stored path. */
  paths(): string[];
  /** Text of a stored file (throws when missing). */
  text(path: string): string;
  /** Data URL of a stored binary file. */
  dataUrl(path: string): string | undefined;
  /** Sets a file without a write (no version check). */
  put(path: string, text: string): void;
  /** Version of a stored file. */
  version(path: string): string | undefined;
  /** Writes in order: path and kind. */
  readonly writes: { readonly path: string; readonly kind: "text" | "binary" }[];
  /** Makes the next writes of a path fail with the error. */
  failWrites(path: string, error: WireError & Error): void;
};

/**
 * A missing-file rejection like the files plugin's.
 *
 * @param path - The path.
 * @returns The wire error.
 */
export function missing(path: string): Error & WireError {
  return wireError(errorCode.unknownMethod, `[moku-editor] No such file: ${path}`, {
    reason: "unknown_id"
  });
}

/**
 * A version-conflict rejection.
 *
 * @param path - The path.
 * @returns The wire error.
 */
export function conflict(path: string): Error & WireError {
  return wireError(errorCode.versionConflict, `[moku-editor] ${path} changed on disk`, {
    reason: "version_conflict"
  });
}

/**
 * Creates the store.
 *
 * @param initial - Files by path.
 * @returns The store.
 */
export function createFilesStore(initial: Readonly<Record<string, string>> = {}): FilesStore {
  const files = new Map<string, Stored>();
  const failing = new Map<string, Error & WireError>();
  let next = 1;
  const nextVersion = (): string => `v${next++}`;
  for (const [path, text] of Object.entries(initial)) {
    files.set(path, { text, dataUrl: undefined, version: nextVersion() });
  }
  const writes: { path: string; kind: "text" | "binary" }[] = [];

  const children = (dir: string): FileEntry[] | undefined => {
    const prefix = dir === "" || dir === "." ? "" : `${dir.replace(/\/$/, "")}/`;
    const dirs = new Set<string>();
    const entries: FileEntry[] = [];
    let any = prefix === "";
    for (const [path, stored] of files) {
      if (!path.startsWith(prefix)) continue;
      any = true;
      const rest = path.slice(prefix.length);
      const slash = rest.indexOf("/");
      if (slash === -1) {
        entries.push({ path, kind: "file", size: stored.text.length, version: stored.version });
      } else {
        dirs.add(`${prefix}${rest.slice(0, slash)}`);
      }
    }
    if (!any) return undefined;
    return [
      ...[...dirs].toSorted().map((path): FileEntry => ({ path, kind: "dir", size: 0 })),
      ...entries.toSorted((a, b) => a.path.localeCompare(b.path))
    ];
  };

  const store: FilesStore = {
    writes,
    list(dir) {
      const entries = children(dir);
      return entries === undefined ? Promise.reject(missing(dir)) : Promise.resolve(entries);
    },
    read(path) {
      const stored = files.get(path);
      return stored === undefined
        ? Promise.reject(missing(path))
        : Promise.resolve({ text: stored.text, version: stored.version });
    },
    write(path, text, version) {
      const failure = failing.get(path);
      if (failure !== undefined) return Promise.reject(failure);
      const stored = files.get(path);
      if (version !== undefined && stored !== undefined && stored.version !== version) {
        return Promise.reject(conflict(path));
      }
      const fresh = nextVersion();
      files.set(path, { text, dataUrl: undefined, version: fresh });
      writes.push({ path, kind: "text" });
      return Promise.resolve({ path, bytes: text.length, version: fresh });
    },
    writeBinary(path, dataUrl) {
      const failure = failing.get(path);
      if (failure !== undefined) return Promise.reject(failure);
      const fresh = nextVersion();
      files.set(path, { text: "", dataUrl, version: fresh });
      writes.push({ path, kind: "binary" });
      return Promise.resolve({ path, bytes: dataUrl.length, version: fresh });
    },
    readBinary(path) {
      const stored = files.get(path);
      return stored?.dataUrl === undefined
        ? Promise.reject(missing(path))
        : Promise.resolve({ dataUrl: stored.dataUrl, version: stored.version });
    },
    paths: () => [...files.keys()],
    text(path) {
      const stored = files.get(path);
      if (stored === undefined) throw new Error(`no file ${path}`);
      return stored.text;
    },
    dataUrl: path => files.get(path)?.dataUrl,
    put(path, text) {
      files.set(path, { text, dataUrl: undefined, version: nextVersion() });
    },
    version: path => files.get(path)?.version,
    failWrites(path, error) {
      failing.set(path, error);
    }
  };
  return store;
}
