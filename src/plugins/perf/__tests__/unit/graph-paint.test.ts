import { afterEach, describe, expect, it, vi } from "vitest";
import type { GraphContext2D, GraphView } from "../../graph";
import {
  CAUSE_STYLE,
  createGraphState,
  GRAPH_COLOURS,
  GRAPH_FONTS,
  paintGraph,
  resetGraphText
} from "../../graph";
import type { PerfWindowView } from "../../protocol";
import type { WindowRow } from "../helpers";
import { windowOf } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// graph/paint: what paintGraph draws, read from a recording fake 2D context.
// ─────────────────────────────────────────────────────────────────────────────

/** One recorded call with the styles set when it ran. */
type Call = {
  readonly op: string;
  readonly args: readonly unknown[];
  readonly fillStyle: string;
  readonly strokeStyle: string;
  readonly lineWidth: number;
  readonly font: string;
  readonly textAlign: string;
  readonly dash: readonly number[];
};

/**
 * A fake 2D context that records every call with the styles in force.
 *
 * @returns The context, its calls and the measureText count.
 */
function recorder() {
  const calls: Call[] = [];
  let dash: readonly number[] = [];
  const counts = { measures: 0 };
  const record = (op: string, args: readonly unknown[]) => {
    calls.push({
      op,
      args,
      fillStyle: String(g.fillStyle),
      strokeStyle: String(g.strokeStyle),
      lineWidth: g.lineWidth,
      font: g.font,
      textAlign: g.textAlign,
      dash
    });
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
    setLineDash: segments => {
      dash = [...segments];
    },
    fillText: (...args) => record("fillText", args),
    measureText: text => {
      counts.measures += 1;
      return { width: text.length * 6 };
    }
  };
  const texts = () =>
    calls.filter(call => call.op === "fillText").map(call => String(call.args[0]));
  return { g, calls, counts, texts };
}

/** The wide strip's view. */
const WIDE: GraphView = { width: 1000, height: 200, wide: true, selected: -1 };

/** The phone card's view. */
const PHONE: GraphView = { width: 273, height: 108, wide: false, selected: -1 };

/**
 * Rows `step` ms apart from 0.
 *
 * @param count - Rows.
 * @param step - ms between frames.
 * @param row - Values of every row.
 * @returns The rows.
 */
function rows(count: number, step = 16.7, row: Omit<WindowRow, "t"> = {}): WindowRow[] {
  return Array.from({ length: count }, (_, index) => ({ ...row, t: index * step }));
}

/**
 * Paints a window once on a fresh recorder and state.
 *
 * @param window - The window.
 * @param view - The view.
 * @returns The recorder and the state.
 */
function paintOnce(window: PerfWindowView, view: GraphView = WIDE) {
  const rec = recorder();
  const state = createGraphState(window.capacity);
  paintGraph(rec.g, window, view, state);
  return { ...rec, state };
}

/**
 * The y of a frame time in a plot (the painter's scale: 45 ms at the top).
 *
 * @param ms - The frame time.
 * @param py0 - The plot's top.
 * @param py1 - The plot's bottom.
 * @returns The y.
 */
function yAt(ms: number, py0: number, py1: number): number {
  return py1 - (Math.min(ms, 45) / 45) * (py1 - py0);
}

/**
 * The ys of the line segments of the path stroked with the given width and dash.
 *
 * @param calls - The recorded calls.
 * @param lineWidth - The stroke width.
 * @param dash - The dash pattern.
 * @returns The ys of its moveTo / lineTo, in order.
 */
function pathYs(calls: readonly Call[], lineWidth: number, dash: readonly number[]): number[] {
  const end = calls.findIndex(
    call =>
      call.op === "stroke" &&
      call.strokeStyle === GRAPH_COLOURS.magenta &&
      call.lineWidth === lineWidth &&
      call.dash.join(",") === dash.join(",")
  );
  const start = calls.slice(0, end).findLastIndex(call => call.op === "beginPath");
  return calls
    .slice(start, end)
    .filter(call => call.op === "lineTo" || call.op === "moveTo")
    .map(call => Number(call.args[1]));
}

/**
 * Counts the filled rectangles of a colour.
 *
 * @param colour - The fill.
 * @param calls - The recorded calls.
 * @returns How many.
 */
function fills(colour: string, calls: readonly Call[]): number {
  return calls.filter(call => call.op === "fillRect" && call.fillStyle === colour).length;
}

/**
 * The colour of the readout text for a newest row of `ms` and budget 16.
 *
 * @param ms - The newest row's frame time.
 * @param drawn - Whether it was drawn.
 * @returns The readout's fill and text.
 */
function readout(ms: number, drawn: 0 | 1 = 1) {
  const window = windowOf([...rows(3, 16, { budgetMs: 16 }), { t: 48, ms, budgetMs: 16, drawn }]);
  const { calls } = paintOnce(window);
  const text = calls.find(call => call.op === "fillText" && call.font === GRAPH_FONTS.wide.readout);
  return [text?.fillStyle, text?.args[0]];
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the stacks", () => {
  it("draws one bar stack per drawn plain row, and no GPU band without a GPU timer (bug: P9 showing a GPU band)", () => {
    const window = windowOf(rows(5, 16.7, { gpuMs: 5, ms: 16.7 }));
    const timed = paintOnce(window);
    expect([fills(GRAPH_COLOURS.js, timed.calls), fills(GRAPH_COLOURS.gpu, timed.calls)]).toEqual([
      5, 5
    ]);

    const untimed = paintOnce(windowOf(rows(5, 16.7, { gpuMs: 5 }), { gpuTimer: false }));
    expect([
      fills(GRAPH_COLOURS.js, untimed.calls),
      fills(GRAPH_COLOURS.gpu, untimed.calls)
    ]).toEqual([5, 0]);
  });

  it("marks every frame that was not drawn with an amber caret", () => {
    const window = windowOf([
      ...rows(3),
      { t: 50.1, drawn: 0 },
      { t: 66.8, drawn: 0 },
      { t: 83.5 }
    ]);
    const { calls } = paintOnce(window);
    expect(
      calls.filter(call => call.op === "fill" && call.fillStyle === GRAPH_COLOURS.amber)
    ).toHaveLength(2);
  });
});

describe("the flags", () => {
  it("flags each spike with its cause's legend, GC? likely with a dashed border, the selected one filled", () => {
    const window = windowOf([
      ...rows(4),
      { t: 66.8, ms: 30, causes: 0b1_0001 },
      { t: 96.8 },
      { t: 113.5, ms: 30, causes: 0b100_0001 },
      { t: 143.5 }
    ]);
    const { calls, texts, state } = paintOnce(window, { ...WIDE, selected: 4 });
    expect(texts()).toEqual(expect.arrayContaining(["UP", "GC? likely"]));
    const gcBorder = calls.find(
      call =>
        call.op === "strokeRect" &&
        call.strokeStyle === CAUSE_STYLE["gc?"].hue &&
        call.args[1] === 1
    );
    expect(gcBorder?.dash).toEqual([3, 2]);
    const selectedGround = calls.find(
      call =>
        call.op === "fillRect" && call.args[1] === 1 && call.fillStyle === CAUSE_STYLE.upload.hue
    );
    expect(selectedGround).toBeDefined();
    expect(state.flagCount).toBe(2);
  });

  it("skips a spike whose cause code it does not know, without throwing", () => {
    const window = windowOf([...rows(3), { t: 50.1, ms: 30, cause: 9 }]);
    const { state } = paintOnce(window);
    expect(state.flagCount).toBe(0);
  });
});

describe("the readout", () => {
  it("shows SKIP in amber for a frame that was not drawn", () => {
    expect(readout(16, 0)).toEqual([GRAPH_COLOURS.amber, "SKIP"]);
  });

  it("picks cyan at the row's own budget, amber above it and red above twice it", () => {
    expect(readout(16)).toEqual([GRAPH_COLOURS.cyan, "16.0"]);
    expect(readout(16.5)).toEqual([GRAPH_COLOURS.amber, "16.5"]);
    expect(readout(32)).toEqual([GRAPH_COLOURS.amber, "32.0"]);
    expect(readout(32.5)).toEqual([GRAPH_COLOURS.red, "32.5"]);
  });
});

describe("the budget lines and the rate switches", () => {
  it("steps the budget line and its half from 8.3 to 16.7 at the first 60 fps row, with one switch mark labelled 60 (bug: a budget line drawn at the header's budget)", () => {
    const window = windowOf([
      ...rows(3, 8.33, { rateMs: 8.33, budgetMs: 8.33, ms: 8.33 }),
      ...rows(3, 16.67, { rateMs: 16.67, budgetMs: 16.67 }).map(row => ({ ...row, t: row.t + 25 }))
    ]);
    const { calls, texts, state } = paintOnce(window);
    const { py0, py1 } = state;
    const budget = pathYs(calls, 1.5, []);
    expect(budget[0]).toBeCloseTo(yAt(8.33, py0, py1), 3);
    expect(budget.at(-1)).toBeCloseTo(yAt(16.67, py0, py1), 3);
    const half = pathYs(calls, 1, [4, 3]);
    expect(half[0]).toBeCloseTo(yAt(8.33 / 2, py0, py1), 3);
    expect(half.at(-1)).toBeCloseTo(yAt(16.67 / 2, py0, py1), 3);
    expect(texts().filter(text => text === "60")).toHaveLength(1);
    expect(
      calls.filter(
        call => call.op === "stroke" && call.dash.join(",") === "2,2" && call.lineWidth === 1
      )
    ).toHaveLength(1);
  });

  it("keeps a fixed 16.7 budget line flat across a 120 → 60 switch, and still marks the switch (bug: a budget line drawn from the rate)", () => {
    const window = windowOf([
      ...rows(3, 8.33, { rateMs: 8.33, budgetMs: 16.7 }),
      ...rows(3, 16.67, { rateMs: 16.67, budgetMs: 16.7 }).map(row => ({ ...row, t: row.t + 25 }))
    ]);
    const { calls, texts } = paintOnce(window);
    expect(new Set(pathYs(calls, 1.5, [])).size).toBe(1);
    expect(texts()).toContain("60");
  });

  it("labels the tape with the newest row's budget and its half", () => {
    const window = windowOf([
      ...rows(3, 8.33, { budgetMs: 8.33, rateMs: 8.33 }),
      { t: 25, budgetMs: 16.67 }
    ]);
    const { calls } = paintOnce(window);
    const tape = calls
      .filter(
        call =>
          call.op === "fillText" &&
          call.args[1] === WIDE.width - 3 &&
          call.fillStyle === GRAPH_COLOURS.magenta
      )
      .map(call => call.args[0]);
    expect(tape).toEqual(["16.7", "8.3"]);
  });
});

describe("the caption and the axis", () => {
  it("captions the selected spike with spike k/n", () => {
    const window = windowOf([
      ...rows(2),
      { t: 33.4, ms: 30, causes: 1 },
      { t: 63.4, ms: 30, causes: 1 }
    ]);
    expect(paintOnce(window, { ...WIDE, selected: 3 }).texts()).toContain("frame 4, spike 2/2");
    expect(paintOnce(window, PHONE).texts()).toContain("frame 4, spike 2/2");
    expect(paintOnce(window, { ...PHONE, selected: 0 }).texts()).toContain("frame 1");
  });

  it("labels each second on the wide strip and only the ends on the phone, the phone with its stack legend", () => {
    const window = windowOf(rows(10));
    expect(paintOnce(window).texts()).toEqual(
      expect.arrayContaining(["−6 s", "−3 s", "−1 s", "now"])
    );
    const phone = paintOnce(window, PHONE).texts();
    expect(phone).toEqual(expect.arrayContaining(["−6 s", "now", "JS", "GPU", "idle"]));
    expect(phone).not.toContain("−3 s");
    expect(paintOnce(windowOf(rows(10), { gpuTimer: false }), PHONE).texts()).not.toContain("GPU");
  });

  it("draws at most 60 axis labels for a hostile span (bug: a ten-minute window freezing the tools page)", () => {
    const window = windowOf(rows(10), { spanMs: 600_000 });
    const axis = paintOnce(window).calls.filter(
      call => call.op === "fillText" && call.font === GRAPH_FONTS.wide.axis
    );
    expect(axis).toHaveLength(61);
    expect(axis[0]?.args[0]).toBe("−60 s");
  });
});

describe("the caches", () => {
  it("measures no text and builds no number string on a repaint of unchanged inputs", () => {
    const window = windowOf([
      ...rows(5, 8.33, { rateMs: 8.33, budgetMs: 8.33 }),
      { t: 41.65, ms: 30, causes: 1, rateMs: 16.67 }
    ]);
    const rec = recorder();
    const state = createGraphState(16);
    paintGraph(rec.g, window, WIDE, state);
    expect(state.rateText.get(60)).toBe("60");
    expect(rec.counts.measures).toBe(7);
    const toFixed = vi.spyOn(Number.prototype, "toFixed");
    const readoutText = state.readoutText;
    paintGraph(rec.g, window, WIDE, state);
    expect(rec.counts.measures).toBe(7);
    expect(toFixed).not.toHaveBeenCalled();
    expect(state.readoutText).toBe(readoutText);
  });

  it("measures again after resetGraphText", () => {
    const window = windowOf(rows(5));
    const rec = recorder();
    const state = createGraphState(16);
    paintGraph(rec.g, window, PHONE, state);
    resetGraphText(state);
    paintGraph(rec.g, window, PHONE, state);
    expect(rec.counts.measures).toBe(14);
  });
});

describe("the edges of a paint", () => {
  it("paints an empty window (off or waiting): no readout, no caption, the default budget on the tape", () => {
    const { texts, calls } = paintOnce(windowOf([]), PHONE);
    expect(texts()).toContain("16.7");
    expect(texts().some(text => text.startsWith("frame"))).toBe(false);
    expect(calls.some(call => call.font === GRAPH_FONTS.phone.readout)).toBe(false);
  });

  it("carets a spike over the 45 ms scale in red, and frames the selected GC? flag hollow with a 2 px border", () => {
    const window = windowOf([...rows(3), { t: 50.1, ms: 60, causes: 0b100_0001 }]);
    const { calls } = paintOnce(window, { ...WIDE, selected: 3 });
    expect(calls.some(call => call.op === "fill" && call.fillStyle === GRAPH_COLOURS.red)).toBe(
      true
    );
    expect(
      calls.some(
        call =>
          call.op === "fillRect" &&
          call.args[1] === 1 &&
          call.fillStyle === GRAPH_COLOURS.flagSelectedHollow
      )
    ).toBe(true);
    expect(calls.find(call => call.op === "strokeRect" && call.args[1] === 1)?.lineWidth).toBe(2);
  });

  it("keeps no more flag boxes than the state holds", () => {
    const window = windowOf([
      ...rows(2),
      { t: 33.4, ms: 30, causes: 1 },
      { t: 63.4, ms: 30, causes: 1 }
    ]);
    const rec = recorder();
    const state = createGraphState(1);
    paintGraph(rec.g, window, WIDE, state);
    expect(state.flagCount).toBe(1);
  });

  it("leaves out a tape label closer than 9 px to the budget, and shows only 0, the budget and 40 on a short plot", () => {
    const fast = windowOf(rows(3, 8.33, { budgetMs: 8.33, rateMs: 8.33 }));
    const tape = (view: GraphView) =>
      paintOnce(fast, view)
        .calls.filter(call => call.op === "fillText" && call.args[1] === view.width - 3)
        .map(call => call.args[0]);
    expect(tape(PHONE)).toEqual(["8.3", "0", "30", "40"]);
    expect(tape({ ...PHONE, height: 90 })).toEqual(["8.3", "0", "40"]);
  });

  it("draws a rate label that would cross the tape left of its line", () => {
    const window = windowOf([...rows(3, 8.33, { rateMs: 8.33 }), { t: 5990, rateMs: 16.67 }]);
    const label = paintOnce(window).calls.find(
      call => call.op === "fillText" && call.args[0] === "60"
    );
    expect(label?.textAlign).toBe("right");
  });

  it("labels only rates of 1 to 1000 fps and keeps at most 16 rate labels (bug: an unbounded label cache)", () => {
    const rates = Array.from({ length: 20 }, (_, index) => ({
      t: index * 20,
      rateMs: 1000 / (index + 30)
    }));
    const rec = recorder();
    const state = createGraphState(32);
    paintGraph(rec.g, windowOf(rates), WIDE, state);
    expect(state.rateText.size).toBeLessThanOrEqual(16);
    expect(rec.texts()).toContain("49");

    const fast = recorder();
    paintGraph(
      fast.g,
      windowOf([
        { t: 0, rateMs: 16.67 },
        { t: 20, rateMs: 0.5 }
      ]),
      WIDE,
      createGraphState(4)
    );
    expect(fast.texts()).not.toContain("2000");
  });

  it("names the overlay's private Barlow face first and the plain one next, for the tools page (bug: the overlay drawing in a fallback face)", () => {
    const fonts = [...Object.values(GRAPH_FONTS.phone), ...Object.values(GRAPH_FONTS.wide)];
    for (const font of fonts) {
      const families = font.slice(font.indexOf('"')).split(", ");
      expect(families.slice(0, 2)).toEqual([
        '"Moku Overlay Barlow Condensed"',
        '"Barlow Condensed"'
      ]);
    }
    const { calls } = paintOnce(windowOf(rows(3)));
    expect(calls.find(call => call.op === "fillText")?.font).toContain(
      '"Moku Overlay Barlow Condensed"'
    );
  });
});
