/**
 * @file pages/mcp — `notifications/progress` while a long tool call waits (moku_wait,
 * moku_series): one report at the start, then one per second until the work settles. Without a
 * `_meta.progressToken` the reporter is a no-op.
 */
import type { ToolCall } from "./types";

/**
 * How often progress is reported while the work runs.
 */
const PROGRESS_EVERY_MS = 1000;

/**
 * Runs the work and reports the elapsed ms against the expected total every second.
 *
 * @param call - The tool call (its progress reporter).
 * @param totalMs - The expected duration.
 * @param now - Epoch ms.
 * @param work - The work.
 * @returns What the work resolves with.
 * @example
 * ```ts
 * const ran = await withProgress(call, frames * everyMs, Date.now, () => hub.request("game", "run", input));
 * ```
 */
export async function withProgress<T>(
  call: ToolCall,
  totalMs: number,
  now: () => number,
  work: () => Promise<T>
): Promise<T> {
  const startedAt = now();
  call.progress(0, totalMs);
  const timer = setInterval(() => {
    call.progress(Math.min(now() - startedAt, totalMs), totalMs);
  }, PROGRESS_EVERY_MS);
  try {
    return await work();
  } finally {
    clearInterval(timer);
  }
}
