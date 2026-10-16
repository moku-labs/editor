/**
 * @file perf/protocol — memory trust (spec 03 Delta 2026-10-16 D6): the page's memory as far as the
 * page can tell, and whether to believe it. On the A26 WebView `performance.memory` stayed one value
 * for 30 s while CDP's heap moved, so perf never presents a WebView's heap as the device's.
 * Runtime-free.
 */

/**
 * Equal consecutive heap samples (while the window had awake frames) after which a counter is
 * frozen, not flat.
 */
export const FROZEN_SAMPLES = 20;

/**
 * The page's memory as far as this page can tell, and whether to believe it.
 *
 * @example
 * ```ts
 * const desktop: PerfMemory = { heapMb: 41.9, source: "performance.memory", trusted: true, why: null, processMb: null };
 * const a26: PerfMemory = { heapMb: 10.68, source: "performance.memory", trusted: false, why: "webview", processMb: null };
 * const iphone: PerfMemory = { heapMb: null, source: null, trusted: false, why: "not-measured", processMb: null };
 * ```
 */
export type PerfMemory = {
  readonly heapMb: number | null;
  /**
   * Where the heap number comes from: the engine's `memory.source` when it says (next change, N6:
   * `"uasm"` is `measureUserAgentSpecificMemory`), else `"performance.memory"` for a heap number.
   */
  readonly source: "performance.memory" | "uasm" | "shell" | null;
  /** True only for a heap number this page can stand behind (the D6 rule). */
  readonly trusted: boolean;
  /** Why not trusted: a WebView (frozen on Android), a counter that has not moved for FROZEN_SAMPLES samples, or none. */
  readonly why: "webview" | "frozen" | "not-measured" | null;
  /** The native shell's whole-process memory (ask to `@moku-labs/native`); never shown as heap. null until it exists. */
  readonly processMb: number | null;
};

/**
 * Why the page's heap is not trusted (D6): no heap number → "not-measured" (iOS, WebKit); a WebView
 * → "webview" (frozen on Android, the A26 finding); the same value in FROZEN_SAMPLES consecutive
 * samples → "frozen" (a quantized desktop counter); otherwise null (trusted). Pure.
 *
 * @param heapMb - The newest sample's heapMb.
 * @param webview - `header.device.webview` (non-null on a native WebView).
 * @param sameSamples - Consecutive samples, this one included, with this same heapMb while the
 *   window had awake frames.
 * @returns The reason, or null when the heap is trusted.
 * @example
 * ```ts
 * memoryWhy(41.9, null, 20); // "frozen": twenty samples of one value on a desktop page
 * memoryWhy(10.68, "141", 1); // "webview": never the device's heap
 * ```
 */
export function memoryWhy(
  heapMb: number | null,
  webview: string | null,
  sameSamples: number
): PerfMemory["why"] {
  if (heapMb === null || !Number.isFinite(heapMb)) return "not-measured";
  if (webview !== null) return "webview";
  // eslint-disable-next-line unicorn/no-null -- null is "trusted": no reason to doubt the heap
  return sameSamples >= FROZEN_SAMPLES ? "frozen" : null;
}
