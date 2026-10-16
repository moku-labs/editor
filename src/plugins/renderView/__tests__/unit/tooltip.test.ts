/* eslint-disable unicorn/no-null -- null is a JSON value on the wire and the engine's "not reported" */
import { describe, expect, it } from "vitest";
import { tooltipOf } from "../../derive/tooltip";
import { REST } from "../../source/contract";
import { bitsOf, historyOf, line, rowsOf, withEvents } from "../mission-fixtures";

// ─────────────────────────────────────────────────────────────────────────────
// derive/tooltip.ts (spec 09 § M8 Hover tooltip): the frame's numbers and the
// one line that says what it was — resting is not a problem, a spike names its
// cause, a GC its freed MB and pause; GPU reads "off" when the section is off,
// "not measured" without a timer, and carries the clock on a wired phone.
// ─────────────────────────────────────────────────────────────────────────────

const ON = { gpu: "on", passes: true, gpuMhz: null, gcShown: true } as const;

/**
 * The tooltip's rows as label → value.
 *
 * @param view - The tooltip.
 * @returns The rows.
 */
function rowsOfTip(view: ReturnType<typeof tooltipOf>): Record<string, string> {
  return Object.fromEntries((view?.rows ?? []).map(row => [row.label, row.value]));
}

describe("the hover tooltip", () => {
  it("says a resting frame is not a problem, whatever its length", () => {
    const history = historyOf(
      rowsOf(4800, 3, {
        each: () => ({ rest: REST.idle, ms: 33.3, budgetMs: 33.33, rateMs: 33.33 })
      })
    );
    expect(tooltipOf(history, 4801, ON)?.line).toBe("Resting at 30 fps, not a problem");
  });

  it("names a spike's cause and how far it went over its budget", () => {
    const history = historyOf(
      rowsOf(4800, 3, {
        each: index => (index === 1 ? { ms: 22.4, jsMs: 19.6, causes: bitsOf("js") } : {})
      })
    );
    const view = tooltipOf(history, 4801, ON);
    expect(view?.frame).toBe("f4801");
    expect(view?.ms).toBe("22.4 ms");
    expect(view?.line).toBe("JS over budget, 5.7 ms over budget");
  });

  it("names a GC with its freed MB and the pause left in the frame", () => {
    const history = withEvents(
      historyOf(
        rowsOf(4800, 3, { each: index => (index === 1 ? { ms: 15, jsMs: 6, gpuMs: 3 } : {}) })
      ),
      [line.gc(10_017, 4801, 4.2)]
    );
    const view = tooltipOf(history, 4801, ON);
    expect(view?.line).toBe("GC freed 4.2 MB, pause 6 ms");
    expect(rowsOfTip(view)["GC pause"]).toBe("6");
  });

  it("reads GPU 'off' with the section off and 'not measured' without a timer, never 0", () => {
    const history = historyOf(rowsOf(4800, 2));
    expect(rowsOfTip(tooltipOf(history, 4800, { ...ON, gpu: "off" })).GPU).toBe("off");
    expect(rowsOfTip(tooltipOf(history, 4800, { ...ON, gpu: "not-measured" })).GPU).toBe(
      "not measured on this device"
    );
    expect(rowsOfTip(tooltipOf(history, 4800, { ...ON, gpuMhz: 221 })).GPU).toBe("3 at 221 MHz");
  });

  it("is undefined over a frame the history does not hold", () => {
    expect(tooltipOf(historyOf(rowsOf(4800, 2)), 4900, ON)).toBeUndefined();
  });

  it("lists the passes' GPU and a compile inside the frame", () => {
    const history = withEvents(
      historyOf(rowsOf(4800, 2), {
        passes: [
          { row: 1, index: 0, view: "main", gpuMs: 3.1 },
          { row: 1, index: 1, view: "fogLayer", gpuMs: 1.2 }
        ]
      }),
      [line.shader(10_017, 4801, "fog.blur", 31)]
    );
    const rows = rowsOfTip(tooltipOf(history, 4801, ON));
    expect(rows.Passes).toBe("4.3");
    expect(rows["Compile fog.blur"]).toBe("31");
  });
});
