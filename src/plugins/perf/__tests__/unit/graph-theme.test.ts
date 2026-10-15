import { describe, expect, it } from "vitest";
import type { GraphContext2D, GraphView } from "../../graph";
import { CAUSE_STYLE, createGraphState, GRAPH_COLOURS, paintGraph, rowAt } from "../../graph";
import { causeHue, GRAPH_PALETTES, graphLook } from "../../graph/themes";
import type { PerfCause, PerfWindowView } from "../../protocol";
import { CAUSE_BITS, CAUSE_RANK, GPU_BIT } from "../../protocol";
import type { WindowRow } from "../helpers";
import { windowOf } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// graph/paint, spec 09 Delta and Amendment 2026-10-15: the light and dark editor
// palettes beside the overlay's cockpit, a moving `now` for the tools page's
// interpolated drawing, only the visible rows, and the static `base` layer split
// from the moving `over` layer.
// ─────────────────────────────────────────────────────────────────────────────

/** One recorded call with the styles set when it ran. */
type Call = {
  readonly op: string;
  readonly args: readonly unknown[];
  readonly fill: string;
  readonly font: string;
};

/**
 * A fake 2D context recording every call with its fill style and font.
 *
 * @returns The context, its calls and the measure count.
 */
function recorder() {
  const calls: Call[] = [];
  const counts = { measures: 0 };
  const record = (op: string, args: readonly unknown[]): void => {
    calls.push({ op, args, fill: String(g.fillStyle), font: g.font });
  };
  const g: GraphContext2D = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    fillRect: (...args) => record("fillRect", args),
    strokeRect: (...args) => record("strokeRect", args),
    beginPath: () => record("beginPath", []),
    closePath: () => record("closePath", []),
    moveTo: (...args) => record("moveTo", args),
    lineTo: (...args) => record("lineTo", args),
    fill: () => record("fill", []),
    stroke: () => record("stroke", []),
    setLineDash: () => record("setLineDash", []),
    fillText: (...args) => record("fillText", args),
    measureText: text => {
      counts.measures += 1;
      return { width: text.length * 6 };
    }
  };
  return { g, calls, counts };
}

/** The tools strip's view. */
const WIDE: GraphView = { width: 1000, height: 200, wide: true, selected: -1 };

/**
 * The cause bit of a cause.
 *
 * @param cause - The cause.
 * @returns Its bit.
 */
function bitOf(cause: PerfCause): number {
  return 1 << CAUSE_BITS.indexOf(cause);
}

/**
 * 360 rows at 60 fps from t = 0, a js spike at row 300 and a gpu spike at row 330.
 *
 * @returns The window.
 */
function demoWindow(): PerfWindowView {
  const rows: WindowRow[] = Array.from({ length: 360 }, (_, index) => ({ t: index * 16.67 }));
  rows[300] = { t: 300 * 16.67, ms: 41, jsMs: 30, gpuMs: 4, causes: bitOf("js") };
  rows[330] = { t: 330 * 16.67, ms: 38, jsMs: 6, gpuMs: 28, causes: bitOf("gpu") };
  return windowOf(rows);
}

/**
 * The relative luminance of a `#rrggbb` colour (WCAG 2).
 *
 * @param hex - The colour.
 * @returns Its luminance.
 */
function luminance(hex: string): number {
  const channel = (offset: number): number => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.039_28 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/**
 * The WCAG contrast ratio of two colours.
 *
 * @param one - A colour.
 * @param two - Another.
 * @returns The ratio, 1 to 21.
 */
function contrast(one: string, two: string): number {
  const [high, low] = [luminance(one), luminance(two)].toSorted((left, right) => right - left);
  return ((high ?? 0) + 0.05) / ((low ?? 0) + 0.05);
}

describe("palettes (spec 09 Delta 2026-10-15)", () => {
  it("the cockpit palette is the overlay's, unchanged: no look and the cockpit look paint the same calls", () => {
    const window = demoWindow();
    const plain = recorder();
    const cockpit = recorder();

    paintGraph(plain.g, window, WIDE, createGraphState(window.capacity));
    paintGraph(
      cockpit.g,
      window,
      { ...WIDE, look: graphLook("cockpit") },
      createGraphState(window.capacity)
    );

    expect(cockpit.calls).toEqual(plain.calls);
    expect(plain.calls[0]?.fill).toBe(GRAPH_COLOURS.well);
    expect(GRAPH_PALETTES.cockpit).toBe(GRAPH_COLOURS);
  });

  it("light and dark draw the well in the editor's canvas colour and every text in Geist", () => {
    const window = demoWindow();
    for (const theme of ["light", "dark"] as const) {
      const rec = recorder();
      paintGraph(
        rec.g,
        window,
        { ...WIDE, look: graphLook(theme) },
        createGraphState(window.capacity)
      );
      expect(rec.calls[0]?.fill, theme).toBe(GRAPH_PALETTES[theme].well);
      const fonts = rec.calls.filter(call => call.op === "fillText").map(call => call.font);
      expect(fonts.length).toBeGreaterThan(0);
      expect(
        fonts.every(font => font.includes("Geist") && !font.includes("Barlow")),
        theme
      ).toBe(true);
    }
    expect(GRAPH_PALETTES.light.well).toBe("#f3f3f5");
    expect(GRAPH_PALETTES.dark.well).toBe("#131316");
  });

  it("cause hues meet 3:1 on the light well, and the light graph paints its spikes in them", () => {
    for (const cause of CAUSE_RANK) {
      expect(
        contrast(causeHue("light", cause), GRAPH_PALETTES.light.well),
        cause
      ).toBeGreaterThanOrEqual(3);
      expect(
        contrast(causeHue("dark", cause), GRAPH_PALETTES.dark.well),
        cause
      ).toBeGreaterThanOrEqual(3);
      expect(causeHue("cockpit", cause)).toBe(CAUSE_STYLE[cause].hue);
    }
    const window = demoWindow();
    const rec = recorder();
    paintGraph(
      rec.g,
      window,
      { ...WIDE, look: graphLook("light") },
      createGraphState(window.capacity)
    );
    const fills = new Set(rec.calls.filter(call => call.op === "fillRect").map(call => call.fill));
    expect(fills.has(causeHue("light", "js"))).toBe(true);
    expect(fills.has(CAUSE_STYLE.js.hue)).toBe(false);
  });

  it("changing the theme resets the text cache: the legends are measured again in the new font", () => {
    const window = demoWindow();
    const state = createGraphState(window.capacity);
    const rec = recorder();
    paintGraph(rec.g, window, WIDE, state);
    paintGraph(rec.g, window, WIDE, state);
    const measured = rec.counts.measures;

    paintGraph(rec.g, window, { ...WIDE, look: graphLook("dark") }, state);

    expect(rec.counts.measures).toBeGreaterThan(measured);
    expect(state.lookKey).toBe("dark");
  });
});

describe("the moving now (spec 09 Amendment 2026-10-15)", () => {
  it("a now past the newest row moves the time origin; the newest row ends at its own end, hit tests follow", () => {
    const window = demoWindow();
    const state = createGraphState(window.capacity);
    const now = window.endMs + 200;

    paintGraph(recorder().g, window, { ...WIDE, nowMs: now }, state);

    expect(state.startMs).toBeCloseTo(now - (window.endMs - window.startMs));
    expect(state.edgeX).toBeLessThan(state.px1);
    const newestX =
      state.px0 + (((window.t[359] ?? 0) - state.startMs) / state.spanMs) * (state.px1 - state.px0);
    expect(rowAt(state, window, newestX + 1)).toBe(359);
    expect(rowAt(state, window, newestX - 10)).toBeLessThan(359);
  });

  it("draws only the rows inside the visible span", () => {
    const window = demoWindow();
    const all = recorder();
    const moved = recorder();

    paintGraph(
      all.g,
      window,
      { ...WIDE, look: graphLook("light") },
      createGraphState(window.capacity)
    );
    paintGraph(
      moved.g,
      window,
      { ...WIDE, look: graphLook("light"), nowMs: window.endMs + 250 },
      createGraphState(window.capacity)
    );

    const js = GRAPH_PALETTES.light.js;
    const bars = (calls: readonly Call[]): number =>
      calls.filter(call => call.op === "fillRect" && call.fill === js).length;
    expect(bars(moved.calls)).toBeLessThan(bars(all.calls));
    expect(bars(all.calls) - bars(moved.calls)).toBeLessThanOrEqual(16);
  });

  it("the base layer is the static part, the over layer everything else on it", () => {
    const window = demoWindow();
    const base = recorder();
    const over = recorder();
    const state = createGraphState(window.capacity);

    paintGraph(base.g, window, { ...WIDE, look: graphLook("dark"), layer: "base" }, state);
    paintGraph(
      over.g,
      window,
      { ...WIDE, look: graphLook("dark"), layer: "over", nowMs: window.endMs + 100 },
      state
    );

    expect(base.calls[0]?.fill).toBe(GRAPH_PALETTES.dark.well);
    expect(base.calls.some(call => call.op === "fillText")).toBe(false);
    expect(base.calls.some(call => call.fill === GRAPH_PALETTES.dark.js)).toBe(false);
    expect(
      over.calls.some(
        call =>
          call.fill === GRAPH_PALETTES.dark.well && call.op === "fillRect" && call.args[0] === 0
      )
    ).toBe(false);
    expect(over.calls.some(call => call.op === "fillText")).toBe(true);
    expect(over.calls.some(call => call.fill === GRAPH_PALETTES.dark.js)).toBe(true);
  });
});

describe("GPU noise (spec 03 delta item 8)", () => {
  it("a lone GPU outlier is no stacked GPU bar but a faint GPU tick under the baseline; its bar is its JS", () => {
    const rows: WindowRow[] = Array.from({ length: 60 }, (_, index) => ({
      t: index * 16.67,
      gpuMs: 1
    }));
    rows[40] = { t: 40 * 16.67, ms: 22, jsMs: 3, gpuMs: 20, noise: GPU_BIT };
    const window = windowOf(rows);
    const state = createGraphState(window.capacity);
    const rec = recorder();

    paintGraph(rec.g, window, { ...WIDE, selected: 40 }, state);

    const gpuBands = rec.calls.filter(
      call => call.op === "fillRect" && call.fill === GRAPH_COLOURS.gpu
    );
    const below = gpuBands.filter(call => Number(call.args[1]) > state.py1);
    const tall = gpuBands.filter(call => Number(call.args[3]) > 10);
    expect(below).toHaveLength(1);
    expect(tall).toHaveLength(0);
    const readout = rec.calls.findLast(call => call.op === "fillText" && call.args[0] === "22.0");
    expect(readout?.fill).toBe(GRAPH_COLOURS.cyan);
  });
});
