/**
 * @file recorder store — the OPFS store: a log is a directory named after the file without
 * `.jsonl`, holding `meta.json` (the LogFileInfo fields without `current` and `storage`, plus
 * `chunks`) and the chunk files `000001.jsonl`, `000002.jsonl`, …. Each append writes a NEW chunk
 * file, never a rewrite of a big one (a `createWritable` keeping existing data copies the whole
 * file on every write).
 */
import type { LogFileInfo } from "../types";
import { NDJSON } from "./memory";
import type { DirectoryHandleLike, FileHandleLike, LogStore } from "./types";

/** The directory of the editor's logs under the page's OPFS root. */
export const OPFS_DIR = "moku-editor-perf";

/** The meta file of a log. */
const META = "meta.json";

/** A chunk file name: six digits and `.jsonl`. */
const CHUNK_NAME = /^\d{6}\.jsonl$/;

/** What meta.json holds. */
type Meta = Omit<LogFileInfo, "current" | "storage"> & { readonly chunks: number };

/**
 * The directory name of a log.
 *
 * @param name - The log's file name.
 * @returns The name without `.jsonl`.
 * @example
 * ```ts
 * baseOf("perf-20261014-1532-sm-a266b.jsonl"); // "perf-20261014-1532-sm-a266b"
 * ```
 */
function baseOf(name: string): string {
  return name.endsWith(".jsonl") ? name.slice(0, -".jsonl".length) : name;
}

/**
 * The name of the chunk file with a number.
 *
 * @param chunk - The chunk number, from 1.
 * @returns Its file name.
 * @example
 * ```ts
 * chunkName(12); // "000012.jsonl"
 * ```
 */
function chunkName(chunk: number): string {
  return `${String(chunk).padStart(6, "0")}.jsonl`;
}

/**
 * Writes a whole file: created when missing, its text replaced.
 *
 * @param directory - The directory.
 * @param name - The file name.
 * @param text - The text.
 */
async function writeText(
  directory: DirectoryHandleLike,
  name: string,
  text: string
): Promise<void> {
  const file = await directory.getFileHandle(name, { create: true });
  const writable = await file.createWritable();
  await writable.write(text);
  await writable.close();
}

/**
 * The meta of a log directory, checked.
 *
 * @param directory - The log's directory.
 * @returns The meta; undefined when it is missing or not a log's meta.
 */
async function readMeta(directory: DirectoryHandleLike): Promise<Meta | undefined> {
  try {
    const file = await directory.getFileHandle(META);
    const blob = await file.getFile();
    const value: unknown = JSON.parse(await blob.text());
    return isMeta(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether a parsed value is a log's meta.
 *
 * @param value - The parsed meta.json.
 * @returns Whether every field has its type.
 */
function isMeta(value: unknown): value is Meta {
  const field = (key: string): unknown => Reflect.get(Object(value), key);
  const label = field("label");
  return (
    typeof field("name") === "string" &&
    (typeof label === "string" || label === null) &&
    ["startedAt", "lines", "bytes", "sent", "chunks"].every(key => typeof field(key) === "number")
  );
}

/**
 * The text of a log's meta.json.
 *
 * @param info - The log.
 * @param chunks - Its chunk count.
 * @returns The JSON text.
 */
function metaText(info: LogFileInfo, chunks: number): string {
  const { name, label, startedAt, lines, bytes, sent } = info;
  const meta: Meta = { name, label, startedAt, lines, bytes, sent, chunks };
  return JSON.stringify(meta);
}

/**
 * Creates the OPFS store over the editor's log directory.
 *
 * @param root - The `moku-editor-perf` directory.
 * @returns The store.
 */
export function createOpfsStore(root: DirectoryHandleLike): LogStore {
  /** Chunks per log written or read through this store. */
  const chunkCounts = new Map<string, number>();

  /**
   * The chunk count of a log: this store's, else its meta's, else 0.
   *
   * @param directory - The log's directory.
   * @param name - The log's name.
   * @returns The chunks it has.
   */
  const chunksOf = async (directory: DirectoryHandleLike, name: string): Promise<number> => {
    const known = chunkCounts.get(name);
    if (known !== undefined) return known;
    const meta = await readMeta(directory);
    return meta?.chunks ?? 0;
  };

  return {
    kind: "opfs",
    list: async () => {
      const infos: LogFileInfo[] = [];
      for await (const entry of root.values()) {
        if (entry.kind !== "directory") continue;
        const meta = await readMeta(entry);
        if (meta === undefined) continue;
        const { name, label, startedAt, lines, bytes, sent } = meta;
        infos.push({ name, label, startedAt, lines, bytes, sent, current: false, storage: "opfs" });
      }
      return infos.toSorted((a, b) => a.startedAt - b.startedAt);
    },
    append: async (info, text) => {
      const directory = await root.getDirectoryHandle(baseOf(info.name), { create: true });
      const chunk = (await chunksOf(directory, info.name)) + 1;
      await writeText(directory, chunkName(chunk), text);
      chunkCounts.set(info.name, chunk);
      await writeText(directory, META, metaText(info, chunk));
    },
    describe: async info => {
      const directory = await root.getDirectoryHandle(baseOf(info.name), { create: true });
      await writeText(directory, META, metaText(info, await chunksOf(directory, info.name)));
    },
    read: async name => {
      const directory = await root.getDirectoryHandle(baseOf(name));
      const files: FileHandleLike[] = [];
      for await (const entry of directory.values()) {
        if (entry.kind === "file" && CHUNK_NAME.test(entry.name)) files.push(entry);
      }
      files.sort((a, b) => a.name.localeCompare(b.name));
      const blobs = await Promise.all(files.map(file => file.getFile()));
      return new Blob(blobs, { type: NDJSON });
    },
    remove: async name => {
      await root.removeEntry(baseOf(name), { recursive: true });
      chunkCounts.delete(name);
    },
    memoryBytes: () => 0
  };
}
