/**
 * @file pages/mcp — starts the moku-editor bin when none runs (M3): `moku-editor <html> --port
 * <port> --root <root> [--no-hmr]`, detached, stdout and stderr to `.moku/editor.log`, then waits
 * at most 15 s for its discovery file. Stops only a bin it started: SIGTERM, at most 2 s, then
 * SIGKILL.
 */
import { closeSync, mkdirSync, openSync } from "node:fs";
import { dirname, join } from "node:path/posix";
import type { EditorDiscovery } from "../types";
import { findEditor } from "./discovery";
import type { ChildProcess, SpawnProcess } from "./types";

/**
 * The log file of a bin the bridge started, relative to the root.
 */
export const LOG_FILE = ".moku/editor.log";

/**
 * How long the launcher waits for the discovery file.
 */
const START_WAIT_MS = 15_000;

/**
 * How often the launcher reads the discovery file while it waits.
 */
const POLL_MS = 100;

/**
 * How long a stop waits after SIGTERM before SIGKILL.
 */
const STOP_GRACE_MS = 2000;

/**
 * Owner read and write only, like the discovery file.
 */
const LOG_MODE = 0o600;

/**
 * What the bin is started with: absolute html and root, the port and hot reload.
 */
export type LaunchOptions = {
  readonly html: string;
  readonly port: number;
  readonly root: string;
  readonly hmr: boolean;
};

/**
 * The seams of a launch: spawn, the pid check, the command prefix, the clock and the cancel.
 */
export type LaunchDeps = {
  readonly spawn: SpawnProcess;
  readonly isAlive: (pid: number) => boolean;
  /** The runtime and the bin script, such as `[process.execPath, Bun.main]`. */
  readonly command: readonly string[];
  readonly now: () => number;
  /** Aborted when the bridge shuts down during the wait. */
  readonly signal?: AbortSignal;
  /** The wait for the discovery file (default 15 s). */
  readonly waitMs?: number;
};

/**
 * Waits for a timeout.
 *
 * @param ms - The wait.
 * @returns Resolves after `ms`.
 * @example
 * ```ts
 * await sleep(POLL_MS); // then read the discovery file again
 * ```
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

/**
 * The command line of the bin: the prefix, the html, the port, the root and `--no-hmr` when hot
 * reload is off.
 *
 * @param command - The runtime and the bin script.
 * @param options - The launch options.
 * @returns The words to spawn.
 * @example
 * ```ts
 * launchCommand(["bun", "/pkg/dist/bin.mjs"], { html: "/g/web/index.html", port: 3000, root: "/g", hmr: false });
 * // ["bun", "/pkg/dist/bin.mjs", "/g/web/index.html", "--port", "3000", "--root", "/g", "--no-hmr"]
 * ```
 */
export function launchCommand(command: readonly string[], options: LaunchOptions): string[] {
  const { html, port, root, hmr } = options;
  return [...command, html, "--port", String(port), "--root", root, ...(hmr ? [] : ["--no-hmr"])];
}

/**
 * Stops a child the bridge started: SIGTERM, then SIGKILL when it is still running after the
 * grace period.
 *
 * @param child - The child.
 * @param graceMs - The wait after SIGTERM (default 2 s).
 * @returns Resolves once the child exited (or SIGKILL was sent).
 * @example
 * ```ts
 * await stopChild(owned.child); // the bin removes its discovery file on SIGTERM
 * ```
 */
export async function stopChild(
  child: ChildProcess,
  graceMs: number = STOP_GRACE_MS
): Promise<void> {
  signal(child, "SIGTERM");
  const exited = await Promise.race([
    child.exited.then(() => true),
    sleep(graceMs).then(() => false)
  ]);
  if (!exited) signal(child, "SIGKILL");
}

/**
 * Sends a signal; a child that is already gone is fine.
 *
 * @param child - The child.
 * @param name - The signal.
 */
function signal(child: ChildProcess, name: "SIGTERM" | "SIGKILL"): void {
  try {
    child.kill(name);
  } catch {
    // The child exited already.
  }
}

/**
 * Waits for the discovery file of the started bin: its pid, or a live file written after the
 * spawn. Fails when the child exits first, after the wait, or when the bridge shuts down.
 *
 * @param child - The started bin.
 * @param options - The launch options.
 * @param deps - The launch deps.
 * @param spawnedAt - Epoch ms of the spawn.
 * @returns The live discovery record.
 * @throws {Error} `[moku-editor] …` naming why, with the log file.
 */
async function waitForBin(
  child: ChildProcess,
  options: LaunchOptions,
  deps: LaunchDeps,
  spawnedAt: number
): Promise<EditorDiscovery> {
  let exitCode: number | undefined;
  child.exited.then(code => {
    exitCode = code;
  }, ignore);
  const deadline = spawnedAt + (deps.waitMs ?? START_WAIT_MS);

  for (;;) {
    const { live } = findEditor(options.root, deps.isAlive);
    if (live !== undefined && (live.pid === child.pid || live.startedAt >= spawnedAt)) return live;
    if (exitCode !== undefined) {
      throw new Error(
        `[moku-editor] moku-editor exited with code ${String(exitCode)} before it served.\n  See ${LOG_FILE}.`
      );
    }
    if (deps.signal?.aborted === true || deps.now() > deadline) {
      await stopChild(child);
      const why =
        deps.signal?.aborted === true ? "the bridge is closing" : "it did not start in time";
      throw new Error(`[moku-editor] moku-editor was stopped: ${why}.\n  See ${LOG_FILE}.`);
    }
    await sleep(POLL_MS);
  }
}

/**
 * Ignores a rejection that cannot happen (Bun's `exited` resolves).
 */
function ignore(): void {
  // exited never rejects.
}

/**
 * Starts the bin detached with its output in `.moku/editor.log` and waits for its discovery file.
 *
 * @param options - Absolute html and root, port and hot reload.
 * @param deps - Spawn, pid check, command prefix, clock and cancel.
 * @returns The child (owned by the bridge) and its live discovery record.
 * @throws {Error} `[moku-editor] …` when it exits, does not start in time or the bridge closes.
 * @example
 * ```ts
 * const { child, bin } = await launchEditor(
 *   { html: "/games/merge/web/index.html", port: 3000, root: "/games/merge", hmr: true },
 *   { spawn: spawnDetached, isAlive: isProcessAlive, command: [process.execPath, Bun.main], now: Date.now }
 * );
 * bin.url; // "http://127.0.0.1:3000"
 * ```
 */
export async function launchEditor(
  options: LaunchOptions,
  deps: LaunchDeps
): Promise<{ readonly child: ChildProcess; readonly bin: EditorDiscovery }> {
  const logPath = join(options.root, LOG_FILE);
  mkdirSync(dirname(logPath), { recursive: true });
  const logFd = openSync(logPath, "a", LOG_MODE);
  const spawnedAt = deps.now();
  let child: ChildProcess;
  try {
    child = deps.spawn(launchCommand(deps.command, options), { cwd: options.root, logFd });
  } finally {
    closeSync(logFd);
  }
  child.unref();

  const bin = await waitForBin(child, options, deps, spawnedAt);
  return { child, bin };
}

/**
 * The real spawn: Bun.spawn detached, stdin ignored, stdout and stderr to the log descriptor.
 *
 * @param cmd - The command words.
 * @param options - The working directory and the log descriptor.
 * @param options.cwd - The working directory.
 * @param options.logFd - The log file descriptor.
 * @returns The child.
 * @example
 * ```ts
 * const child = spawnDetached(["bun", "dist/bin.mjs", "web/index.html"], { cwd: root, logFd });
 * ```
 */
export function spawnDetached(
  cmd: readonly string[],
  options: { readonly cwd: string; readonly logFd: number }
): ChildProcess {
  const child = Bun.spawn([...cmd], {
    cwd: options.cwd,
    detached: true,
    stdin: "ignore",
    stdout: options.logFd,
    stderr: options.logFd
  });
  return {
    pid: child.pid,
    exited: child.exited,
    kill: name => child.kill(name),
    unref: () => child.unref()
  };
}
