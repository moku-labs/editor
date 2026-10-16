/**
 * @file perf/protocol — the timeline (spec 03 Delta 2026-10-16 D4): the stream events the tools
 * page's timeline marks (rate chips, GC diamonds, compile marks, problem flags, section switches,
 * recording marks), the wire value of `editor.perf.events`, and the editor's runtime-free copies of
 * the engine's shader and problem names. Runtime-free. `timelineEventOf` is a typed stub until build
 * wave 1 (unit A).
 */
import type { PerfEventLine, PerfMarkLine, RateMode, RateReason } from "./engine";
import type { MonitorSectionName } from "./sections";

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
 * The timeline event of one stream line kept by reference (D4): each detail is read with its guard;
 * a malformed detail answers undefined (never a throw). An unknown rule or `what` of a newer engine
 * is kept as its string. Before any `shader` line, an old `compile { frame, count }` line answers
 * `what: "compile"` with `ms` null.
 *
 * @param _line - The kept event or mark line.
 * @param _seq - Its position in the timeline ring.
 * @returns The event, or undefined for a malformed detail or a name the timeline does not mark.
 * @throws {Error} Until build wave 1: `[moku-editor] perf/protocol.timelineEventOf is not built yet.`
 */
export function timelineEventOf(
  _line: PerfEventLine | PerfMarkLine,
  _seq: number
): PerfTimelineEvent | undefined {
  return notBuilt("timelineEventOf");
}
