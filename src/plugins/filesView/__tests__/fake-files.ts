import type { Mock } from "vitest";
import { vi } from "vitest";
import type { FilesClient } from "../../link/types";
import type { FileEntry, ProjectFound } from "../../registry/protocol";
import { wireError } from "../../registry/protocol";

// ─────────────────────────────────────────────────────────────────────────────
// An in-memory FilesClient: a flat path → text map, versions = a content hash,
// readBinary for images (the stored text is the data URL), folders derived from
// the paths, injectable errors (Error & WireError), a list concurrency gauge and
// the project-index answers of `find` by key.
// ─────────────────────────────────────────────────────────────────────────────

/** The fake files channel plus test controls. */
export type FakeFiles = {
  readonly client: FilesClient & {
    readonly list: Mock<FilesClient["list"]>;
    readonly read: Mock<FilesClient["read"]>;
    readonly write: Mock<FilesClient["write"]>;
    readonly readBinary: Mock<FilesClient["readBinary"]>;
    readonly find: Mock<FilesClient["find"]>;
  };
  /** Path → text (data URL for images). */
  readonly contents: Map<string, string>;
  /** Errors to throw, by `<method>:<path or dir>`; kept until deleted. */
  readonly failures: Map<string, Error>;
  /** What `find` answers, by key; an unknown key answers []. */
  readonly found: Map<string, readonly ProjectFound[]>;
  /** Folders listed, in call order. */
  readonly listed: string[];
  /** Highest number of list calls in flight at once. */
  maxInFlight: number;
  /** Changes a file behind the editor's back. */
  set(path: string, text: string): void;
  /** The version of a stored file. */
  versionOf(path: string): string | undefined;
};

/**
 * A sha1-like content hash (40 hex chars) of a text.
 *
 * @param text - The content.
 * @returns The version.
 */
export function hashOf(text: string): string {
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.trunc((hash * 33) ^ (text.codePointAt(index) ?? 0)) % 4_294_967_296;
  }
  return Math.abs(hash).toString(16).padStart(8, "0").repeat(5);
}

/** A missing file, as files reports it (-32601 unknown_id). */
export const notFoundError = (path: string): Error =>
  wireError(-32_601, `not found: ${path}`, { reason: "unknown_id", retryable: false, id: path });

/** A stale version (-32005 version_conflict). */
export const conflictError = (path: string): Error =>
  wireError(-32_005, `version conflict: ${path}`, {
    reason: "version_conflict",
    retryable: false,
    id: path
  });

/** A path outside the sandbox (-32004 forbidden_path). */
export const forbiddenError = (path: string): Error =>
  wireError(-32_004, `forbidden path: ${path}`, {
    reason: "forbidden_path",
    retryable: false,
    id: path
  });

/** A text over the read limit (-32000 command_failed). */
export const tooLargeError = (path: string): Error =>
  wireError(-32_000, `file too large: ${path}`, { reason: "command_failed", retryable: false });

/**
 * Creates the fake over seed files.
 *
 * @param seed - Path → text.
 * @returns The fake.
 */
export function createFakeFiles(seed: Readonly<Record<string, string>> = {}): FakeFiles {
  const contents = new Map(Object.entries(seed));
  const failures = new Map<string, Error>();
  const found = new Map<string, readonly ProjectFound[]>();
  const listed: string[] = [];
  let inFlight = 0;

  const fail = (key: string): void => {
    const error = failures.get(key);
    if (error !== undefined) throw error;
  };

  const childrenOf = (dir: string): FileEntry[] => {
    const prefix = dir === "" ? "" : `${dir}/`;
    const dirs = new Set<string>();
    const files: FileEntry[] = [];
    for (const [path, text] of contents) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      const slash = rest.indexOf("/");
      if (slash === -1) files.push({ path, kind: "file", size: text.length });
      else dirs.add(`${prefix}${rest.slice(0, slash)}`);
    }
    const folders: FileEntry[] = [...dirs].toSorted().map(path => ({ path, kind: "dir", size: 0 }));
    return [...folders, ...files.toSorted((left, right) => (left.path < right.path ? -1 : 1))];
  };

  const fake: FakeFiles = {
    contents,
    failures,
    found,
    listed,
    maxInFlight: 0,
    client: {
      list: vi.fn(async (dir: string) => {
        listed.push(dir);
        inFlight += 1;
        fake.maxInFlight = Math.max(fake.maxInFlight, inFlight);
        try {
          await new Promise(resolve => setTimeout(resolve, 0));
          fail(`list:${dir}`);
          return childrenOf(dir);
        } finally {
          inFlight -= 1;
        }
      }),
      read: vi.fn(async (path: string) => {
        await Promise.resolve();
        fail(`read:${path}`);
        const text = contents.get(path);
        if (text === undefined) throw notFoundError(path);
        return { text, version: hashOf(text) };
      }),
      write: vi.fn(async (path: string, text: string, version?: string) => {
        await Promise.resolve();
        fail(`write:${path}`);
        const current = contents.get(path);
        if (version !== undefined && (current === undefined || hashOf(current) !== version)) {
          throw conflictError(path);
        }
        contents.set(path, text);
        return { path, bytes: new TextEncoder().encode(text).length, version: hashOf(text) };
      }),
      writeBinary: vi.fn(async (path: string, dataUrl: string) => {
        await Promise.resolve();
        contents.set(path, dataUrl);
        return { path, bytes: dataUrl.length, version: hashOf(dataUrl) };
      }),
      readBinary: vi.fn(async (path: string) => {
        await Promise.resolve();
        fail(`readBinary:${path}`);
        const dataUrl = contents.get(path);
        if (dataUrl === undefined) throw notFoundError(path);
        return { dataUrl, version: hashOf(dataUrl) };
      }),
      find: vi.fn(async (key: string) => {
        await Promise.resolve();
        fail(`find:${key}`);
        return found.get(key) ?? [];
      })
    },
    set(path, text) {
      contents.set(path, text);
    },
    versionOf(path) {
      const text = contents.get(path);
      return text === undefined ? undefined : hashOf(text);
    }
  };
  return fake;
}
