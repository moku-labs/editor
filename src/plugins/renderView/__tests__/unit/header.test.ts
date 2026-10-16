/* eslint-disable unicorn/no-null -- null is a JSON value on the wire and the engine's "not reported" */
import { describe, expect, it } from "vitest";
import { framesHeadline, restFpsOf } from "../../derive/header";
import { REST } from "../../source/contract";
import { historyOf, rowsOf } from "../mission-fixtures";

// ─────────────────────────────────────────────────────────────────────────────
// derive/header.ts (spec 09 § M8 Frames header): the headline of the view —
// spikes (warn when > 0), worst only with a spike, p90, rest at the rest rate,
// GCs only while memory is measured and on; "No frames yet" without frames.
// ─────────────────────────────────────────────────────────────────────────────

const STATS = { frames: 360, spikes: 0, worstMs: null, p90Ms: 14.2, restMs: 0, gcs: null };

/**
 * The headline as plain text, parts joined by " · ".
 *
 * @param parts - The headline.
 * @returns The text.
 */
function textOf(parts: ReturnType<typeof framesHeadline>): string {
  return (parts ?? [])
    .map(part =>
      part.line.map(piece => (typeof piece === "string" ? piece : piece.strong)).join("")
    )
    .join(" · ");
}

describe("the frames headline", () => {
  it("reads 'No frames yet' (undefined) without frames, never zeros", () => {
    expect(framesHeadline({ ...STATS, frames: 0 }, null)).toBeUndefined();
  });

  it("names the worst frame only when the view has a spike, and warns on the spike count", () => {
    const calm = framesHeadline(STATS, null);
    expect(textOf(calm)).toBe("0 spikes in view · p90 14.2 ms");
    expect(calm?.[0]?.warn).toBe(false);
    // The view's slowest frame is known, but it is no spike: no "worst".
    expect(textOf(framesHeadline({ ...STATS, worstMs: 15.1 }, null))).toBe(
      "0 spikes in view · p90 14.2 ms"
    );

    const spiky = framesHeadline({ ...STATS, spikes: 3, worstMs: 41.3 }, null);
    expect(textOf(spiky)).toBe("3 spikes in view · worst 41.3 ms · p90 14.2 ms");
    expect(spiky?.[0]?.warn).toBe(true);
  });

  it("adds the rest at the rest rate when the view rests, and the GCs only when they are shown", () => {
    const parts = framesHeadline({ ...STATS, spikes: 1, worstMs: 22.4, restMs: 1400, gcs: 2 }, 30);
    expect(textOf(parts)).toBe(
      "1 spike in view · worst 22.4 ms · p90 14.2 ms · rest 1.4 s at 30 fps · 2 GC"
    );
  });

  it("finds the rest rate from the newest resting row of the view", () => {
    const history = historyOf(
      rowsOf(4800, 40, {
        each: index =>
          index >= 10 && index < 20
            ? { rest: REST.idle, budgetMs: 33.33, rateMs: 33.33, ms: 33.3 }
            : {}
      })
    );
    expect(restFpsOf(history, 10_000, 11_000)).toBe(30);
    expect(restFpsOf(history, 10_400, 11_000)).toBeNull();
  });
});
