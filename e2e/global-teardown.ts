/**
 * @file The server side of the error capture: after the run, scans the bin's stdout and stderr
 * (dist-e2e/server.log, written by the webServer command) for error-level lines and fails the run
 * on any. A tools page that looks fine while the server logs an error is a defect.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LOG = path.join(fileURLToPath(new URL("..", import.meta.url)), "dist-e2e", "server.log");

/** A line the bin, Bun or the editor plugins print on an error or a warning. */
const ERROR_LINE = /\b(error|exception|unhandled|panic|warn(ing)?|fail(ed|ure)?)\b|✗/i;

/**
 * Fails when the server log holds an error-level line.
 */
export default function globalTeardown(): void {
  if (process.env.PW_EXTERNAL_SERVER || !existsSync(LOG)) return;
  const bad = readFileSync(LOG, "utf8")
    .split("\n")
    .filter(line => ERROR_LINE.test(line));
  if (bad.length > 0) {
    throw new Error(`The e2e server logged ${bad.length} error lines:\n${bad.join("\n")}`);
  }
}
