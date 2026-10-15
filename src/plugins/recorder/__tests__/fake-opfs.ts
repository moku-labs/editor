import type { DirectoryHandleLike, FileHandleLike, WritableLike } from "../store/types";

// ─────────────────────────────────────────────────────────────────────────────
// A fake OPFS: the structural handles of store/types.ts kept in memory. A file
// is written only on close (like a real writable stream); every write and
// remove is recorded; `failWrites` makes the next writes reject.
// ─────────────────────────────────────────────────────────────────────────────

/** The records every directory of one fake root writes into. */
type Records = {
  failWrites: number;
  writes: string[];
  removed: { name: string; recursive: boolean }[];
};

/** A fake file: its text after the last close. */
export type FakeFile = FileHandleLike & { text: string };

/** A fake directory, with the test's records. */
export type FakeDirectory = DirectoryHandleLike & {
  readonly entries: Map<string, FakeFile | FakeDirectory>;
  /** "<dir>/<file>" of each closed write, in order. */
  readonly writes: string[];
  /** Names removed, with whether the removal was recursive. */
  readonly removed: { name: string; recursive: boolean }[];
  /** The next this-many writes reject (anywhere under the root). */
  failWrites: number;
};

/**
 * A fake file under a directory.
 *
 * @param name - The file name.
 * @param root - The root, for the records.
 * @param path - The directory path, for the records.
 * @returns The file.
 */
function createFile(name: string, root: Records, path: string): FakeFile {
  const file: FakeFile = {
    kind: "file",
    name,
    text: "",
    getFile: async () => new Blob([file.text]),
    createWritable: async (): Promise<WritableLike> => {
      let buffer = "";
      return {
        write: async data => {
          if (root.failWrites > 0) {
            root.failWrites -= 1;
            throw new Error("QuotaExceededError: the disk is full");
          }
          buffer += data;
        },
        close: async () => {
          file.text = buffer;
          root.writes.push(`${path}/${name}`);
        }
      };
    }
  };
  return file;
}

/**
 * A fake OPFS directory.
 *
 * @param name - Its name.
 * @param root - The root it belongs to; itself when omitted.
 * @param path - Its path, for the records.
 * @returns The directory.
 */
export function createFakeDirectory(name = "", root?: Records, path = name): FakeDirectory {
  const entries = new Map<string, FakeFile | FakeDirectory>();
  const directory: FakeDirectory = {
    kind: "directory",
    name,
    entries,
    writes: [],
    removed: [],
    failWrites: 0,
    values: () => {
      const list = [...entries.values()];
      return (async function* () {
        yield* list;
      })();
    },
    getDirectoryHandle: async (child, options) => {
      const found = entries.get(child);
      if (found?.kind === "directory") return found;
      if (found !== undefined || options?.create !== true) {
        throw new Error(`NotFoundError: ${child}`);
      }
      const made = createFakeDirectory(child, root ?? directory, `${path}/${child}`);
      entries.set(child, made);
      return made;
    },
    getFileHandle: async (child, options) => {
      const found = entries.get(child);
      if (found?.kind === "file") return found;
      if (found !== undefined || options?.create !== true) {
        throw new Error(`NotFoundError: ${child}`);
      }
      const made = createFile(child, root ?? directory, path);
      entries.set(child, made);
      return made;
    },
    removeEntry: async (child, options) => {
      const found = entries.get(child);
      if (found === undefined) throw new Error(`NotFoundError: ${child}`);
      if (found.kind === "directory" && found.entries.size > 0 && options?.recursive !== true) {
        throw new Error(`InvalidModificationError: ${child} is not empty`);
      }
      entries.delete(child);
      (root ?? directory).removed.push({ name: child, recursive: options?.recursive === true });
    }
  };
  return directory;
}
