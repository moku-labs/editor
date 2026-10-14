/**
 * @file pages perf sub-domain — `<root>/.moku/perf.json`: how `perf mark` finds the running perf
 * (its pid, port, path and hub token). Written 0600 through a temp file and a rename, removed on
 * stop and on process exit, only while it holds this pid (the record helpers of `../discovery`).
 * Never `.moku/editor.json`: the MCP bridge must not mistake a perf run for a served game.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path/posix";
import { publishRecord } from "../discovery";
import type { PerfDiscovery } from "./types";

/** The perf discovery file, relative to the root. */
export const PERF_DISCOVERY_FILE = ".moku/perf.json";

/** The highest TCP port. */
const PORT_MAX = 65_535;

/**
 * The shape of the hub path a record may name: `/` then letters, digits and `._~/-`, never `//`
 * first (a protocol-relative path would leave the loopback origin).
 */
const PATH_SHAPE = /^\/(?!\/)[\w.~/-]*$/;

/**
 * The absolute path of the perf discovery file under a root.
 *
 * @param root - The root.
 * @returns `<root>/.moku/perf.json`.
 * @example
 * ```ts
 * perfDiscoveryPath("/game"); // "/game/.moku/perf.json"
 * ```
 */
export function perfDiscoveryPath(root: string): string {
  return join(root, PERF_DISCOVERY_FILE);
}

/**
 * Writes `.moku/perf.json` (version 1) and removes it on release or, failing that, on exit.
 *
 * @param root - The root.
 * @param input - The record without its version.
 * @returns The release function: removes the file once, only while it holds this pid.
 * @throws {Error} When the folder or the file cannot be written.
 * @example
 * ```ts
 * const release = writePerfDiscovery("/game", { pid: 4242, port: 47600, path: "/__editor", token, lan: null, startedAt: Date.now() });
 * release(); // the file is gone
 * ```
 */
export function writePerfDiscovery(
  root: string,
  input: Omit<PerfDiscovery, "version">
): () => void {
  const record: PerfDiscovery = { version: 1, ...input };
  return publishRecord(perfDiscoveryPath(root), record);
}

/**
 * Whether a parsed value is a version 1 perf discovery record: a whole port 1-65535 and a path of
 * `/` with letters, digits and `._~/-` only (a file another process wrote must not steer the
 * request of `perf mark`).
 *
 * @param value - The parsed JSON.
 * @returns True for a complete record.
 * @example
 * ```ts
 * isPerfDiscovery({ version: 1, pid: 1, port: 2, path: "/__editor", token: "t", lan: null, startedAt: 3 }); // true
 * ```
 */
function isPerfDiscovery(value: unknown): value is PerfDiscovery {
  if (typeof value !== "object" || value === null) return false;

  const record: Partial<Record<keyof PerfDiscovery, unknown>> = value;
  const { port, path } = record;
  const isPort =
    typeof port === "number" && Number.isInteger(port) && port >= 1 && port <= PORT_MAX;
  const isPath = typeof path === "string" && PATH_SHAPE.test(path);
  const numbers = typeof record.pid === "number" && typeof record.startedAt === "number";
  const lan = record.lan === null || typeof record.lan === "string";
  return (
    record.version === 1 && isPort && isPath && numbers && typeof record.token === "string" && lan
  );
}

/**
 * Reads `.moku/perf.json` under a root.
 *
 * @param root - The root.
 * @returns The record, or undefined when the file is missing, not JSON or not a v1 record.
 * @example
 * ```ts
 * readPerfDiscovery("/game")?.port; // 47600 while a perf runs there
 * ```
 */
export function readPerfDiscovery(root: string): PerfDiscovery | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(perfDiscoveryPath(root), "utf8"));
    return isPerfDiscovery(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}
