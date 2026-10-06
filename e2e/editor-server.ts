/**
 * @file One editor per Playwright worker. The bin hosts one game link, so workers that shared one
 * bin would steal each other's game frame. Each worker copies the prepared tiny game
 * (dist-e2e/game, written once by e2e/global-setup.ts) to its own root, dist-e2e/game-<n>, and
 * serves it with the real bin on its own port, `BASE_PORT + n`. Its stdout and stderr go to
 * dist-e2e/server-<n>.log, which e2e/global-teardown.ts scans for errors.
 *
 * `n` is the worker's parallel index (0 … workers-1): a worker that restarts after a failed test
 * takes the same index, so it reuses the same port and root.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { cp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The editor repository root. */
const REPO = fileURLToPath(new URL("..", import.meta.url));

/** The e2e output folder. */
export const DIST = path.join(REPO, "dist-e2e");

/** The first port; worker n serves on `BASE_PORT + n`. */
export const BASE_PORT = Number(process.env.PORT ?? 4317);

/** How long a bin may take to answer its tools page. */
const START_MS = 60_000;

/** A running editor of one worker. */
export type EditorServer = {
  /** The page origin, `http://127.0.0.1:<port>`. */
  readonly url: string;
  /** The game root the bin serves, absolute, with a trailing slash. */
  readonly root: string;
  /** The server log file, absolute. */
  readonly log: string;
};

/**
 * The game root of a worker.
 *
 * @param index - The worker's parallel index.
 * @returns The absolute root, with a trailing slash.
 * @example
 * ```ts
 * gameRootOf(0); // "/…/editor/dist-e2e/game-0/"
 * ```
 */
export function gameRootOf(index: number): string {
  const root = path.join(DIST, `game-${index}`);
  return `${root}${path.sep}`;
}

/**
 * Waits until the tools page answers 200.
 *
 * @param url - The tools page URL.
 * @param child - The bin, so an early exit fails at once.
 */
async function waitReady(url: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + START_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`[e2e] the bin exited with ${child.exitCode}`);
    const ok = await fetch(url).then(
      response => response.ok,
      () => false
    );
    if (ok) return;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`[e2e] the bin did not answer ${url} within ${START_MS} ms`);
}

/**
 * Starts the editor of one worker: a fresh copy of the prepared game and the bin on its port.
 *
 * @param index - The worker's parallel index.
 * @returns The server and its stop.
 * @example
 * ```ts
 * const { server, stop } = await startEditor(0);
 * server.url; // "http://127.0.0.1:4317"
 * await stop();
 * ```
 */
export async function startEditor(
  index: number
): Promise<{ server: EditorServer; stop(): Promise<void> }> {
  const port = BASE_PORT + index;
  const root = gameRootOf(index);
  const url = `http://127.0.0.1:${port}`;
  const log = path.join(DIST, `server-${index}.log`);

  // A fresh root per worker start: the bin's writes (notes, captures, saved sources) stay in it.
  await rm(root, { recursive: true, force: true });
  await cp(path.join(DIST, "game"), root, { recursive: true });

  const out = createWriteStream(log, { flags: "a" });
  const child = spawn(
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- Bun is the project's runtime (CLAUDE.md); a dev machine has it on PATH.
    "bun",
    ["dist/bin.mjs", path.join(root, "web", "editor.html"), "--port", String(port), "--root", root],
    { cwd: REPO, stdio: ["ignore", "pipe", "pipe"] }
  );
  child.stdout?.pipe(out);
  child.stderr?.pipe(out);
  await waitReady(`${url}/__editor/`, child);

  const stop = async (): Promise<void> => {
    if (child.exitCode === null) {
      const exited = new Promise(resolve => child.once("exit", resolve));
      child.kill("SIGINT");
      await exited;
    }
    out.end();
  };
  return { server: { url, root, log }, stop };
}
