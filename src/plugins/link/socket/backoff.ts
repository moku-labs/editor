/**
 * @file link plugin — reconnect backoff (pure).
 */

/**
 * Delay of reconnect attempt n: min(baseMs × 2^n, MAX_RETRY_MS).
 *
 * @param _attempt - Zero-based attempt number.
 * @param _baseMs - config.retryMs.
 * @example
 * ```ts
 * backoffDelay(2, 1000); // 4000
 * ```
 */
export function backoffDelay(_attempt: number, _baseMs: number): number {
  throw new Error("not implemented");
}
