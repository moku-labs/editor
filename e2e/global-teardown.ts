/**
 * @file The server side of the error capture: after the run, scans the bin's stdout and stderr
 * (dist-e2e/server.log, written by the webServer command) for error-level lines and fails the run
 * on any. A tools page that looks fine while the server logs an error is a defect.
 *
 * A spec that provokes server errors on purpose names the byte window of the log it provoked them
 * in, in dist-e2e/server-log-provoked.json (`[{ log, from, to, by }]`): e2e/project-stress.spec.ts
 * breaks and deletes game files, and Bun's dev server logs the bundle errors. Lines in a window
 * are skipped, except a `[moku-editor]` line, which is always an editor error. The file is removed
 * after every run, so a window never applies to the log of another run.
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The e2e output folder. */
const DIST = path.join(fileURLToPath(new URL("..", import.meta.url)), "dist-e2e");

/** The server log of the webServer command. */
const LOG = path.join(DIST, "server.log");

/** The windows of the server logs that specs provoked errors in. */
const PROVOKED = path.join(DIST, "server-log-provoked.json");

/** A line the bin, Bun or the editor plugins print on an error or a warning. */
const ERROR_LINE = /\b(error|exception|unhandled|panic|warn(ing)?|fail(ed|ure)?)\b|✗/i;

/** One provoked window: a byte range of a log. */
type Window = { readonly log: string; readonly from: number; readonly to: number };

/**
 * True for a well-formed window.
 *
 * @param value - One parsed entry.
 * @returns Whether it is a window.
 */
function isWindow(value: unknown): value is Window {
  if (typeof value !== "object" || value === null) return false;
  const { log, from, to } = value as Partial<Record<keyof Window, unknown>>;
  return typeof log === "string" && typeof from === "number" && typeof to === "number";
}

/**
 * Reads and removes the provoked windows of this run.
 *
 * @returns The windows; none when no spec named one or the file does not parse.
 */
function takeWindows(): Window[] {
  if (!existsSync(PROVOKED)) return [];
  try {
    const parsed: unknown = JSON.parse(readFileSync(PROVOKED, "utf8"));
    return Array.isArray(parsed) ? parsed.filter(entry => isWindow(entry)) : [];
  } catch {
    return [];
  } finally {
    rmSync(PROVOKED, { force: true });
  }
}

/**
 * The error-level lines of a log outside the provoked windows; a `[moku-editor]` line counts
 * everywhere.
 *
 * @param text - The log text.
 * @param windows - The provoked windows of this log.
 * @returns The bad lines.
 */
function badLines(text: string, windows: readonly Window[]): string[] {
  const bad: string[] = [];
  let offset = 0;
  for (const line of text.split("\n")) {
    const start = offset;
    offset += Buffer.byteLength(line, "utf8") + 1;
    if (!ERROR_LINE.test(line)) continue;
    const isProvoked = windows.some(window => start >= window.from && start < window.to);
    if (!isProvoked || line.includes("[moku-editor]")) bad.push(line);
  }
  return bad;
}

/**
 * Fails when the server log holds an error-level line.
 */
export default function globalTeardown(): void {
  const windows = takeWindows().filter(window => window.log === LOG);
  if (process.env.PW_EXTERNAL_SERVER || !existsSync(LOG)) return;
  const bad = badLines(readFileSync(LOG, "utf8"), windows);
  if (bad.length > 0) {
    throw new Error(`The e2e server logged ${bad.length} error lines:\n${bad.join("\n")}`);
  }
}
