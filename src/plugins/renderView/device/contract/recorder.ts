/**
 * @file renderView device strip — STAND-IN for spec 05 `recorder/types.ts` (`RecorderStatus`), the
 * value of the recorder's `editor.recorder` source. Unit 05 (recorder) is not built yet; when it
 * lands, `contract/index.ts` re-exports its type with `import type` from
 * `../../../recorder/types` and this file is deleted. Types only: no recorder code enters the
 * tools bundle.
 */

/**
 * The value of `editor.recorder` (spec 05 `RecorderStatus`): the log and the outbox.
 *
 * @example
 * ```ts
 * const status: RecorderStatus = { state: "recording", lines: 1840, bytes: 412_000, sent: 1790, pending: 50, monitor: true,
 *   file: "perf-20261014-1532-sm-a266b.jsonl", label: null, sinceMs: 192_000, storage: "opfs", dropped: 0 };
 * ```
 */
export type RecorderStatus = {
  readonly state: "idle" | "recording" | "exporting";
  readonly lines: number;
  readonly bytes: number;
  readonly sent: number;
  readonly pending: number;
  readonly monitor: boolean;
  readonly file: string | null;
  readonly label: string | null;
  /** ms since the current log started; 0 while idle. */
  readonly sinceMs: number;
  readonly storage: "opfs" | "memory";
  readonly dropped: number;
};
