/**
 * @file pages plugin — the discovery file `<root>/.moku/editor.json` (M3, M6). A serving bin writes
 * it after `Bun.serve` (mode 0600, through a temp file and a rename, so a reader never sees half a
 * file) and removes it on stop and on process exit. The MCP bridge reads it to find the running
 * editor. It holds the hub token: never print or log it. `isGameFolder` lives here too: the one
 * rule by which the bin and the MCP bridge (which may import this module, D-31) tell a moku-game
 * folder and start the engine page (D-63). The perf CLI writes its own `.moku/perf.json` through
 * the same private record helpers (`publishRecord`).
 */
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { dirname, join } from "node:path/posix";
import type { EditorDiscovery } from "./types";

/**
 * The discovery file, relative to the project root.
 */
export const DISCOVERY_FILE = ".moku/editor.json";

/**
 * Owner read and write only: the file holds the token.
 */
const FILE_MODE = 0o600;

/**
 * What a serving bin knows when it writes the discovery file.
 */
export type DiscoveryInput = {
  /** The bin's process id. */
  readonly pid: number;
  /** The real port on 127.0.0.1. */
  readonly port: number;
  /** `hub.path()`, such as "/__editor". */
  readonly path: string;
  /** `hub.token()`. */
  readonly token: string;
  /** The absolute project root. */
  readonly root: string;
  /** The absolute game HTML file. */
  readonly html: string;
  /** When the file is written (`Date.now()`). */
  readonly startedAt: number;
};

/**
 * Whether a path is a file.
 *
 * @param path - An absolute path.
 * @returns True for a file, false for a folder or nothing.
 * @example
 * ```ts
 * isFile("/games/timber/index.ts"); // true
 * isFile("/games/timber"); // false: a folder
 * ```
 */
function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Whether a folder holds a moku-game: `index.ts` and `config.ts`, both files.
 *
 * @param root - The absolute folder.
 * @returns True for a moku-game folder.
 * @example
 * ```ts
 * isGameFolder("/games/timber"); // true: /games/timber/index.ts and config.ts exist
 * isGameFolder("/games/timber/web"); // false
 * ```
 */
export function isGameFolder(root: string): boolean {
  return isFile(join(root, "index.ts")) && isFile(join(root, "config.ts"));
}

/**
 * The absolute path of the discovery file under a root.
 *
 * @param root - The project root.
 * @returns `<root>/.moku/editor.json`.
 * @example
 * ```ts
 * discoveryPath("/games/merge"); // "/games/merge/.moku/editor.json"
 * ```
 */
export function discoveryPath(root: string): string {
  return join(root, DISCOVERY_FILE);
}

/**
 * The discovery record of a serving bin: version 1, the loopback URL and the hub websocket URL
 * without its query.
 *
 * @param input - What the bin knows.
 * @returns The record to write.
 * @example
 * ```ts
 * const record = discoveryOf({ pid: process.pid, port: 3000, path: "/__editor", token, root, html, startedAt: Date.now() });
 * record.ws; // "ws://127.0.0.1:3000/__editor/ws"
 * ```
 */
export function discoveryOf(input: DiscoveryInput): EditorDiscovery {
  const { pid, port, path, token, root, html, startedAt } = input;
  return {
    version: 1,
    pid,
    port,
    url: `http://127.0.0.1:${port}`,
    ws: `ws://127.0.0.1:${port}${path}/ws`,
    token,
    root,
    html,
    startedAt
  };
}

/**
 * Writes a private JSON record: creates its folder when missing, writes a fresh temp file with
 * mode 0600, then renames it over the old file, so a reader never sees half a file. Shared by
 * `.moku/editor.json` and the perf CLI's `.moku/perf.json`.
 *
 * @param path - The absolute file.
 * @param record - The record; its pid names the temp file.
 * @param record.pid - The writing process id.
 * @throws {Error} When the folder or the file cannot be written.
 */
export function writeRecord(path: string, record: { readonly pid: number }): void {
  const temporary = `${path}.${record.pid}.tmp`;

  mkdirSync(dirname(path), { recursive: true });
  // A leftover temp file of a crashed run may carry another mode: start from a new file.
  rmSync(temporary, { force: true });
  writeFileSync(temporary, `${JSON.stringify(record, undefined, 2)}\n`, {
    mode: FILE_MODE,
    flag: "wx"
  });
  renameSync(temporary, path);
}

/**
 * Writes the discovery file: creates `.moku/` when missing, writes a fresh temp file with mode
 * 0600, then renames it over the old file.
 *
 * @param root - The project root.
 * @param discovery - The record.
 * @returns The path of the written file.
 * @throws {Error} When the folder or the file cannot be written.
 * @example
 * ```ts
 * writeDiscovery(root, discoveryOf(input)); // "<root>/.moku/editor.json"
 * ```
 */
export function writeDiscovery(root: string, discovery: EditorDiscovery): string {
  const path = discoveryPath(root);
  writeRecord(path, discovery);
  return path;
}

/**
 * The pid recorded in the discovery file, or undefined when it is missing or unreadable.
 *
 * @param path - The discovery file.
 * @returns The pid, or undefined.
 * @example
 * ```ts
 * recordedPid(discoveryPath(root)); // 4242
 * ```
 */
function recordedPid(path: string): number | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof parsed !== "object" || parsed === null || !("pid" in parsed)) return undefined;
    return typeof parsed.pid === "number" ? parsed.pid : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Removes a record when this pid wrote it; a file of another process stays.
 *
 * @param path - The absolute file.
 * @param pid - The pid that wrote it.
 * @returns True when the file was removed.
 */
export function removeRecord(path: string, pid: number): boolean {
  if (recordedPid(path) !== pid) return false;

  unlinkSync(path);
  return true;
}

/**
 * Removes the discovery file when this pid wrote it; a file of another bin stays.
 *
 * @param root - The project root.
 * @param pid - The pid that wrote the file.
 * @returns True when the file was removed.
 * @example
 * ```ts
 * removeDiscovery(root, process.pid); // true on the bin's stop
 * ```
 */
export function removeDiscovery(root: string, pid: number): boolean {
  return removeRecord(discoveryPath(root), pid);
}

/**
 * Writes a private record and removes it on release or, failing that, on process exit
 * (synchronous, so it runs in an `exit` listener).
 *
 * @param path - The absolute file.
 * @param record - The record.
 * @param record.pid - The writing process id.
 * @returns The release function: removes the file once (only while it holds this pid) and drops
 * the exit listener.
 * @throws {Error} When the file cannot be written; then no listener is left behind.
 */
export function publishRecord(path: string, record: { readonly pid: number }): () => void {
  writeRecord(path, record);

  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    process.off("exit", release);
    removeRecord(path, record.pid);
  };
  process.once("exit", release);
  return release;
}

/**
 * Writes the discovery file and removes it on release or, failing that, on process exit
 * (synchronous, so it runs in an `exit` listener).
 *
 * @param root - The project root.
 * @param discovery - The record.
 * @returns The release function: removes the file once and drops the exit listener.
 * @throws {Error} When the file cannot be written; then no listener is left behind.
 * @example
 * ```ts
 * const release = publishDiscovery(root, discoveryOf(input));
 * // on stop:
 * release();
 * ```
 */
export function publishDiscovery(root: string, discovery: EditorDiscovery): () => void {
  return publishRecord(discoveryPath(root), discovery);
}
