import { beforeAll, describe, expect, it } from "vitest";
import { idleForText } from "../../model/format";
import { headerView } from "../../model/header";
import type { HeaderView } from "../../model/types";
import { CARD_W, CARD_W_COMPACT } from "../../types";
import { secondOf } from "../helpers";
import type { Shaper } from "../shaping";
import { loadFace, textWidth as width } from "../shaping";

// The card header (B1) measured in the bundled faces with HarfBuzz, from the sheet's numbers
// (styles/card.ts, styles/legend.ts): while the screen rests the fps reads "idle" and for how long
// (spec 03 delta 2026-10-15), and the row must still hold the collapse and hide keys.

/** The header row's gap, the grip, the two keys and the card's border, CSS px. */
const GAP = 4;
const GRIP = 24;
const KEY = 44;
const BORDER = 2;

/** A legend's box beyond its text: 5 px padding and a 1.5 px border on each side. */
const LEGEND_BOX = 2 * 5 + 2 * 1.5;

/** The spikes legend's glyph and its gap, and the gap to its label. */
const SPIKE_GLYPH = 9 + 3;
const LABEL_GAP = 3;

/** The fps value's gap to its unit and the margin after it. */
const UNIT_GAP = 2;
const FPS_MARGIN = 4;

/** The compact card's recording mark: a 7 px dot, a 3 px gap and the time (500 11 px). */
const REC_DOT = 7 + 3;

let semiBold: Shaper;
let medium: Shaper;

beforeAll(async () => {
  semiBold = await loadFace("barlow-condensed-latin-600.woff2");
  medium = await loadFace("barlow-condensed-latin-500.woff2");
});

/**
 * A legend's width: its text (600 12 px, .07 em) in its box.
 *
 * @param text - The text.
 * @returns CSS px.
 */
function legend(text: string): number {
  return LEGEND_BOX + width(semiBold, text, 12, 0.07);
}

/**
 * The header row's width without the spacer: grip, fps, spikes legend (and its label on the wide
 * card), the link legend, REC when it shows (the compact card's dot and time), collapse and hide,
 * and the gaps between them.
 *
 * @param header - The header view.
 * @returns CSS px.
 */
function rowWidth(header: HeaderView): number {
  const unitText = header.compact ? "" : header.fpsUnit;
  const unit = unitText === "" ? 0 : UNIT_GAP + width(medium, unitText, 12);
  const fps = width(semiBold, header.fps, 26) + unit + FPS_MARGIN;
  const label = header.compact
    ? 0
    : LABEL_GAP + Math.max(width(medium, "spikes", 11), width(medium, "6 s", 11));
  const spikes = SPIKE_GLYPH + legend(String(header.spikes)) + label;
  let rec = 0;
  if (header.rec) {
    rec = GAP + (header.compact ? REC_DOT + width(medium, header.recFor, 11) : legend("REC"));
  }
  // grip, fps, spikes, link, spacer, collapse, hide: six gaps (seven with REC, counted above).
  return GRIP + fps + spikes + legend(header.link.text) + rec + 2 * KEY + 6 * GAP;
}

/** Each unit's longest duration: 59 s, 59 min, 23 h and 99 h. */
const LONGEST = [59_999, 3_599_999, 86_399_999, 359_999_999];

/**
 * The headers to fit: awake at 120 fps and resting for each longest duration, 99 spikes, recording
 * for each longest duration, under each of the link's widest legends.
 *
 * @param compact - The compact card.
 * @returns The headers.
 */
function busiestHeaders(compact: boolean): HeaderView[] {
  const headers: HeaderView[] = [];
  const states = [undefined, ...LONGEST.map(ms => idleForText(0, ms))];
  for (const idleFor of states) {
    for (const recMs of LONGEST) {
      const header = headerView({
        second: secondOf({ spikes: 99, fps: { loop: 120, drawn: 120 } }),
        status: { state: "on", lost: 0, gpuTimer: true },
        payload: undefined,
        hasBridge: false,
        engine: undefined,
        recording: true,
        recordingMs: recMs,
        idleFor,
        compact
      });
      for (const text of ["NO PC", "STALE"]) {
        headers.push({ ...header, link: { ...header.link, text } });
      }
    }
  }
  return headers;
}

/**
 * The text of a header's fps part and its recording, for a failure message.
 *
 * @param header - The header.
 * @returns The text.
 */
function nameOf(header: HeaderView): string {
  return `${header.fps} ${header.fpsUnit} · ${header.link.text} · REC ${header.recFor}`;
}

describe("the card header fits 99 spikes, 120 fps or a rest, and a recording", () => {
  it("on the compact card: no fps unit, the rest's duration in the counters, no spikes label, REC as a dot and its time", () => {
    for (const header of busiestHeaders(true)) {
      expect(header.compact).toBe(true);
      expect(rowWidth(header), nameOf(header)).toBeLessThanOrEqual(CARD_W_COMPACT - BORDER);
    }
  });

  it("on the wide card, unchanged", () => {
    for (const header of busiestHeaders(false)) {
      expect(header.compact).toBe(false);
      expect(rowWidth(header), nameOf(header)).toBeLessThanOrEqual(CARD_W - BORDER);
    }
  });

  it("keeps the rest's duration and REC in the names (the pill, the dot's label)", () => {
    const [header] = busiestHeaders(true).slice(-2);
    expect(header?.fpsUnit).toBe("99h");
    expect(header?.recFor).toBe("99h");
  });
});
