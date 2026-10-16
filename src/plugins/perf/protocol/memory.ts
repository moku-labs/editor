/**
 * @file perf/protocol — memory trust (spec 03 Delta 2026-10-16 D6): the page's memory as far as the
 * page can tell, and whether to believe it. On the A26 WebView `performance.memory` stayed one value
 * for 30 s while CDP's heap moved, so perf never presents a WebView's heap as the device's.
 * Runtime-free. `memoryWhy` is a typed stub until build wave 1 (unit A).
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
  readonly source: "performance.memory" | "shell" | null;
  /** True only for a heap number this page can stand behind (the D6 rule). */
  readonly trusted: boolean;
  /** Why not trusted: a WebView (frozen on Android), a counter that has not moved for FROZEN_SAMPLES samples, or none. */
  readonly why: "webview" | "frozen" | "not-measured" | null;
  /** The native shell's whole-process memory (ask to `@moku-labs/native`); never shown as heap. null until it exists. */
  readonly processMb: number | null;
};

/**
 * Throws the "not built" error of a stubbed function: build wave 1 (unit A) replaces each stub.
 *
 * @param name - The function.
 * @throws {Error} `[moku-editor] perf/protocol.<name> is not built yet.\n  It lands in build wave 1.`
 */
function notBuilt(name: string): never {
  throw new Error(
    `[moku-editor] perf/protocol.${name} is not built yet.\n  It lands in build wave 1.`
  );
}

/**
 * Why the page's heap is not trusted (D6): no heap → "not-measured"; a WebView → "webview"; the same
 * value in FROZEN_SAMPLES consecutive samples → "frozen"; otherwise null (trusted).
 *
 * @param _heapMb - The newest sample's heapMb.
 * @param _webview - `header.device.webview` (non-null on a native WebView).
 * @param _sameSamples - Consecutive samples with this same heapMb while the window had awake frames.
 * @returns The reason, or null when the heap is trusted.
 * @throws {Error} Until build wave 1: `[moku-editor] perf/protocol.memoryWhy is not built yet.`
 */
export function memoryWhy(
  _heapMb: number | null,
  _webview: string | null,
  _sameSamples: number
): PerfMemory["why"] {
  return notBuilt("memoryWhy");
}
