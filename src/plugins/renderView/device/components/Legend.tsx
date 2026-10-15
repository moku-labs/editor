/**
 * @file renderView device strip — the legend row under the graph: the frame stack swatches (JS,
 * GPU, idle), every cause legend with its key (from `CAUSE_STYLE`: the strip keeps no copy), the
 * skipped caret and the budget bug with the newest frame's own budget and its rate, read from the
 * same value as the headline's rate (`PerfSecond.budgetMs`, `rate.fps`), the window's newest row
 * before the first second. The swatches,
 * the cause keys and the bug take the graph's colours in both editor themes (`../colour`).
 */
import type { VNode } from "preact";
import type { PerfCause } from "../../../perf/protocol";
import { rateFps } from "../../../perf/protocol";
import { themedColour, themedHue } from "../colour";
import type { PerfSecond, PerfWindowView } from "../contract";
import { CAUSE_STYLE } from "../contract";
import { Annunciator } from "./Annunciator";

/**
 * The cause legends in the order of the design's legend row.
 */
const LEGEND_CAUSES: readonly PerfCause[] = [
  "js",
  "gpu",
  "upload",
  "compile",
  "longFrame",
  "gap",
  "gc?"
];

/**
 * Props of `Legend`.
 */
export type LegendProps = {
  readonly window: PerfWindowView;
  /** The newest second: the budget and the rate the headline reads; undefined before one. */
  readonly second: PerfSecond | undefined;
};

/**
 * The budget text of the newest frame: "budget 8.3 ms at 120 fps", from the second the headline's
 * `@120` comes from, else from the window's newest row; "budget 16.7 ms" before either.
 *
 * @param window - The strip's window.
 * @param second - The newest second; undefined before one.
 * @returns The text.
 * @example
 * ```ts
 * budgetText(window, second); // "budget 8.3 ms at 120 fps"
 * ```
 */
export function budgetText(window: PerfWindowView, second: PerfSecond | undefined): string {
  if (second !== undefined) return budgetLine(second.budgetMs, second.rate.fps ?? 0);
  if (window.count === 0) return "budget 16.7 ms";
  const newest = window.count - 1;
  return budgetLine(window.budgetMs[newest] ?? 0, rateFps(window.rateMs[newest] ?? 0));
}

/**
 * "budget 8.3 ms at 120 fps", or "budget 16.7 ms" while the rate is unknown.
 *
 * @param budgetMs - The budget, ms.
 * @param fps - The rate; 0 when unknown.
 * @returns The text.
 * @example
 * ```ts
 * budgetLine(16.67, 60); // "budget 16.7 ms at 60 fps"
 * ```
 */
function budgetLine(budgetMs: number, fps: number): string {
  const budget = `budget ${budgetMs.toFixed(1)} ms`;
  return fps === 0 ? budget : `${budget} at ${fps} fps`;
}

/**
 * The legend row.
 *
 * @param props - The strip's window and newest second.
 * @returns The row.
 */
export function Legend(props: LegendProps): VNode {
  return (
    <div data-part="legend">
      <span>
        <i data-swatch="js" style={{ "--c": themedColour("js") }} />
        JS
      </span>
      <span>
        <i data-swatch="gpu" style={{ "--c": themedColour("gpu") }} />
        GPU
      </span>
      <span>
        <i data-swatch="idle" style={{ "--c": themedColour("idle") }} />
        idle
      </span>
      {LEGEND_CAUSES.map(cause => (
        <span key={cause}>
          <Annunciator
            text={CAUSE_STYLE[cause].legend}
            colour={themedHue(cause)}
            hollow={CAUSE_STYLE[cause].hollow}
            lit={!CAUSE_STYLE[cause].hollow}
            size="legend"
          />{" "}
          {CAUSE_STYLE[cause].key}
        </span>
      ))}
      <span data-part="skipped">
        <svg width="10" height="8" viewBox="0 0 10 8" aria-hidden="true">
          <path d="M5 0L10 7H0Z" fill="currentColor" />
        </svg>{" "}
        skipped
      </span>
      <span data-part="budget" style={{ "--c": themedColour("magenta") }}>
        <svg width="12" height="10" viewBox="0 0 12 10" aria-hidden="true">
          <path d="M0 0H12V10H0L5 5Z" fill="currentColor" />
        </svg>{" "}
        {budgetText(props.window, props.second)}
      </span>
    </div>
  );
}
