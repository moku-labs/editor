/**
 * @file collector plugin — the wired telemetry of a device in its computer log: the log a
 * `connect:telemetry` record goes to (the device's newest live log) and the computer-side
 * `telemetry` line of a record, on that log's page clock, the record's readings verbatim. Pure.
 */
import type { DeviceTelemetry } from "../../connect/protocol";
import type { LogSession, PerfTelemetryLine } from "../types";
import { pageTime } from "./clock";

/** The part of a log the telemetry line reads. */
type LineSource = Pick<LogSession, "offset" | "build" | "model">;

/**
 * The live log a device's telemetry record goes to: its newest by `emittedAt` when two are open
 * (around a rotation), the later one on a tie; undefined when the device has no live log.
 *
 * @param sessions - Every log of this run.
 * @param device - The record's device id.
 * @returns The log, or undefined.
 */
export function telemetryLogOf(
  sessions: Iterable<LogSession>,
  device: string
): LogSession | undefined {
  let newest: LogSession | undefined;
  for (const session of sessions) {
    if (session.state !== "live" || session.device.id !== device) continue;
    if (newest === undefined || session.emittedAt >= newest.emittedAt) newest = session;
  }

  return newest;
}

/**
 * The `telemetry` line of a record in a log: `t` is the record's computer time on the log's page
 * clock (the write moment while the log has no offset yet), `rx` the write moment, `build` and
 * `device` the log's, and `serial`, `wired`, `gpu`, `cpu`, `memory`, `heap` the record's fields
 * verbatim (every reading with its `source`, or its `reason` when it is not available).
 *
 * @param record - connect's record of the tick.
 * @param session - The log: its offset, build and model.
 * @param now - Computer epoch ms of the write.
 * @returns The line.
 * @example
 * ```ts
 * telemetryLineOf(record, { offset: 1000 - 1_791_986_090_000, build: "debug-1", model: "SM-A266B" }, 1_791_986_091_000).t;
 * // 1500 for a record at 1_791_986_090_500
 * ```
 */
export function telemetryLineOf(
  record: DeviceTelemetry,
  session: LineSource,
  now: number
): PerfTelemetryLine {
  const { serial, wired, gpu, cpu, memory, heap } = record;
  return {
    v: 1,
    kind: "telemetry",
    t: session.offset === null ? now : pageTime(session.offset, record.at),
    rx: now,
    build: session.build,
    device: session.model,
    serial,
    wired,
    gpu,
    cpu,
    memory,
    heap
  };
}
