/**
 * @file bridge plugin — reconnect backoff with jitter (pure).
 */

/**
 * round(min(retryMs × 2^attempt, MAX_RETRY_MS) × (1 − JITTER + 2 × JITTER × random())).
 *
 * @param _attempt - Consecutive failures so far.
 * @param _retryMs - config.retryMs.
 * @param _random - Random source in [0, 1).
 * @example
 * ```ts
 * nextDelay(3, 1000, () => 0.5); // 8000
 * ```
 */
export function nextDelay(_attempt: number, _retryMs: number, _random: () => number): number {
  throw new Error("not implemented");
}
