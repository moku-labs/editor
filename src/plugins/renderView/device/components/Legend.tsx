/**
 * @file renderView device strip — the legend row under the graph: the frame stack swatches (JS,
 * GPU, idle), every cause legend with its key (from `CAUSE_STYLE`: the strip keeps no copy), the
 * skipped caret and the budget bug with the newest frame's own budget and its rate. The swatches,
 * the cause keys and the bug take the graph's colours in both editor themes (`../colour`).
 */
import type { VNode } from "preact";
import type { PerfCause } from "../../../perf/protocol";
import { rateFps } from "../../../perf/protocol";
import { themedColour, themedHue } from "../colour";
import type { PerfWindowView } from "../contract";
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
export type LegendProps = { readonly window: PerfWindowView };

/**
 * The budget text of the newest frame: "budget 8.3 ms at 120 fps", "budget 16.7 ms" before a
 * window.
 *
 * @param window - The strip's window.
 * @returns The text.
 * @example
 * ```ts
 * budgetText(window); // "budget 8.3 ms at 120 fps"
 * ```
 */
export function budgetText(window: PerfWindowView): string {
  if (window.count === 0) return "budget 16.7 ms";
  const newest = window.count - 1;
  const fps = rateFps(window.rateMs[newest] ?? 0);
  const budget = `budget ${(window.budgetMs[newest] ?? 0).toFixed(1)} ms`;
  return fps === 0 ? budget : `${budget} at ${fps} fps`;
}

/**
 * The legend row.
 *
 * @param props - The strip's window.
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
        {budgetText(props.window)}
      </span>
    </div>
  );
}
