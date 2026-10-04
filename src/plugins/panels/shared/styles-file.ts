/**
 * @file Shared view module — the game's text-styles file: the first `.ts`/`.tsx` file under the
 * files root that calls `defineTextStyles(` (the game's text-style definer) on a line of code,
 * breadth-first, skipping node_modules, dist, .git and .moku, at most 400 reads (flowView's
 * Styles tab, gameView's Code section, D-13). The caller keeps the result; nothing here caches.
 */
import type { FileEntry, FileText } from "../../registry/protocol";

/**
 * Structural files client: link.files and tools.files fit it.
 */
export type StylesFileFiles = {
  list(dir: string): Promise<readonly FileEntry[]>;
  read(path: string): Promise<FileText>;
};

/**
 * Folders the search never enters.
 */
const SKIP: ReadonlySet<string> = new Set(["node_modules", "dist", ".git", ".moku"]);

/**
 * A source file the search reads.
 */
const SOURCE_FILE = /\.tsx?$/u;

/**
 * A call of the definer on a line of code (`defineTextStyles(`, also `kit.defineTextStyles(`).
 */
const DEFINER_CALL = /(^|\W)defineTextStyles\(/u;

/**
 * The definition of the definer itself (the game's text plugin), which is no styles file.
 */
const DEFINITION = "function defineTextStyles(";

/**
 * Most files one search reads.
 */
const MAX_READS = 400;

/**
 * The entries of a folder; a folder that cannot be listed is empty.
 *
 * @param files - The files client (link.files, tools.files).
 * @param dir - The folder ("" = the root).
 * @returns Its entries.
 */
async function listOf(files: StylesFileFiles, dir: string): Promise<readonly FileEntry[]> {
  try {
    return await files.list(dir);
  } catch {
    return [];
  }
}

/**
 * True when a text calls the definer on a line of code: comment lines and the definer's own
 * definition do not count.
 *
 * @param text - A source file's text.
 * @returns Whether the text defines text styles.
 * @example
 * ```ts
 * callsDefiner('export const uiStyles = defineTextStyles({ "ui.title": { size: 64 } });'); // true
 * callsDefiner(" * defineTextStyles({ ... })\nexport function defineTextStyles(map) {}"); // false
 * ```
 */
export function callsDefiner(text: string): boolean {
  return text.split("\n").some(line => {
    const code = line.trim();
    const isComment = code.startsWith("*") || code.startsWith("//") || code.startsWith("/*");
    return !isComment && !code.includes(DEFINITION) && DEFINER_CALL.test(code);
  });
}

/**
 * True when a file calls the definer; an unreadable file does not.
 *
 * @param files - The files client (link.files, tools.files).
 * @param path - The file.
 * @returns Whether it defines the text styles.
 */
async function defines(files: StylesFileFiles, path: string): Promise<boolean> {
  try {
    const file = await files.read(path);
    return callsDefiner(file.text);
  } catch {
    return false;
  }
}

/**
 * Sorts a folder listing: its source files in listing order, and the folders the search enters.
 *
 * @param entries - The listing.
 * @returns Source file paths and folder paths.
 * @example
 * ```ts
 * splitFolder([{ path: "src", kind: "dir", size: 0 }, { path: "a.ts", kind: "file", size: 1 }, { path: "dist", kind: "dir", size: 0 }]);
 * // { sources: ["a.ts"], folders: ["src"] }
 * ```
 */
export function splitFolder(entries: readonly FileEntry[]): {
  readonly sources: string[];
  readonly folders: string[];
} {
  const sources: string[] = [];
  const folders: string[] = [];
  for (const entry of entries) {
    const name = entry.path.slice(entry.path.lastIndexOf("/") + 1);
    if (entry.kind === "dir" && !SKIP.has(name)) folders.push(entry.path);
    if (entry.kind === "file" && SOURCE_FILE.test(entry.path)) sources.push(entry.path);
  }
  return { sources, folders };
}

/**
 * Searches the styles file breadth-first: the files of a folder in listing order before the
 * folders under it, at most 400 reads.
 *
 * @param files - The files client (link.files, tools.files).
 * @returns The path of the first file calling `defineTextStyles(`, or undefined.
 * @example
 * ```ts
 * await findStylesFile(link.files); // "src/plugins/text/styles.ts"
 * ```
 */
export async function findStylesFile(files: StylesFileFiles): Promise<string | undefined> {
  const queue = [""];
  let reads = 0;
  for (let next = 0; next < queue.length && reads < MAX_READS; next += 1) {
    const { sources, folders } = splitFolder(await listOf(files, queue[next] ?? ""));
    queue.push(...folders);
    for (const path of sources.slice(0, MAX_READS - reads)) {
      reads += 1;
      if (await defines(files, path)) return path;
    }
  }
  return undefined;
}
