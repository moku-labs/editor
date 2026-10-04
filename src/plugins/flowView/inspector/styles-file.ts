/**
 * @file flowView inspector module — the styles file when `stylesFile` is not configured: the first
 * `.ts`/`.tsx` file under the link root that calls `defineTextStyles(` (the game's text-style
 * definer) on a line of code, breadth-first, skipping node_modules, dist, .git and .moku; searched
 * once per session.
 */
import type { FilesClient } from "../../link/types";
import type { FileEntry } from "../../registry/protocol";
import type { FlowCtx, FlowEnvironment } from "../types";

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
 * @param files - link.files.
 * @param dir - The folder ("" = the root).
 * @returns Its entries.
 */
async function listOf(files: FilesClient, dir: string): Promise<readonly FileEntry[]> {
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
 * @param files - link.files.
 * @param path - The file.
 * @returns Whether it defines the text styles.
 */
async function defines(files: FilesClient, path: string): Promise<boolean> {
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
 * @param files - link.files.
 * @returns The path of the first file calling `defineTextStyles(`, or undefined.
 * @example
 * ```ts
 * await findStylesFile(link.files); // "src/plugins/text/styles.ts"
 * ```
 */
export async function findStylesFile(files: FilesClient): Promise<string | undefined> {
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

/**
 * The styles file of the Styles tab: `stylesFile` from the config, else the search result of this
 * session (one search per session, shared by every caller).
 *
 * @param ctx - Domain context of flowView.
 * @param env - Services and actions.
 * @returns The path, or undefined when no file calls the definer.
 */
export async function stylesFileOf(
  ctx: FlowCtx,
  env: FlowEnvironment
): Promise<string | undefined> {
  if (ctx.config.stylesFile !== undefined) return ctx.config.stylesFile;
  const { inspector, data } = ctx.state;
  if (inspector.found?.session !== data.session || inspector.found === undefined) {
    inspector.found = { session: data.session, path: findStylesFile(env.files()) };
  }
  return inspector.found.path;
}
