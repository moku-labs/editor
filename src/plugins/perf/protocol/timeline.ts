/**
 * @file perf/protocol — the timeline (spec 03 Delta 2026-10-16 D4): the stream events the tools
 * page's timeline marks (rate chips, GC diamonds, compile marks, problem flags, section switches,
 * recording marks), the wire value of `editor.perf.events`, the editor's runtime-free copies of the
 * engine's shader and problem names, and `timelineEventOf`, the mark of one kept line. Runtime-free.
 */
import type { Json } from "../../registry/protocol";
import type {
  PerfEventLine,
  PerfEventNameNext,
  PerfMarkLine,
  RateMode,
  RateReason
} from "./engine";
import {
  announcedHzOf,
  isGcDetail,
  isPoolTrimDetail,
  isProblemDetail,
  isRateChange,
  isRecorderDetail,
  isSectionsDetail,
  isShaderDetail
} from "./guards";
import type { MonitorSectionName } from "./sections";
import { MONITOR_SECTIONS } from "./sections";

/**
 * What a `shader` event compiled, in 0.15.x (E4): `"compile"` or `"module"`; `"variant"` and
 * `"relink"` arrive with the next change. `engine-contract.test.ts` asserts it equals the engine's
 * `SHADER_WHATS` once the engine exports it.
 */
export const SHADER_WHATS = ["compile", "module"] as const;

/**
 * The problem rules of 0.15.x (N3, engine U5): `filter-still` and `target-churn`; `filter-area`,
 * `late-compile`, `variants`, `pass-budget` and `retakes` come next. `engine-contract.test.ts`
 * asserts it equals the engine's `PROBLEM_RULES` once the engine exports it.
 */
export const PROBLEM_RULES = ["filter-still", "target-churn"] as const;

/**
 * What a shader event compiled: a known value, or a newer engine's word kept as its string.
 *
 * @example
 * ```ts
 * const what: ShaderWhat = "module";
 * const newer: ShaderWhat = "relink"; // a next-change engine: shown by name
 * ```
 */
export type ShaderWhat = (typeof SHADER_WHATS)[number] | (string & {});

/**
 * A problem rule: a known rule, or a newer engine's rule kept as its string.
 *
 * @example
 * ```ts
 * const rule: ProblemRule = "filter-still";
 * ```
 */
export type ProblemRule = (typeof PROBLEM_RULES)[number] | (string & {});

/**
 * The timeline events perf keeps by reference on the agent: the newest 256 (seq % TIMELINE_SLOTS).
 * An `after` older than that answers `lost: true`.
 */
export const TIMELINE_SLOTS = 256;

/**
 * One mark of the timeline, as the tools page draws it. Built only when the events feed is read;
 * `t` is page-clock ms.
 *
 * @example
 * ```ts
 * const drop: PerfTimelineEvent = { seq: 812, kind: "rate", t: 80310.2, frame: 4855, from: 120, to: 60, mode: "auto", reason: "missed", displayHz: 120 };
 * const gc: PerfTimelineEvent = { seq: 790, kind: "gc", t: 79102.0, frame: 4818, freedMb: 4.2, heapMb: 41.9 };
 * ```
 */
export type PerfTimelineEvent =
  | {
      seq: number;
      kind: "rate";
      t: number;
      frame: number | null;
      from: number;
      to: number;
      mode: RateMode;
      reason: RateReason;
      displayHz: number | null;
    }
  | { seq: number; kind: "display"; t: number; frame: number | null; hz: number }
  | {
      seq: number;
      kind: "shader";
      t: number;
      frame: number;
      what: ShaderWhat;
      label: string | null;
      ms: number | null;
      boot: boolean;
      pass: number | null;
      filter: string | null;
      owner: number | null;
      view: string | null;
    }
  | {
      seq: number;
      kind: "gc";
      t: number;
      frame: number | null;
      freedMb: number;
      heapMb: number | null;
    }
  | {
      seq: number;
      kind: "problem";
      t: number;
      frame: number | null;
      rule: ProblemRule;
      severity: "info" | "warn";
      cleared: boolean;
      owner: number | null;
      view: string | null;
      filter: string | null;
      value: number | null;
      threshold: number | null;
      since: number | null;
      frames: number | null;
      /** Why `filter-still` flagged it (engine U5); null for another rule or a clear. */
      reason: "budget" | "not-eligible" | null;
    }
  | {
      seq: number;
      kind: "sections";
      t: number;
      frame: number | null;
      on: MonitorSectionName[];
      off: MonitorSectionName[];
    }
  | {
      seq: number;
      kind: "pool-trim";
      t: number;
      frame: number | null;
      reason: "rest" | "scene" | "pause";
      freedMb: number;
    }
  | {
      seq: number;
      kind: "recorder";
      t: number;
      frame: number | null;
      action: "start" | "stop" | "export";
      by: string | null;
    }
  | { seq: number; kind: "mark"; t: number; frame: number | null; label: string; auto: boolean };

/**
 * The wire value of `editor.perf.events`: the kept events after `after`, oldest first.
 *
 * @example
 * ```ts
 * const wire: PerfEventsWire = { v: 1, epoch: "1792000000000.5", next: 813, lost: false,
 *   items: [{ seq: 812, kind: "rate", t: 80310.2, frame: 4855, from: 120, to: 60, mode: "auto", reason: "missed", displayHz: 120 }] };
 * ```
 */
export type PerfEventsWire = {
  v: 1;
  /** The page's clock origin (header.timeOrigin) as text: a new value means a new page (reload), the history restarts. */
  epoch: string | null;
  /** seq of the next event perf will keep: pass it as `after` next time. */
  next: number;
  /** True when events after `after` were overwritten before this read (more than TIMELINE_SLOTS since). */
  lost: boolean;
  items: PerfTimelineEvent[];
};

/**
 * An event line as the timeline reads it: the engine's `PerfEventLine` with the names of the 0.15.x
 * patch and the next change (`shader`, `problem`, `gc`, `sections`, `debug`), which the installed
 * engine's type does not list yet. Every `PerfEventLine` is one.
 *
 * @example
 * ```ts
 * const compiled: TimelineEventLine = { v: 1, kind: "event", t: 1792000080310.7, build: null, frame: 4851, name: "shader",
 *   detail: { what: "compile", label: "fog.blur", ms: 38.2, frame: 4851, boot: false, during: { pass: 2, filter: "fog.blur", owner: 412, view: "fogLayer" } } };
 * ```
 */
export type TimelineEventLine = Omit<PerfEventLine, "name"> & { readonly name: PerfEventNameNext };

/** The fields every timeline event starts with. */
type EventHead = { readonly seq: number; readonly t: number; readonly frame: number | null };

/** Builds the event of one kept line name from its line and head; undefined for a malformed detail. */
type EventBuilder = (line: TimelineEventLine, head: EventHead) => PerfTimelineEvent | undefined;

/** Page-clock rounding: `t` to tenths of a ms, a compile's ms to hundredths (the wire's rule). */
const TIME_SCALE = 10;
const MS_SCALE = 100;

/**
 * A number rounded to `scale` steps.
 *
 * @param value - The number.
 * @param scale - Steps per unit (10: 0.1).
 * @returns The rounded number.
 * @example
 * ```ts
 * roundTo(80_310.200_195, 10); // 80310.2
 * ```
 */
function roundTo(value: number, scale: number): number {
  return Math.round(value * scale) / scale;
}

/**
 * The section names of a list the editor knows, in the list's order: a newer engine's section is
 * left out (its switch still shows by the known names).
 *
 * @param names - The names of a `sections` line.
 * @returns The known names.
 * @example
 * ```ts
 * knownSections(["passes", "warp"]); // ["passes"]
 * ```
 */
function knownSections(names: readonly string[]): MonitorSectionName[] {
  const known: readonly string[] = MONITOR_SECTIONS;
  return names.filter((name): name is MonitorSectionName => known.includes(name));
}

/**
 * The shader event of an old engine's `compile { frame, count }` line (before the 0.15.x patch):
 * `what: "compile"`, no label, no ms, not at boot, no pass.
 *
 * @param line - The line.
 * @param head - seq, t, frame.
 * @returns The event; undefined without a frame.
 * @example
 * ```ts
 * oldCompile(line, { seq: 3, t: 80310.2, frame: 4851 }).ms; // null
 * ```
 */
function oldCompile(line: TimelineEventLine, head: EventHead): PerfTimelineEvent | undefined {
  const detailFrame: Json | undefined = line.detail.frame;
  const frame = head.frame ?? (typeof detailFrame === "number" ? detailFrame : Number.NaN);
  if (!Number.isFinite(frame)) return undefined;
  // eslint-disable-next-line unicorn/no-null -- null is "not sent": an engine before the patch
  const none = null;
  return {
    ...head,
    kind: "shader",
    frame,
    what: "compile",
    label: none,
    ms: none,
    boot: false,
    pass: none,
    filter: none,
    owner: none,
    view: none
  };
}

/**
 * The problem event of a `problem` line: a flag with its numbers and reason, or a clear of the rule
 * for one owner and view (severity "info", every number null).
 *
 * @param line - The line.
 * @param head - seq, t, frame.
 * @returns The event; undefined for a malformed detail.
 * @example
 * ```ts
 * problemEvent(cleared, head).cleared; // true
 * ```
 */
function problemEvent(line: TimelineEventLine, head: EventHead): PerfTimelineEvent | undefined {
  const { detail } = line;
  if (!isProblemDetail(detail)) return undefined;
  // eslint-disable-next-line unicorn/no-null -- null is "not part of a clear"
  const none = null;
  const { rule, owner, view } = detail;
  if ("cleared" in detail) {
    return {
      ...head,
      kind: "problem",
      rule,
      severity: "info",
      cleared: true,
      owner,
      view,
      filter: none,
      value: none,
      threshold: none,
      since: none,
      frames: none,
      reason: none
    };
  }
  const { severity, filter, value, threshold, since, frames, reason } = detail;
  return {
    ...head,
    kind: "problem",
    rule,
    severity,
    cleared: false,
    owner,
    view,
    filter,
    value,
    threshold,
    since,
    frames,
    reason: reason ?? none
  };
}

/**
 * The recorder event of a `recorder` line: its action and who started it (null from a recorder
 * before the origin, and for a stop or an export).
 *
 * @param line - The line.
 * @param head - seq, t, frame.
 * @returns The event; undefined for another action.
 * @example
 * ```ts
 * recorderEvent(started, head); // { ...head, kind: "recorder", action: "start", by: "agent" }
 * ```
 */
function recorderEvent(line: TimelineEventLine, head: EventHead): PerfTimelineEvent | undefined {
  const { detail } = line;
  if (!isRecorderDetail(detail)) return undefined;
  // eslint-disable-next-line unicorn/no-null -- null is "the recorder did not say who"
  const by = detail.by ?? null;
  return { ...head, kind: "recorder", action: detail.action, by };
}

/** The event builders of the line names the timeline marks (D4); other names have none. */
const BUILDERS: Readonly<Partial<Record<PerfEventNameNext, EventBuilder>>> = {
  rate: ({ detail }, head) => {
    if (!isRateChange(detail)) return;
    const { from, to, mode, reason, displayHz } = detail;
    return { ...head, kind: "rate", from, to, mode, reason, displayHz };
  },
  display: ({ detail }, head) => {
    const hz = announcedHzOf(detail);
    return hz === null ? undefined : { ...head, kind: "display", hz };
  },
  shader: ({ detail }, head) => {
    if (!isShaderDetail(detail)) return;
    const { what, label, ms, frame, boot, during } = detail;
    const { pass, filter, owner, view } = during;
    const time = roundTo(ms, MS_SCALE);
    return {
      ...head,
      kind: "shader",
      frame,
      what,
      label,
      ms: time,
      boot,
      pass,
      filter,
      owner,
      view
    };
  },
  compile: oldCompile,
  gc: ({ detail }, head) =>
    isGcDetail(detail)
      ? { ...head, kind: "gc", freedMb: detail.freedMb, heapMb: detail.heapMb }
      : undefined,
  problem: problemEvent,
  sections: ({ detail }, head) =>
    isSectionsDetail(detail)
      ? { ...head, kind: "sections", on: knownSections(detail.on), off: knownSections(detail.off) }
      : undefined,
  "pool-trim": ({ detail }, head) =>
    isPoolTrimDetail(detail)
      ? { ...head, kind: "pool-trim", reason: detail.reason, freedMb: detail.freedMb }
      : undefined,
  recorder: recorderEvent
};

/**
 * The timeline event of one kept line (D4), on the page clock of the frames (`t − timeOrigin`,
 * rounded to 0.1 ms). Each detail is read with its guard; a malformed detail answers undefined,
 * never a throw. An unknown problem rule or shader `what` of a newer engine is kept as its string.
 * An old engine's `compile { frame, count }` answers a compile with `ms` null (the agent keeps it
 * only while no `shader` line was seen). Names the timeline does not mark (`devtools`, `command`,
 * `overlay`, `scene`, `warm`…) answer undefined. Allocates the event.
 *
 * @param line - The kept event or mark line.
 * @param seq - Its position in the agent's timeline ring.
 * @param timeOrigin - header.timeOrigin: line `t` is epoch ms, the timeline's page-clock ms.
 * @returns The event, or undefined.
 * @example
 * ```ts
 * timelineEventOf(markLine("boss fight"), 8, header.timeOrigin);
 * // { seq: 8, kind: "mark", t: 42000, frame: null, label: "boss fight", auto: false }
 * ```
 */
export function timelineEventOf(
  line: TimelineEventLine | PerfMarkLine,
  seq: number,
  timeOrigin: number
): PerfTimelineEvent | undefined {
  const t = roundTo(line.t - timeOrigin, TIME_SCALE);
  if (line.kind === "mark") {
    const { label, auto } = line;
    if (typeof label !== "string") return undefined;
    // eslint-disable-next-line unicorn/no-null -- null: a mark is written between frames
    return { seq, kind: "mark", t, frame: null, label, auto: auto === true };
  }
  const build = BUILDERS[line.name];
  return build?.(line, { seq, t, frame: line.frame });
}
