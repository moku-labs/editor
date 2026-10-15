/**
 * @file recorder plugin — the wire shape of the `editor.recorder` source (and the payload of the
 * per-plugin event `recorder:status` it extends). Types only, importing nothing: the tools page
 * reads it with `import type`, so no recorder code enters the tools bundle. `types.ts` re-exports
 * both types unchanged.
 */

/**
 * The payload of the recorder's per-plugin event `recorder:status` (registered in
 * `recorder/index.ts`): the state of the log and of the outbox. Emitted on start, stop, share and
 * remove, and after a flush that changed a number (at most once per flushEveryMs).
 *
 * @example
 * ```ts
 * ctx.emit("recorder:status", { state: "recording", lines: 1840, bytes: 412_000, sent: 1790, pending: 50 });
 * ```
 */
export type RecorderStatusEvent = {
  readonly state: "idle" | "recording" | "exporting";
  /** Lines of the current log (the last one while idle; 0 before any). */
  readonly lines: number;
  readonly bytes: number;
  /** Lines the computer confirmed since the recorder started. */
  readonly sent: number;
  /** Lines in the outbox, waiting for the computer. */
  readonly pending: number;
};

/**
 * Everything the Record tab shows: the event's numbers plus the log's name, label and age.
 *
 * @example
 * ```ts
 * app.recorder.status(); // { state: "recording", lines: 1840, bytes: 412_000, sent: 1790, pending: 50, monitor: true,
 *                        //   file: "perf-20261014-1532-sm-a266b.jsonl", label: "garden, A26", sinceMs: 192_000, storage: "opfs", dropped: 0 }
 * ```
 */
export type RecorderStatus = RecorderStatusEvent & {
  /** perf found a monitor: recording is possible. */
  readonly monitor: boolean;
  /** The current log's name (the last one while idle; null before any). */
  readonly file: string | null;
  readonly label: string | null;
  /** ms since the current log started; 0 while idle. */
  readonly sinceMs: number;
  readonly storage: "opfs" | "memory";
  /** Lines dropped since start: the queue overflowed or the outbox passed keepMb. */
  readonly dropped: number;
};
