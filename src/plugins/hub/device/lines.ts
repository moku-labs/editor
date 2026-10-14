/**
 * @file hub plugin — `perf.lines` of a paired device (C5). The batch is checked
 * (`parsePerfLinesParams`; a malformed one is a strike and gets no ack), de-duplicated by index
 * against the device's record of that log (a resend after a lost ack is skipped, a jump forward is
 * a gap), its items narrowed to PerfLogLine by the shallow `isLineShape` guard (a bad line is
 * dropped and counted, never a strike), handed on as `hub:device { kind: "lines" }` when anything
 * is new, and acknowledged to the phone, always.
 */

import type { PerfLogLine } from "../../perf/protocol";
import type { Notification } from "../../registry/protocol";
import { notification } from "../../registry/protocol";
import type { LinkJson, PerfLinesParams } from "../protocol";
import { parsePerfLinesParams } from "../protocol";
import { sendJson, strike } from "../sockets/send";
import type { AgentConn, DeviceRecord, HubCtx } from "../types";
import { emitDevice, linkedDevice } from "./records";

/**
 * The most device logs one record keeps the next index of; the oldest is dropped.
 */
export const MAX_LOGS = 32;

/**
 * The longest `kind` of a line.
 */
const MAX_KIND = 32;

/**
 * What a batch brought, after duplicates and malformed items.
 */
export type AcceptedLines = {
  /** Lines of the batch the hub had already (a resend after a lost ack). */
  readonly skip: number;
  /** Lines the device lost before it sent them (`from` − the expected index). */
  readonly gap: number;
  /** The kept items, frozen. */
  readonly items: readonly PerfLogLine[];
  /** Items dropped as malformed. */
  readonly rejected: number;
  /** The next index the hub expects of the log (the ack's `next`). */
  readonly next: number;
};

/**
 * The shallow guard of a device log line: a plain object with a finite number `v` and a `kind` of
 * 1–32 characters. It vouches for `v` and `kind` only; a reader switches on `kind` and reads the
 * rest defensively.
 *
 * @param item - One item of a batch.
 * @returns Whether it may be handed on as a PerfLogLine.
 * @example
 * ```ts
 * isLineShape({ v: 1, kind: "sample" }); // true
 * isLineShape({ v: "1", kind: "sample" }); // false
 * ```
 */
export function isLineShape(item: LinkJson): item is LinkJson & PerfLogLine {
  if (typeof item !== "object" || item === null || Array.isArray(item)) return false;

  const { v, kind } = item;
  return (
    typeof v === "number" &&
    Number.isFinite(v) &&
    typeof kind === "string" &&
    kind.length > 0 &&
    kind.length <= MAX_KIND
  );
}

/**
 * Accepts a batch against a device record: skips the lines the hub has already, reports the gap
 * of lines the device lost, keeps the well-formed items (frozen) and counts the rest, then moves the
 * log's next index forward (cumulative, never back) and keeps it as the newest of at most 32 logs.
 *
 * @param record - The device record (its `logs` are updated).
 * @param params - The checked batch.
 * @returns What the batch brought.
 * @example
 * ```ts
 * acceptLines({ logs: new Map([["a.jsonl", 2]]) }, { log: "a.jsonl", from: 0, lines: [{ v: 1, kind: "mark" }, { v: 1, kind: "mark" }, { v: 1, kind: "sample" }] }); // { skip: 2, gap: 0, items: [{ v: 1, kind: "sample" }], rejected: 0, next: 3 }
 * ```
 */
export function acceptLines(
  record: Pick<DeviceRecord, "logs">,
  params: PerfLinesParams
): AcceptedLines {
  const { log, from, lines } = params;
  const known = record.logs.get(log);
  const skip = known === undefined ? 0 : Math.min(Math.max(known - from, 0), lines.length);
  const gap = known === undefined ? 0 : Math.max(0, from - known);

  const items: PerfLogLine[] = [];
  let rejected = 0;
  for (const item of lines.slice(skip)) {
    if (isLineShape(item)) items.push(Object.freeze(item));
    else rejected += 1;
  }

  const next = Math.max(known ?? 0, from + lines.length);
  record.logs.delete(log);
  record.logs.set(log, next);
  const oldest = record.logs.keys().next().value;
  if (record.logs.size > MAX_LOGS && oldest !== undefined) record.logs.delete(oldest);

  return { skip, gap, items, rejected, next };
}

/**
 * One `perf.lines` notification of a paired device: a malformed batch is a strike and gets no ack;
 * a batch with new items or a gap is emitted as `hub:device { kind: "lines" }` with `rx` taken now;
 * every checked batch, all duplicates included, is acknowledged `perf.ack { log, next, n }`.
 *
 * @param ctx - Domain context of the hub.
 * @param conn - The paired device connection.
 * @param id - Its device id.
 * @param note - The notification.
 */
export function onPerfLines(ctx: HubCtx, conn: AgentConn, id: string, note: Notification): void {
  const params = parsePerfLinesParams(note.params);
  const record = ctx.state.devices.get(id);
  if (params === undefined || record === undefined) {
    strike(conn);
    return;
  }

  const rx = Date.now();
  const accepted = acceptLines(record, params);
  const { log, from, lines } = params;
  if (accepted.items.length > 0 || accepted.gap > 0) {
    const { skip, items, gap, rejected } = accepted;
    emitDevice(ctx, {
      kind: "lines",
      device: linkedDevice(ctx.state, record),
      lines: { log, from: from + skip, rx, items, gap, rejected }
    });
  }
  sendJson(conn, notification("editor", "perf.ack", { log, next: accepted.next, n: lines.length }));
}
