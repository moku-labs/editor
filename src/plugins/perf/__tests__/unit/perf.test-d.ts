import { expectTypeOf } from "vitest";
import type { createApp } from "../../../../agent";
import type { Json } from "../../../registry/protocol";
import type { GraphContext2D } from "../../graph";
import type {
  MonitorLike,
  PerfFrameEvent,
  PerfRenderStats,
  PerfSecond,
  PerfWindow,
  PerfWindowView,
  PerfWindowWire
} from "../../protocol";

// ─────────────────────────────────────────────────────────────────────────────
// Type level: the visitor's read-only window, the frozen second, the wire and
// the closed event union. Checked by tsc (the file is not run).
// ─────────────────────────────────────────────────────────────────────────────

/** The agent app, with perf among its default plugins. */
declare const app: ReturnType<typeof createApp>;

app.perf.readWindow(window => {
  expectTypeOf(window).toEqualTypeOf<PerfWindowView>();
  // @ts-expect-error — a visitor cannot write a row of perf's live window
  window.ms[0] = 1;
  // @ts-expect-error — nor a budget
  window.budgetMs[0] = 8.3;
  // @ts-expect-error — nor a scalar
  window.count = 0;
  // @ts-expect-error — nor replace a column
  window.ms = new Float32Array(1);
});

// The tools strip passes its own window to paintGraph and the readers.
expectTypeOf<PerfWindow>().toExtend<PerfWindowView>();

// No window escapes: readWindow answers nothing.
expectTypeOf(app.perf.readWindow).returns.toEqualTypeOf<void>();

/**
 * A reader of `second()` cannot write it.
 *
 * @param second - A second value.
 */
export function cannotWrite(second: PerfSecond): void {
  // @ts-expect-error — fps is read-only
  second.fps.loop = 0;
  expectTypeOf<PerfSecond["render"]>().toEqualTypeOf<PerfRenderStats | null>();
}

// The wire value is Json; a browser's 2D context is a GraphContext2D.
expectTypeOf<PerfWindowWire>().toExtend<Json>();
expectTypeOf<CanvasRenderingContext2D>().toExtend<GraphContext2D>();

/**
 * The monitor's event names are a closed union, with the editor's and the 3B/4 names in it.
 *
 * @param monitor - A monitor.
 */
export function eventNames(monitor: MonitorLike): void {
  // @ts-expect-error — "scenes" is not an event name
  monitor.event("scenes");
  monitor.event("devtools", { mode: "card", tab: "frames" });
  monitor.event("pool-trim", { reason: "rest", freedMb: 41.5 });
  monitor.event("warm", { draws: 12 });
}

/**
 * A frame event narrows on kind: only an overlay has a label.
 *
 * @param event - A frame event.
 * @returns The label of an overlay.
 */
export function labelOf(event: PerfFrameEvent): string {
  // @ts-expect-error — a pool-trim or warm event has no label
  expectTypeOf(event.label).toBeString();
  return event.kind === "overlay" ? event.label : "";
}
