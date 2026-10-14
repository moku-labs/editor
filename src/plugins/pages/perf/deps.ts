/**
 * @file pages perf sub-domain — the real process behind `PerfDeps`: the cwd, the pid, a pid check,
 * the one terminal question of the pairing prompt, file reads, fetch, and the game's app id from
 * `<root>/config.ts`.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path/posix";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import type { PerfDeps } from "./types";

/**
 * Whether a process id is alive: signal 0 reaches it, or it belongs to another user (EPERM).
 *
 * @param pid - The process id.
 * @returns True while it runs.
 * @example
 * ```ts
 * isProcessAlive(process.pid); // true
 * ```
 */
function isProcessAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

/**
 * Asks one question on the terminal and resolves with the typed line; rejects when the signal
 * aborts (the phone left, the wait ran out, device mode stopped).
 *
 * @param question - The question.
 * @param signal - Aborts the question.
 * @returns The typed line.
 */
async function ask(question: string, signal: AbortSignal): Promise<string> {
  // node:readline: the pairing-code prompt
  // (decisions.md "Pairing code prompt uses node:readline behind one ask seam");
  // @moku-labs/common/cli 0.3.10 has no text prompt.
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  // readline only pauses on a Ctrl+C typed during the question: hand it to the bin's handler.
  terminal.on("SIGINT", () => {
    process.kill(process.pid, "SIGINT");
  });
  try {
    return await terminal.question(question, { signal });
  } finally {
    terminal.close();
  }
}

/**
 * A field of an object, or undefined.
 *
 * @param value - Any value.
 * @param key - The field name.
 * @returns The field, or undefined when value is no object or has no such field.
 * @example
 * ```ts
 * fieldOf({ native: { identifier: "com.example.garden" } }, "native"); // { identifier: "com.example.garden" }
 * ```
 */
function fieldOf(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;

  const fields: Readonly<Record<string, unknown>> = { ...value };
  return fields[key];
}

/**
 * The game's base Android identifier: `native.identifier` of `<root>/config.ts`'s default
 * export. Any failure (no file, a throw while importing, no identifier) answers undefined.
 *
 * @param root - The game root.
 * @returns The identifier, or undefined.
 */
async function appIdOf(root: string): Promise<string | undefined> {
  const config = join(root, "config.ts");
  if (!existsSync(config)) return undefined;

  try {
    const module: unknown = await import(pathToFileURL(config).href);
    const identifier = fieldOf(fieldOf(fieldOf(module, "default"), "native"), "identifier");
    return typeof identifier === "string" && identifier !== "" ? identifier : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The deps of the real process.
 *
 * @returns The cwd, the pid, the pid check, the terminal question, file reads, fetch and the app id.
 * @example
 * ```ts
 * await startBin(["perf", "--lan"], { ...deps, perf: processPerfDeps() });
 * ```
 */
export function processPerfDeps(): PerfDeps {
  return {
    cwd: () => process.cwd(),
    pid: process.pid,
    isAlive: isProcessAlive,
    ask,
    readText: path => readFile(path, "utf8"),
    fetch: (url, init) => fetch(url, init),
    appIdOf
  };
}
