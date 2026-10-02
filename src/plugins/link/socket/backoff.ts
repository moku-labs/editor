/**
 * @file link plugin — reconnect backoff (pure).
 */
import { MAX_RETRY_MS } from "../types";

/**
 * Delay of reconnect attempt n: min(baseMs × 2^n, MAX_RETRY_MS).
 *
 * @param attempt - Zero-based attempt number.
 * @param baseMs - config.retryMs.
 * @returns The delay in ms.
 * @example
 * ```ts
 * backoffDelay(2, 1000); // 4000
 * ```
 */
export function backoffDelay(attempt: number, baseMs: number): number {
  return Math.min(baseMs * 2 ** attempt, MAX_RETRY_MS);
}
