/* eslint-disable unicorn/no-null -- null is the engine's and perf's "not measured" */
import { describe, expect, it } from "vitest";
import { frameRecord, spikeLine } from "../../../../../tests/fixtures/fake-monitor";
import type { PerfSpikeRecord } from "../../../perf/protocol";
import { COLOUR } from "../../model/format";
import { alsoOf, changedText, recordView, severityOf } from "../../model/record";
import { IDLE, RECORDING } from "../helpers";

/**
 * A spike record of frame 4812: an upload with a pause, 41.3 ms over a 16.7 budget.
 *
 * @param overrides - Fields to replace.
 * @returns The record.
 */
function recordOf(overrides: Partial<PerfSpikeRecord> = {}): PerfSpikeRecord {
  return {
    frame: 4812,
    agoMs: 980,
    ms: 41.3,
    budgetMs: 16.7,
    overMs: 24.6,
    cause: "upload",
    causes: ["upload", "gap"],
    jsMs: 8,
    gpuMs: 6.6,
    path: "garden/boss",
    why: "41.0 MB of textures uploaded this frame (bundle garden-boss)",
    at: null,
    fps: 60,
    rateSwitch: null,
    gapMs: 41.3,
    drawn: true,
    gpuPartial: false,
    phases: {
      input: 0.2,
      animate: 1.1,
      layout: 0.6,
      sync: 0.9,
      signals: 2.8,
      render: 2.4,
      agent: 0.1
    },
    passes: 6,
    draws: 238,
    filters: { applies: 4, mpx: 6.2 },
    uploads: { count: 3, mb: 41 },
    compiles: 0,
    changed: ["bundle"],
    events: [],
    detail: null,
    ...overrides
  };
}

describe("recordView lead", () => {
  it("the primary legend is the last cause (the first legend is the primary, lit)", () => {
    const view = recordView(recordOf(), RECORDING, 5, 6);
    expect(view.causes.map(legend => [legend.text, legend.lit])).toEqual([
      ["UP", true],
      ["GAP", false]
    ]);
    expect(view).toMatchObject({
      title: "Frame 4812",
      word: "Upload",
      ms: "41.3",
      over: "+24.6 ms",
      budget: "16.7"
    });
    expect(view.nav).toEqual({ counter: "5/6", disabled: false });
    expect(view.colour).toBe("#B58CFF");
  });

  it("draws a hollow GC? legend with likely", () => {
    const view = recordView(recordOf({ cause: "gc?", causes: ["gc?"] }), IDLE, 1, 1);
    expect(view.causes[0]).toMatchObject({ text: "GC?", hollow: true, small: "likely" });
  });

  it("a 33.5 ms frame over a 16.7 budget is amber (it is red: over twice the budget)", () => {
    expect(recordView(recordOf({ ms: 33.5, budgetMs: 16.7 }), IDLE, 1, 1).severity).toBe("red");
    expect(severityOf(20, 16.7)).toBe("amber");
  });

  it("a 12 ms frame at 120 fps is drawn as within budget (the lead uses the 8.3 ms budgetMs)", () => {
    const view = recordView(
      recordOf({ ms: 12, budgetMs: 8.33, overMs: 3.67, fps: 120 }),
      IDLE,
      1,
      1
    );
    expect(view).toMatchObject({ severity: "amber", budget: "8.3", over: "+3.7 ms" });
  });

  it("a 12 ms frame at 120 fps under a fixed 16.7 budget is amber (the frame's own budget)", () => {
    expect(recordView(recordOf({ ms: 12, budgetMs: 16.7, fps: 120 }), IDLE, 1, 1).severity).toBe(
      "ok"
    );
  });

  it("the Also sentence repeats the primary cause", () => {
    expect(alsoOf(["upload", "gap"])).toBe("Also GAP, pause without work.");
    expect(alsoOf(["gpu", "longFrame", "js"])).toBe("Also LF, long frame; JS, work over budget.");
    expect(alsoOf(["js"])).toBe("");
    expect(recordView(recordOf(), IDLE, 1, 1).why).toBe(
      "41.0 MB of textures uploaded this frame (bundle garden-boss). Also GAP, pause without work."
    );
  });
});

describe("recordView meta", () => {
  it("names how long ago and the log time while recording", () => {
    expect(recordView(recordOf(), RECORDING, 5, 6).meta).toBe("0.98 s ago, log 03:11.0");
  });

  it("the log time shows while not recording (it is left out)", () => {
    expect(recordView(recordOf(), IDLE, 5, 6).meta).toBe("0.98 s ago");
  });

  it("a log time before the recording started is shown negative (it is left out)", () => {
    expect(recordView(recordOf(), { ...RECORDING, sinceMs: 500 }, 5, 6).meta).toBe("0.98 s ago");
  });

  it("a record whose spike left the window reads –/n", () => {
    expect(recordView(recordOf(), IDLE, 0, 4).nav.counter).toBe("–/4");
  });
});

describe("recordView details", () => {
  it("a record without its detail shows empty phases instead of the ring numbers", () => {
    const view = recordView(recordOf(), IDLE, 1, 1);
    expect(view.pending).toBe(true);
    expect(view.phases.map(bar => [bar.label, bar.value, bar.width])).toEqual([
      ["input", "0.2", 3],
      ["animate", "1.1", 16],
      ["layout", "0.6", 9],
      ["sync", "0.9", 13],
      ["signals", "2.8", 40],
      ["render", "2.4", 34],
      ["agent", "0.1", 1]
    ]);
    expect(view.gpuTitle).toBe("GPU 6.6 ms over 6 passes");
    expect(view.frameRows).toEqual([
      { label: "draws", value: "238", tone: "value" },
      { label: "uploads", value: "41.0 MB", tone: "caution" },
      { label: "shader compiles", value: "0", tone: "value" },
      { label: "long frame", value: "—", tone: "word" },
      { label: "flow path", value: "garden/boss", tone: "word" },
      { label: "rate", value: "60 fps", tone: "word" }
    ]);
  });

  it("reads the engine's spike line once it arrived", () => {
    const frame = frameRecord(4812, {
      draws: 240,
      rebuilds: 1,
      changed: [{ kind: "bundle", what: "garden-boss" }]
    });
    const detail = spikeLine(frame, {
      systems: [
        { name: "ripple", ms: 1.8 },
        { name: "frost-apply", ms: 2.6 }
      ],
      filters: [
        { kind: "glow", applies: 2, mpx: 2.527 },
        { kind: "fog", applies: 1, mpx: 1.26 }
      ],
      passes: [
        { index: 0, kind: "canvas", label: "main", stencil: null, w: 1080, h: 2340, gpuMs: 9.8 },
        { index: 1, kind: "filter", label: null, stencil: null, w: 540, h: 540, gpuMs: 4.9 }
      ],
      longFrames: [
        {
          startMs: 1,
          durationMs: 47.2,
          blockingMs: 20,
          renderStartMs: null,
          styleLayoutMs: null,
          scripts: [
            {
              invoker: "TimerHandler",
              type: "user-callback",
              source: "main.js",
              fn: "tick",
              ms: 30,
              forcedLayoutMs: 0
            }
          ]
        }
      ]
    });
    const view = recordView(recordOf({ detail }), IDLE, 1, 1);
    expect(view.pending).toBe(false);
    expect(view.systems).toBe("frost-apply 2.6 · ripple 1.8 ms");
    expect(view.filters).toEqual([
      { label: "glow", value: "2.53 Mpx", tone: "word" },
      { label: "fog", value: "1.26 Mpx", tone: "word" },
      { label: "passes", value: "2", tone: "value" }
    ]);
    expect(view.gpu.map(bar => [bar.label, bar.value, bar.width])).toEqual([
      ["main", "9.8", 40],
      ["filter", "4.9", 20]
    ]);
    expect(view.frameRows[0]).toEqual({ label: "draws", value: "240", tone: "value" });
    expect(view.frameRows[3]).toEqual({ label: "long frame", value: "47 ms, tick", tone: "word" });
    expect(view.changed).toBe("bundle garden-boss loaded · structure rebuild ×1");
  });
});

describe("changedText", () => {
  it("the rate switch of the frame is missing from What changed", () => {
    const record = recordOf({
      changed: [],
      rateSwitch: { from: 120, to: 60, reason: "missed", mode: "auto" }
    });
    expect(changedText(record)).toBe("rate 120 → 60 (missed, auto)");
    expect(
      changedText(
        recordOf({ changed: [], rateSwitch: { from: 120, to: 60, reason: null, mode: null } })
      )
    ).toBe("rate 120 → 60");
  });

  it("a game overlay that opened in the frame is missing from What changed", () => {
    const record = recordOf({
      changed: [],
      events: [
        { kind: "overlay", frame: 4812, label: "shopDimLayer", what: "open", mode: "freeze" }
      ]
    });
    expect(changedText(record)).toBe("shopDimLayer open");
  });

  it("What changed prints the overlay's entity id instead of its label", () => {
    const record = recordOf({
      changed: [],
      events: [
        { kind: "overlay", frame: 4812, label: "shopDimLayer", what: "kept", mode: "freeze" }
      ]
    });
    expect(changedText(record)).toBe("shopDimLayer kept");
  });

  it("a pool trim of the frame before is missing", () => {
    const record = recordOf({
      changed: [],
      events: [
        { kind: "overlay", frame: 4812, label: "shopDimLayer", what: "open", mode: "freeze" },
        { kind: "pool-trim", frame: 4811, reason: "rest", freedMb: 41.53 }
      ]
    });
    expect(changedText(record)).toBe("shopDimLayer open · pool trim −41.5 MB (rest)");
  });

  it("a warm-up prints its detail as JSON", () => {
    expect(
      changedText(recordOf({ changed: [], events: [{ kind: "warm", frame: 4812, draws: 12 }] }))
    ).toBe("warm-up 12 draws");
  });

  it("names every change kind, and — for none", () => {
    expect(
      changedText(recordOf({ changed: ["scene", "resize", "resolution", "restore", "bundle"] }))
    ).toBe("scene · resize · resolution change · device restored · bundle loaded");
    expect(changedText(recordOf({ changed: [] }))).toBe("—");
  });

  it("colours the why line with the primary cause", () => {
    expect(recordView(recordOf({ cause: "js", causes: ["js"] }), IDLE, 1, 1).colour).toBe(
      "#F4E04D"
    );
    expect(COLOUR.budget).toBe("var(--budget)");
  });
});
