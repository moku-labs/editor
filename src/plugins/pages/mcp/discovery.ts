/**
 * @file pages/mcp — reads `<root>/.moku/editor.json` (M3): the running bin's port, websocket URL
 * and token. A file whose pid is dead is stale: no bin runs, but its html and port still feed the
 * launcher. A file that names another root is ignored (F185). The token is never printed or logged.
 */
import { readFileSync, realpathSync } from "node:fs";
import type { Json } from "../../registry/protocol";
import { discoveryPath } from "../discovery";
import type { EditorDiscovery } from "../types";
import { isObject } from "./rpc";

/**
 * What the discovery file says: a live bin, or the record of one that is gone.
 */
export type FoundEditor = {
  /** The record when its pid runs. */
  readonly live?: EditorDiscovery;
  /** The record whatever its pid: the last bin seen under the root. */
  readonly seen?: EditorDiscovery;
};

/**
 * Parses the file text; JSON.parse answers only JSON values.
 *
 * @param text - The file text.
 * @returns The value, or undefined when it is not JSON.
 * @example
 * ```ts
 * parseText("{}"); // {}
 * ```
 */
function parseText(text: string): Json | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Checks a parsed discovery record: version 1 and every field of its type.
 *
 * @param value - The parsed file.
 * @returns A fresh record, or undefined for any other shape.
 * @example
 * ```ts
 * readDiscovery({ version: 2 }); // undefined
 * ```
 */
export function readDiscovery(value: Json | undefined): EditorDiscovery | undefined {
  if (!isObject(value) || value.version !== 1) return undefined;
  const { pid, port, url, ws, token, root, html, startedAt } = value;
  const numbersOk =
    typeof pid === "number" && typeof port === "number" && typeof startedAt === "number";
  const textsOk =
    typeof url === "string" &&
    typeof ws === "string" &&
    typeof token === "string" &&
    typeof root === "string" &&
    typeof html === "string";
  if (!numbersOk || !textsOk || token === "") return undefined;
  return { version: 1, pid, port, url, ws, token, root, html, startedAt };
}

/**
 * True while a process with this pid exists (`process.kill(pid, 0)`; EPERM means it exists but
 * belongs to another user).
 *
 * @param pid - The pid.
 * @returns Whether it runs.
 * @example
 * ```ts
 * isProcessAlive(process.pid); // true
 * ```
 */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

/**
 * A path with its symlinks resolved (macOS `/var` is `/private/var`), or the path as given when it
 * does not exist.
 *
 * @param path - An absolute path.
 * @returns The real path.
 * @example
 * ```ts
 * realOf("/var/folders/x"); // "/private/var/folders/x" on macOS
 * ```
 */
function realOf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * Whether a record was written by a bin of this root (F185): a `.moku/` copied from another
 * checkout names that checkout, and its editor is never used.
 *
 * @param record - The record read under the root.
 * @param root - The absolute project root.
 * @returns True when the record's root is this root.
 * @example
 * ```ts
 * isOfRoot({ ...record, root: "/games/merge" }, "/games/merge"); // true
 * isOfRoot({ ...record, root: "/games/merge/.claude/worktrees/a" }, "/games/merge"); // false
 * ```
 */
function isOfRoot(record: EditorDiscovery, root: string): boolean {
  return record.root === root || realOf(record.root) === realOf(root);
}

/**
 * Reads the discovery file under a root. A record of another root (a copied `.moku/`) counts as
 * no file (F185).
 *
 * @param root - The absolute project root.
 * @param isAlive - Tells a running pid (default `isProcessAlive`).
 * @returns The live record and the last seen record; both absent without a valid file of this root.
 * @example
 * ```ts
 * const { live, seen } = findEditor("/games/merge");
 * live?.port; // 3000 while the bin runs
 * seen?.html; // the game HTML of the last bin, also after a crash
 * ```
 */
export function findEditor(
  root: string,
  isAlive: (pid: number) => boolean = isProcessAlive
): FoundEditor {
  let text: string;
  try {
    text = readFileSync(discoveryPath(root), "utf8");
  } catch {
    return {};
  }

  const seen = readDiscovery(parseText(text));
  if (seen === undefined || !isOfRoot(seen, root)) return {};
  return isAlive(seen.pid) ? { live: seen, seen } : { seen };
}
