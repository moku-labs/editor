/**
 * @file pages perf sub-domain — `moku-editor perf mark "<label>"`: from a second terminal, find the
 * running perf through `.moku/perf.json` and post the label to the collector's mark route with
 * the hub token, so every live log gets the mark.
 */
import { resolve } from "node:path/posix";
import type { BrandConsole } from "@moku-labs/common/cli";
import { cleanText } from "../../perf/protocol";
import { readPerfDiscovery } from "./discovery";
import type { PerfDeps, PerfMarkArgs } from "./types";

/** No live perf run in the cwd. */
const NO_RUN =
  "[moku-editor] No moku-editor perf runs in this folder.\n  Start one with moku-editor perf.";

/** The route refused the token. */
const OTHER_TOKEN =
  "[moku-editor] The running perf has another token.\n  Restart moku-editor perf.";

/** The fix line of a failed request. */
const CHECK_RUN = "  Check that moku-editor perf still runs.";

/** The only host `perf mark` posts to. */
const LOOPBACK = "127.0.0.1";

/** The most characters of a reply body printed. */
const REPLY_MAX = 120;

/**
 * The text of a thrown value.
 *
 * @param error - The thrown value.
 * @returns Its message.
 * @example
 * ```ts
 * messageOf(new Error("Unable to connect")); // "Unable to connect"
 * ```
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The `marked` count of a 200 answer.
 *
 * @param text - The body.
 * @returns The count, or undefined for another body.
 * @example
 * ```ts
 * markedOf('{"marked":2}'); // 2
 * ```
 */
function markedOf(text: string): number | undefined {
  try {
    const body: unknown = JSON.parse(text);
    const marked =
      typeof body === "object" && body !== null && "marked" in body ? body.marked : undefined;
    return typeof marked === "number" ? marked : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The mark route of a run: `<path>/perf/mark` resolved against the loopback origin of its port.
 *
 * @param path - The hub path the discovery record names.
 * @param port - The port of the run.
 * @returns The URL; check it with `isRunOrigin` before posting the token to it.
 * @example
 * ```ts
 * markUrl("/__editor", 47_600).href; // "http://127.0.0.1:47600/__editor/perf/mark"
 * ```
 */
export function markUrl(path: string, port: number): URL {
  return new URL(`${path}/perf/mark`, `http://${LOOPBACK}:${port}`);
}

/**
 * True when a URL stays on the run's own loopback origin: the host and the port both match, so
 * the token is never posted to another host or another port of this computer.
 *
 * @param url - The resolved mark URL.
 * @param port - The port of the run.
 * @returns Whether the URL is the run's origin.
 * @example
 * ```ts
 * isRunOrigin(markUrl("//127.0.0.1", 47_600), 47_600); // false: port 80
 * ```
 */
export function isRunOrigin(url: URL, port: number): boolean {
  return url.origin === `http://${LOOPBACK}:${port}`;
}

/**
 * Adds a mark to every live log of the perf running in the cwd.
 *
 * @param args - The label.
 * @param deps - The process seam (cwd, isAlive, fetch).
 * @param ui - The brand console.
 * @returns 0 when the run answered (also with no live phone), 1 with no run, a refused token, a
 * network error or another answer.
 * @example
 * ```ts
 * await perfMark({ kind: "perf-mark", label: "boss" }, processPerfDeps(), ui); // 0, prints '✓ mark "boss" in 1 log(s)'
 * ```
 */
export async function perfMark(
  args: PerfMarkArgs,
  deps: PerfDeps,
  ui: BrandConsole
): Promise<number> {
  const run = readPerfDiscovery(resolve(deps.cwd()));
  if (run === undefined || !deps.isAlive(run.pid)) {
    ui.error(NO_RUN);
    return 1;
  }

  // The path resolves against the run's loopback origin: a path like "//host" would leave it.
  const url = markUrl(run.path, run.port);
  if (!isRunOrigin(url, run.port)) {
    ui.error(
      `[moku-editor] .moku/perf.json points at ${cleanText(url.host)}, not this run.\n  Delete .moku/perf.json and start moku-editor perf again.`
    );
    return 1;
  }

  let status: number;
  let text: string;
  try {
    const response = await deps.fetch(url.href, {
      method: "POST",
      headers: {
        authorization: `Bearer ${run.token}`,
        "content-type": "text/plain; charset=utf-8"
      },
      body: args.label
    });
    status = response.status;
    text = await response.text();
  } catch (error) {
    ui.error(`[moku-editor] ${messageOf(error)}\n${CHECK_RUN}`);
    return 1;
  }

  if (status === 401) {
    ui.error(OTHER_TOKEN);
    return 1;
  }
  const marked = status === 200 ? markedOf(text) : undefined;
  if (marked === undefined) {
    const reply = cleanText(text.replaceAll(/\s+/g, " ").trim(), REPLY_MAX);
    ui.error(`[moku-editor] perf mark: the running perf answered ${status} ${reply}\n${CHECK_RUN}`);
    return 1;
  }

  if (marked === 0) ui.warn("no phone is live: the mark went into no log");
  else ui.check(true, `mark "${args.label}" in ${marked} log(s)`);
  return 0;
}
