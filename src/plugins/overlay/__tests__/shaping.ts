/**
 * @file overlay tests — text widths in the bundled faces, shaped by HarfBuzz with tabular numerals
 * (as the sheet sets them): the fit tests of the compact counters and the card header.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { Blob, Face, Feature, Font, Buffer as ShapeBuffer, shape } from "harfbuzzjs";

/** `subset-font`'s default export (the package ships no types). */
type SubsetFont = (
  font: Uint8Array,
  text: string | undefined,
  options: { readonly targetFormat: "sfnt"; readonly keepAllGlyphs: boolean }
) => Promise<Uint8Array>;

const subsetFont = createRequire(import.meta.url)("subset-font") as SubsetFont;

/** A face ready to shape and its units per em. */
export type Shaper = { readonly font: Font; readonly upem: number };

/**
 * Loads one bundled face (woff2 → sfnt) for HarfBuzz.
 *
 * @param file - The face file in src/plugins/overlay/fonts.
 * @returns The shaper.
 */
export async function loadFace(file: string): Promise<Shaper> {
  const woff2 = readFileSync(path.join(process.cwd(), "src/plugins/overlay/fonts", file));
  const sfnt = await subsetFont(woff2, undefined, { targetFormat: "sfnt", keepAllGlyphs: true });
  const face = new Face(new Blob(Uint8Array.from(sfnt)), 0);
  return { font: new Font(face), upem: face.upem };
}

/**
 * The advance width of a text, CSS px; letter spacing after every character, as CSS adds it.
 *
 * @param shaper - The face.
 * @param text - The text.
 * @param size - The font size, px.
 * @param letterSpacing - Letter spacing, em.
 * @returns The width.
 */
export function textWidth(shaper: Shaper, text: string, size: number, letterSpacing = 0): number {
  const buffer = new ShapeBuffer();
  buffer.addText(text);
  buffer.guessSegmentProperties();
  const tabular = Feature.fromString("tnum");
  shape(shaper.font, buffer, tabular === undefined ? [] : [tabular]);
  const advance = buffer.getGlyphPositions().reduce((sum, position) => sum + position.xAdvance, 0);
  return (advance / shaper.upem) * size + letterSpacing * size * [...text].length;
}
