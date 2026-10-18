/**
 * @file perf feeds — the timeline (spec 03 Delta 2026-10-16 D4): the stream lines the tools page's
 * timeline marks, kept by reference in a ring of TIMELINE_SLOTS with a seq (no allocation per
 * line), and `editor.perf.events { after? }`, the lines themselves from a seq on (the tools page
 * turns them into marks: no `timelineEventOf` on the phone).
 */
import type { PerfEventsWire, TimelineEventLine } from "../protocol";
import { announcedHzOf, TIMELINE_SLOTS } from "../protocol";
import type { PerfState, TimelineLine } from "../types";
import { seeCap } from "./caps";
import { epochOf } from "./wire";

/** The event names kept as they come; `display`, `compile` and the capability lines have a rule. */
const KEPT: ReadonlySet<string> = new Set(["rate", "sections", "pool-trim", "recorder"]);

/**
 * Whether the timeline keeps an event line (D4): `rate`, `shader`, `gc`, `problem`, `sections`,
 * `pool-trim`, `recorder`; a `display` whose rate changed; an old engine's `compile` while no
 * `shader` line came. A `shader`, `problem` or `gc` line also proves its capability. The editor's
 * own lines (`devtools`, `command`, `overlay`, …) are not kept.
 *
 * @param state - perf's state.
 * @param line - An event line.
 * @returns Whether it is kept.
 */
function keeps(state: PerfState, line: TimelineEventLine): boolean {
  switch (line.name) {
    case "display": {
      const hz = announcedHzOf(line.detail);
      if (hz === null || hz === state.timelineHz) return false;
      state.timelineHz = hz;
      return true;
    }
    case "compile": {
      return !state.shaderSeen;
    }
    case "shader": {
      state.shaderSeen = true;
      seeCap(state, "shaderEvents");
      return true;
    }
    case "problem":
    case "gc": {
      seeCap(state, line.name === "gc" ? "gc" : "problems");
      return true;
    }
    default: {
      return KEPT.has(line.name);
    }
  }
}

/**
 * Keeps a mark line, or an event line the timeline marks, by reference at `timelineSeq %
 * TIMELINE_SLOTS`. Allocation-free.
 *
 * @param state - perf's state.
 * @param line - A mark or event line of the stream.
 */
export function listenTimeline(state: PerfState, line: TimelineLine): void {
  if (line.kind === "event" && !keeps(state, line)) return;
  state.timeline[state.timelineSeq % TIMELINE_SLOTS] = line;
  state.timelineSeq += 1;
}

/**
 * `editor.perf.events { after? }` (D4; owner 2026-10-16: the tools page builds the marks with
 * `eventsOf`): the kept lines with a seq of `after` or later (`after` is the `next` of the previous
 * answer), oldest first, each with its seq and by reference (the wire value copies them), and the
 * page's `timeOrigin`; `lost` when lines after `after` were overwritten (more than TIMELINE_SLOTS
 * since) or `after` is past them (a reload or a restart: all kept lines are answered). Without
 * `after`: every kept line. Allocates its answer.
 *
 * @param state - perf's state.
 * @param after - The seq the reader waits for.
 * @returns The wire.
 */
export function eventsWireOf(state: PerfState, after?: number): PerfEventsWire {
  const next = state.timelineSeq;
  const oldest = Math.max(0, next - TIMELINE_SLOTS);
  const unknown = after === undefined || after > next;
  const from = unknown ? oldest : Math.max(Math.ceil(after), oldest);
  const items: PerfEventsWire["items"] = [];
  for (let seq = from; seq < next; seq += 1) {
    const line = state.timeline[seq % TIMELINE_SLOTS];
    if (line !== undefined) items.push({ seq, line });
  }
  const lost = after !== undefined && (after > next || after < oldest);
  // eslint-disable-next-line unicorn/no-null -- null is "no header yet"
  const timeOrigin = state.header?.timeOrigin ?? null;
  return { v: 1, epoch: epochOf(state), timeOrigin, next, lost, items };
}
