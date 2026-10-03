/**
 * @file bridge plugin — reconnect backoff with jitter (pure).
 */
import { JITTER, MAX_RETRY_MS } from "../types";

/**
 * round(min(retryMs × 2^attempt, MAX_RETRY_MS) × (1 − JITTER + 2 × JITTER × random())).
 *
 * @param attempt - Consecutive failures so far.
 * @param retryMs - config.retryMs.
 * @param random - Random source in [0, 1).
 * @returns The delay before the next attempt, in whole milliseconds.
 * @example
 * ```ts
 * nextDelay(3, 1000, () => 0.5); // 8000
 * ```
 */
export function nextDelay(attempt: number, retryMs: number, random: () => number): number {
  const base = Math.min(retryMs * 2 ** attempt, MAX_RETRY_MS);
  return Math.round(base * (1 - JITTER + 2 * JITTER * random()));
}
