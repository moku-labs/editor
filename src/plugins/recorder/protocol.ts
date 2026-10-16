/**
 * @file recorder plugin — the wire shape of the `editor.recorder` source (and the payload of the
 * per-plugin event `recorder:status` it extends), who started a log (spec 05 Delta 2026-10-16 R2),
 * and the marks the source carries (R3). Types only, importing nothing: the tools page reads it with
 * `import type`, so no recorder code enters the tools bundle. `types.ts` re-exports these types
 * unchanged.
 */

/**
 * Who started the current log: the phone's overlay, the tools page, an agent through MCP, a hub that
 * does not say (an older editor server), the game's own code (`recorder.start()` in process), or
 * `autoStart`.
 *
 * @example
 * ```ts
 * const by: RecordStarter = "agent"; // the tools page shows "started by agent"
 * ```
 */
export type RecordStarter = "phone" | "editor" | "agent" | "remote" | "code" | "auto";

/**
 * Who started the current log, and for an agent the MCP client's name the hub stamped (`client`,
 * spec 07 Delta 2026-10-16 B1); `name` is null for every other origin and for an agent that gave
 * no name.
 *
 * @example
 * ```ts
 * const origin: RecordOrigin = { by: "agent", name: "Claude" }; // the tools page shows "started by agent (Claude)"
 * ```
 */
export type RecordOrigin = { readonly by: RecordStarter; readonly name: string | null };

/**
 * The input of the command a mark names: a JSON value, the same shape as registry/protocol's `Json`
 * (this file imports nothing, so it names the shape itself).
 *
 * @example
 * ```ts
 * const input: MarkInput = { on: false };
 * ```
 */
export type MarkInput =
  | null
  | boolean
  | number
  | string
  | MarkInput[]
  | { [key: string]: MarkInput };

/**
 * A mark of the current (or last) log: one the user added, or an automatic one for a game command
 * the overlay ran (then `command` names it).
 *
 * @example
 * ```ts
 * const mark: LogMark = { atMs: 150_000, label: "Glow off", auto: true, command: { id: "garden.glow", input: { on: false } } };
 * ```
 */
export type LogMark = {
  /** ms since the log started. */
  readonly atMs: number;
  readonly label: string;
  readonly auto: boolean;
  readonly command?: { readonly id: string; readonly input: MarkInput };
};

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
 * Everything the Record tab shows: the event's numbers plus the log's name, label, age and who
 * started it.
 *
 * @example
 * ```ts
 * app.recorder.status(); // { state: "recording", lines: 1840, bytes: 412_000, sent: 1790, pending: 50, monitor: true,
 *                        //   file: "perf-20261014-1532-sm-a266b.jsonl", label: "garden, A26", sinceMs: 192_000, storage: "opfs", dropped: 0,
 *                        //   startedBy: { by: "agent", name: "Claude" } }
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
  /** Who started the current log; null while idle. */
  readonly startedBy: RecordOrigin | null;
};

/**
 * The value of the `editor.recorder` source: the status plus the last 32 marks of the current (or
 * last) log, so the tools page's recording popover lists them without a second source.
 *
 * @example
 * ```ts
 * const source: RecorderSource = { state: "recording", lines: 1840, bytes: 412_000, sent: 1790, pending: 50, monitor: true,
 *   file: "perf-20261014-1532-sm-a266b.jsonl", label: "garden, A26", sinceMs: 192_000, storage: "opfs", dropped: 0,
 *   startedBy: { by: "editor", name: null }, marks: [{ atMs: 150_000, label: "boss intro", auto: false }] };
 * ```
 */
export type RecorderSource = RecorderStatus & { readonly marks: readonly LogMark[] };
