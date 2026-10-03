/**
 * @file capture plugin — state factory.
 */
import type { CaptureState } from "./types";

/**
 * Creates the initial capture state: no series.
 *
 * @returns A fresh state with no series running.
 * @example
 * ```ts
 * createCaptureState(); // { series: undefined }
 * ```
 */
export function createCaptureState(): CaptureState {
  return { series: undefined };
}
