/* eslint-disable unicorn/no-null -- null is perf's "not measured" */
import { describe, expect, it } from "vitest";
import {
  cursorReadout,
  drawCallsCard,
  fpsCard,
  fpsTag,
  frameTimeCard,
  gpuPassesCard,
  texturesCard
} from "../../derive/cards";
import { createMissionSeries, pushSample } from "../../series/series";
import type { DeviceTelemetry, PerfPassesSummary } from "../../source/contract";
import { REST } from "../../source/contract";
import { secondOf } from "../device-fixtures";
import { bitsOf, historyOf, rowsOf } from "../mission-fixtures";

// ─────────────────────────────────────────────────────────────────────────────
// derive/cards.ts (spec 09 § M9 Cards): the sparkline cards' numbers.
// ─────────────────────────────────────────────────────────────────────────────

/** A history of 6 s at 120 fps from page-clock 10 s, the budget 8.33 ms, with draws. */
const HISTORY = historyOf(
  rowsOf(1, 720, {
    t0: 10_000,
    stepMs: 8.33,
    each: index => ({
      ms: index === 100 ? 21 : 6 + (index % 3),
      budgetMs: 8.33,
      rateMs: 8.33,
      draws: 200 + (index % 20),
      causes: index === 100 ? bitsOf("js") : 0
    })
  }),
  { draws: true }
);

/** The cards' input over HISTORY. */
const INPUT = {
  history: HISTORY,
  startMs: 10_000,
  endMs: 16_000,
  second: secondOf({
    rate: { fps: 60, mode: "auto", reason: "missed", displayHz: 120, switches: 1 }
  }),
  waiting: false,
  selection: undefined
};

const SUMMARY: PerfPassesSummary = {
  v: 1,
  source: "agent",
  t: 16_000,
  frames: 60,
  tiler: false,
  gpuTimer: true,
  chains: [
    {
      owner: 412,
      view: "fogLayer",
      kinds: ["fog.blur"],
      applies: 60,
      mpx: 55,
      draws: 1,
      gpuMs: { p50: 3, max: 9 },
      share: 0.52
    }
  ],
  heaviest: { frame: 100, passes: [] },
  shaders: null,
  targets: null,
  lost: 0
};

describe("cards", () => {
  it("a waiting source shows '—' in every card, never 0", () => {
    // Bug: "0 fps" and "0 ms" shown before the phone sent a frame.
    const waiting = { ...INPUT, waiting: true };
    expect(fpsCard(waiting).value).toBe("—");
    expect(frameTimeCard(waiting)).toMatchObject({ value: "—", extra: { value: "—" } });
    expect(drawCallsCard(waiting).value).toBe("—");
    expect(
      texturesCard({
        ...waiting,
        assets: undefined,
        count: undefined,
        textures: createMissionSeries().textures
      }).value
    ).toBe("—");
    expect(
      gpuPassesCard({ ...waiting, passes: SUMMARY, telemetry: undefined, issues: 0 }).value
    ).toBe("—");
  });

  it("draw calls all null reads '—' with 'counted on WebGPU only'", () => {
    // Bug: 0 draw calls shown on WebGL, which does not count them.
    const webgl = historyOf(rowsOf(1, 100, { t0: 10_000 }));
    expect(drawCallsCard({ ...INPUT, history: webgl })).toEqual({
      value: "—",
      unit: "p90 per frame",
      lines: [["Draw calls are counted on WebGPU only"]],
      inSelection: undefined
    });
    expect(drawCallsCard(INPUT)).toMatchObject({
      value: "217",
      lines: [["200–219 in this window"]]
    });
  });

  it("the FPS tag is warn below the display rate and ok at it; pinned and resting say so", () => {
    // Bug: a warn at 120/120, or none at 60/120.
    expect(fpsCard(INPUT).tag).toEqual({ text: "target 120", tone: "warn" });
    expect(fpsTag(120, 120)).toBe("ok");
    expect(fpsTag(null, 120)).toBe("muted");
    const pinned = {
      ...INPUT,
      second: secondOf({
        rate: { fps: 120, mode: "forced", reason: "forced", displayHz: 120, switches: 0 }
      })
    };
    expect(fpsCard(pinned).tag).toEqual({ text: "pinned, adaptive off", tone: "acc" });
  });

  it("Frame time adds 'while resting' only when the view rests", () => {
    // Bug: a rest budget named on a view that never rested.
    expect(frameTimeCard(INPUT).lines[0]).toEqual(["Budget 8.3 ms at 120 fps"]);
    const resting = historyOf([
      ...rowsOf(1, 50, {
        t0: 10_000,
        stepMs: 8.33,
        each: () => ({ budgetMs: 8.33, rateMs: 8.33 })
      }),
      ...rowsOf(51, 10, {
        t0: 11_000,
        stepMs: 33.3,
        each: () => ({ ms: 33.3, rest: REST.idle, budgetMs: 33.3, rateMs: 33.3 })
      })
    ]);
    expect(frameTimeCard({ ...INPUT, history: resting }).lines[0]).toEqual([
      "Budget 8.3 ms at 120 fps, 33.3 ms while resting"
    ]);
  });

  it("the GPU passes card puts 'at 585 MHz' beside the ms when a clock is known", () => {
    // Bug: DVFS hidden: a slow pass at a low clock read as a slow pass.
    const telemetry = {
      gpu: {
        available: true,
        source: "/sys/kernel/gpu",
        value: { mhz: 585, busyPct: 64, minMhz: 221, maxMhz: 949 }
      }
    } as unknown as DeviceTelemetry;
    const card = gpuPassesCard({ ...INPUT, passes: SUMMARY, telemetry, issues: 2 });
    expect(card.tags).toEqual([
      { text: "at 585 MHz, 64 % busy", tone: "plain" },
      { text: "2 issues", tone: "warn" }
    ]);
    expect(card.extra).toEqual({ value: "3", unit: "ms typical" });
    expect(card.lines[0]).toEqual(["fogLayer ", { strong: "9 ms" }, " in the GPU spikes"]);
  });

  it("passes a frame comes from the frames in view when the newest second drew none (never '0' beside a GPU time)", () => {
    // Bug on the A26: "0 passes a frame" next to "4.2 ms typical": the newest passes summary was
    // of an idle second with no heaviest frame, while the view's frames each ran one canvas pass.
    const rows = rowsOf(1, 120, { t0: 10_000, each: () => ({ gpuMs: 4.2 }) });
    const passes = rows.map((_row, row) => ({ row, index: 0, gpuMs: 4.2 }));
    const history = historyOf(rows, { passes });
    const idle = { ...SUMMARY, heaviest: null };
    const card = gpuPassesCard({
      ...INPUT,
      history,
      endMs: 12_000,
      passes: idle,
      telemetry: undefined,
      issues: 0
    });
    expect(card.value).toBe("1");
    const none = gpuPassesCard({
      ...INPUT,
      history: historyOf(rows),
      endMs: 12_000,
      passes: idle,
      telemetry: undefined,
      issues: 0
    });
    expect(none.value).toBe("—");
  });

  it("tile GPU shows '≈ 52 %', never ms per pass", () => {
    // Bug: a ranked decimal per pass on a Mali, where pass time is a share of the frame.
    const card = gpuPassesCard({
      ...INPUT,
      passes: { ...SUMMARY, tiler: true },
      telemetry: undefined,
      issues: 0
    });
    expect(card.lines[0]).toEqual(["fogLayer ", { strong: "≈ 52 %" }]);
    expect(JSON.stringify(card.lines)).not.toMatch(/ms/u);
  });

  it("in selection lines appear only with a selection", () => {
    // Bug: an "In selection" line over the whole view with nothing selected.
    expect(frameTimeCard(INPUT).inSelection).toBeUndefined();
    expect(fpsCard(INPUT).inSelection).toBeUndefined();
    const selected = { ...INPUT, selection: { from: 95, to: 110 } };
    expect(frameTimeCard(selected).inSelection).toBe("worst 21 ms, f101");
    expect(fpsCard(selected).inSelection).toBe("1 missed frame");
    expect(drawCallsCard(selected).inSelection).toBe("max 219");
  });

  it("the textures card reads MB of the budget, the count and the change in the selection", () => {
    // Bug: the bar over 100 % of its track, or the MB of the old source.
    const series = createMissionSeries();
    pushSample(series.textures, 10_300, 120);
    pushSample(series.textures, 10_900, 130);
    const card = texturesCard({
      ...INPUT,
      selection: { from: 50, to: 120 },
      assets: { textureMb: 130, budgetMb: 192, bundles: [] },
      count: 40,
      textures: series.textures
    });
    expect(card).toMatchObject({ value: "130", unit: "MB of 192 MB", inSelection: "120 → 130 MB" });
    expect(card.lines[0]).toEqual([{ strong: "40" }, " textures, 68 % of budget"]);
    expect(card.share).toBeCloseTo(130 / 192, 6);
    expect(cursorReadout(HISTORY, 101)).toBe("f101 21 ms");
    expect(cursorReadout(HISTORY, 99_999)).toBeUndefined();
  });
});

describe("card edges", () => {
  it("frame time says when the GPU is not measured; a tile GPU chain without a share is left out", () => {
    // Bug: frame times shown as complete on an iPhone without a GPU timer.
    const noTimer = historyOf(rowsOf(1, 60, { t0: 10_000, each: () => ({ gpuMs: null }) }), {
      gpuTimer: false
    });
    expect(frameTimeCard({ ...INPUT, history: noTimer }).lines).toEqual([
      ["Budget 16.7 ms at 60 fps"],
      ["GPU time is not measured on this device"]
    ]);
    const tiler = {
      ...SUMMARY,
      tiler: true,
      chains: [{ ...SUMMARY.chains[0], share: null }]
    } as PerfPassesSummary;
    const card = gpuPassesCard({ ...INPUT, passes: tiler, telemetry: undefined, issues: 0 });
    expect(card.lines).toEqual([["Shader compiles marked on the shared axis"]]);
    expect(card.extra?.value).toBe("3");
  });
});
