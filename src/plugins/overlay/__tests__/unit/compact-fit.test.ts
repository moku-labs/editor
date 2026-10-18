import { beforeAll, describe, expect, it } from "vitest";
import { idleForText } from "../../model/format";
import { counterCells } from "../../model/frames";
import type { CounterCell } from "../../model/types";
import { secondOf } from "../helpers";
import type { Shaper } from "../shaping";
import { loadFace, textWidth as width } from "../shaping";

// The compact card's drawn / loop cell measured in the bundled faces with HarfBuzz (tabular
// numerals, as the sheet sets them): design check P7 found "57 / 58 @60 fps" clipped 17 px.

/**
 * The inner width of one compact counter cell, CSS px: the 300 px card less the body padding
 * (2 × 10), the counters' border (2 × 1), three 1 px gaps and the 44 px More key, split in three,
 * less the cell padding (2 × 7).
 */
const CELL_INNER = (300 - 20 - 2 - 3 - 44) / 3 - 14;

let semiBold: Shaper;
let medium: Shaper;

/**
 * The compact drawn / loop cell at a rate and counts.
 *
 * @param drawn - Drawn fps.
 * @param loop - Loop fps.
 * @param fps - The loop's rate.
 * @returns The cell.
 */
function compactCell(drawn: number, loop: number, fps: number): CounterCell {
  const second = secondOf({
    fps: { loop, drawn },
    rate: { fps, mode: "auto", reason: "missed", displayHz: 120, switches: 1 }
  });
  const found = counterCells(second, { gpuAvg: 6 }, true, true).find(cell => cell.key === "fps");
  if (found === undefined) throw new Error("no fps cell");
  return found;
}

beforeAll(async () => {
  semiBold = await loadFace("barlow-condensed-latin-600.woff2");
  medium = await loadFace("barlow-condensed-latin-500.woff2");
});

describe("the compact drawn / loop cell fits its 63 px", () => {
  it("the label line is clipped (label 500 12 px, .01em; suffix 500 11 px)", () => {
    for (const fps of [60, 120]) {
      const cell = compactCell(57, 58, fps);
      const suffix =
        cell.ratePlace === "label" && cell.rate !== undefined ? ` ${cell.rate.text}` : "";
      const total = width(medium, cell.label, 12, 0.01) + width(medium, suffix, 11, 0.01);
      expect(total, `${cell.label}${suffix}`).toBeLessThanOrEqual(CELL_INNER);
    }
  });

  it("the idle value with its longest duration is clipped too (value 600 17 px, unit 500 11 px)", () => {
    const second = secondOf({
      activity: { idle: true, idleSince: 0, idleFrames: 9, idleMs: 900, breaks: 0, p90Ms: 17 },
      rate: { fps: 120, mode: "auto", reason: "missed", displayHz: 120, switches: 1 }
    });
    for (const idleMs of [59_999, 3_599_999, 86_399_999]) {
      const idleFor = idleForText(0, idleMs);
      const cell = counterCells(second, { gpuAvg: 6 }, true, true, idleFor).find(
        each => each.key === "fps"
      );
      if (cell === undefined) throw new Error("no fps cell");
      expect(cell.value).toBe("idle");
      const total = width(semiBold, cell.value, 17) + 2 + width(medium, cell.unit, 11);
      expect(total, `${cell.value} ${cell.unit}`).toBeLessThanOrEqual(CELL_INNER);
    }
  });

  it("the value is clipped (600 17 px; the unit, when shown, 500 11 px after 2 px)", () => {
    for (const [drawn, loop] of [
      [57, 58],
      [118, 120]
    ] as const) {
      const cell = compactCell(drawn, loop, 120);
      const suffix =
        cell.ratePlace === "value" && cell.rate !== undefined
          ? width(medium, ` ${cell.rate.text}`, 11)
          : 0;
      const unit = cell.unit === "" ? 0 : 2 + width(medium, cell.unit, 11);
      expect(width(semiBold, cell.value, 17) + suffix + unit, cell.value).toBeLessThanOrEqual(
        CELL_INNER
      );
    }
  });
});

/**
 * The inner width of one wide counter cell (span 4 of 12), CSS px: the 344 px card less its border
 * (2), the body padding (2 × 10) and the counters' border (2 × 1), eleven 1 px gaps, four columns
 * and three gaps, less the cell padding (2 × 7).
 */
const WIDE_CELL_INNER = ((344 - 2 - 20 - 2 - 11) / 12) * 4 + 3 - 14;

describe("the GPU p50 / p90 cell fits both cards", () => {
  it("label and value at their widest (99.9 / 99.9, 999 / 999)", () => {
    for (const [compact, inner] of [
      [true, CELL_INNER],
      [false, WIDE_CELL_INNER]
    ] as const) {
      for (const [p50, p90] of [
        [99.9, 99.9],
        [999, 999]
      ] as const) {
        const cell = counterCells(secondOf(), { gpuP50: p50, gpuP90: p90 }, compact, true).find(
          each => each.key === "gpu"
        );
        if (cell === undefined) throw new Error("no gpu cell");
        expect(cell.label).toContain("p90");
        const label = width(medium, cell.label, 12, 0.01);
        const unit = cell.unit === "" ? 0 : 2 + width(medium, cell.unit, 11);
        expect(label, cell.label).toBeLessThanOrEqual(inner);
        expect(width(semiBold, cell.value, 17) + unit, cell.value).toBeLessThanOrEqual(inner);
      }
    }
  });
});
