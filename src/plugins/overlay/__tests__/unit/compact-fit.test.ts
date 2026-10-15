import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { Blob, Face, Feature, Font, Buffer as ShapeBuffer, shape } from "harfbuzzjs";
import { beforeAll, describe, expect, it } from "vitest";
import { counterCells } from "../../model/frames";
import type { CounterCell } from "../../model/types";
import { secondOf } from "../helpers";

// The compact card's drawn / loop cell measured in the bundled faces with HarfBuzz (tabular
// numerals, as the sheet sets them): design check P7 found "57 / 58 @60 fps" clipped 17 px.

/**
 * The inner width of one compact counter cell, CSS px: the 300 px card less the body padding
 * (2 × 10), the counters' border (2 × 1), three 1 px gaps and the 44 px More key, split in three,
 * less the cell padding (2 × 7).
 */
const CELL_INNER = (300 - 20 - 2 - 3 - 44) / 3 - 14;

/** `subset-font`'s default export (the package ships no types). */
type SubsetFont = (
  font: Uint8Array,
  text: string | undefined,
  options: { readonly targetFormat: "sfnt"; readonly keepAllGlyphs: boolean }
) => Promise<Uint8Array>;

const subsetFont = createRequire(import.meta.url)("subset-font") as SubsetFont;

/** A face ready to shape and its units per em. */
type Shaper = { readonly font: Font; readonly upem: number };

let semiBold: Shaper;
let medium: Shaper;

/**
 * Loads one bundled face (woff2 → sfnt) for HarfBuzz.
 *
 * @param file - The face file in src/plugins/overlay/fonts.
 * @returns The shaper.
 */
async function load(file: string): Promise<Shaper> {
  const woff2 = readFileSync(path.join(process.cwd(), "src/plugins/overlay/fonts", file));
  const sfnt = await subsetFont(woff2, undefined, { targetFormat: "sfnt", keepAllGlyphs: true });
  const face = new Face(new Blob(Uint8Array.from(sfnt)), 0);
  return { font: new Font(face), upem: face.upem };
}

/**
 * The advance width of a text, CSS px.
 *
 * @param shaper - The face.
 * @param text - The text.
 * @param size - The font size, px.
 * @param letterSpacing - Letter spacing, em.
 * @returns The width.
 */
function width(shaper: Shaper, text: string, size: number, letterSpacing = 0): number {
  const buffer = new ShapeBuffer();
  buffer.addText(text);
  buffer.guessSegmentProperties();
  const tabular = Feature.fromString("tnum");
  shape(shaper.font, buffer, tabular === undefined ? [] : [tabular]);
  const advance = buffer.getGlyphPositions().reduce((sum, position) => sum + position.xAdvance, 0);
  return (advance / shaper.upem) * size + letterSpacing * size * [...text].length;
}

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
  const found = counterCells(second, 6, true, true).find(cell => cell.key === "fps");
  if (found === undefined) throw new Error("no fps cell");
  return found;
}

beforeAll(async () => {
  semiBold = await load("barlow-condensed-latin-600.woff2");
  medium = await load("barlow-condensed-latin-500.woff2");
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
