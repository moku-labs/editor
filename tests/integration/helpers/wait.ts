/**
 * @file Waits and checks of the root integration wave (plan §2.6): real timers only, so a test
 * waits for a condition with `until`, never with a sleep before an assertion.
 */
import type { Log } from "@moku-labs/common/browser";

/** Poll interval of `until`. */
const POLL_MS = 5;

/** Microtasks `settle` gives up before its one macrotask. */
const SETTLE_MICROTASKS = 40;

/**
 * Polls `check` every 5 ms until it is true.
 *
 * @param check - The condition; may be async (a disk read).
 * @param label - What is awaited, named in the failure.
 * @param ms - The deadline in milliseconds.
 * @returns Resolves once the check passed.
 * @throws {Error} `timed out waiting for <label>` after `ms`.
 */
export async function until(
  check: () => boolean | Promise<boolean>,
  label: string,
  ms = 3000
): Promise<void> {
  const deadline = performance.now() + ms;
  while (!(await check())) {
    if (performance.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await Bun.sleep(POLL_MS);
  }
}

/**
 * Lets queued work run: 40 microtasks, then one `setTimeout(0)`.
 *
 * @returns Resolves after the macrotask.
 */
export async function settle(): Promise<void> {
  for (let tick = 0; tick < SETTLE_MICROTASKS; tick += 1) await Promise.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
}

/** The unhandled rejections seen since `trackUnhandled()`. */
export type UnhandledTracker = {
  /** Every rejection reason, in order. */
  readonly list: unknown[];
  /** Removes the listener. */
  stop(): void;
};

/**
 * Records every unhandled promise rejection of the process until `stop()`.
 *
 * @returns The list and the remover.
 */
export function trackUnhandled(): UnhandledTracker {
  const list: unknown[] = [];
  const onRejection = (reason: unknown): void => {
    list.push(reason);
  };
  process.on("unhandledRejection", onRejection);
  return {
    list,
    stop: () => {
      process.off("unhandledRejection", onRejection);
    }
  };
}

/** Anything with the editor's log api: every app of the three cores, and the game app. */
export type Logged = { readonly log: Log.LogApi };

/**
 * The `error` level entries of the given apps' traces: empty when a scenario is "clean".
 *
 * @param apps - The apps to read.
 * @returns The error entries, app by app.
 */
export function logErrors(...apps: readonly Logged[]): Log.LogEntry[] {
  return apps.flatMap(app => app.log.trace().filter(entry => entry.level === "error"));
}
