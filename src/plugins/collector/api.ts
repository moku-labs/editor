/**
 * @file collector plugin — the api factory (sessions, mark, adb) and the computer mark the mark
 * route shares: one `mark` line into every live log, on that log's page clock.
 */
import type { PerfMarkLine } from "../perf/protocol";
import { pageTime } from "./session/clock";
import { enqueue } from "./session/writer";
import type {
  AdbLoop,
  AdbStatus,
  CollectorApi,
  CollectorCtx,
  CollectorSessionInfo,
  LogSession
} from "./types";

/** The longest mark label, after trimming. */
export const MAX_LABEL = 200;

/**
 * A mark label trimmed, or undefined when it is not 1–200 characters after trimming.
 *
 * @param label - The label as given.
 * @returns The trimmed label, or undefined.
 * @example
 * ```ts
 * labelOf("  boss \n"); // "boss"
 * ```
 */
export function labelOf(label: unknown): string | undefined {
  if (typeof label !== "string") return undefined;

  const trimmed = label.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_LABEL ? trimmed : undefined;
}

/**
 * Writes a computer mark into every live log: `{ v: 1, kind: "mark", t, build, rx, label, auto:
 * false, from: "computer" }`, `t` on that log's page clock.
 *
 * @param ctx - Domain context of the collector.
 * @param label - 1–200 characters after trimming.
 * @returns How many logs got the mark, once each write is done.
 * @throws {TypeError} For an empty or long label (argument validation).
 */
export async function markLogs(ctx: CollectorCtx, label: string): Promise<number> {
  const text = labelOf(label);
  if (text === undefined) {
    throw new TypeError(
      `[moku-editor] collector.mark: the label must be 1-${MAX_LABEL} characters.\n  Give a short name, for example "boss".`
    );
  }

  const rx = Date.now();
  const live = [...ctx.state.sessions.values()].filter(session => session.state === "live");
  await Promise.all(
    live.map(session => {
      const line: PerfMarkLine & { readonly rx: number; readonly from: "computer" } = {
        v: 1,
        kind: "mark",
        t: pageTime(session.offset, rx),
        build: session.build,
        rx,
        label: text,
        auto: false,
        from: "computer"
      };
      return enqueue(ctx, session, `${JSON.stringify(line)}\n`, 1);
    })
  );

  return live.length;
}

/**
 * A log as the api reports it: a fresh copy.
 *
 * @param session - The log.
 * @returns The copy.
 */
function infoOf(session: LogSession): CollectorSessionInfo {
  const { device, log, file, state, lines, lost, digest, stopTimedOut } = session;
  return { device, log, file, state, lines, lost, last: digest, stopTimedOut };
}

/**
 * What the adb loop sees now: off without a loop, else its state and phones, fresh copies.
 *
 * @param loop - The loop, undefined while device mode is off.
 * @returns The status.
 */
function adbStatusOf(loop: AdbLoop | undefined): AdbStatus {
  if (loop === undefined) return { state: "off", phones: [] };

  const phones = [...loop.phones.values()].map(({ serial, model, reversed }) => ({
    serial,
    model,
    reversed
  }));
  return { state: loop.state, phones };
}

/**
 * collector's api factory (`api: createCollectorApi`).
 *
 * @param ctx - Domain context of the collector.
 * @returns The api.
 */
export function createCollectorApi(ctx: CollectorCtx): CollectorApi {
  return {
    sessions: () => [...ctx.state.sessions.values()].map(session => infoOf(session)),
    mark: label => markLogs(ctx, label),
    adb: () => adbStatusOf(ctx.state.adb)
  };
}
