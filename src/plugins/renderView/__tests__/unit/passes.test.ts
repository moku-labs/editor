/* eslint-disable unicorn/no-null -- null is perf's "not measured" */
import { describe, expect, it } from "vitest";
import {
  activeProblems,
  compilesOf,
  passCellText,
  passRows,
  problemText,
  shaderChips
} from "../../derive/passes";
import type { PassRowWire, PerfPassesSummary } from "../../source/contract";
import { REST } from "../../source/contract";
import { bitsOf, historyOf, line, rowsOf, withEvents } from "../mission-fixtures";

// ─────────────────────────────────────────────────────────────────────────────
// derive/passes.ts (spec 09 § M9 Shaders & passes panel).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A pass of the heaviest frame.
 *
 * @param overrides - Field overrides.
 * @returns The pass.
 */
function passOf(overrides: Partial<PassRowWire>): PassRowWire {
  return {
    index: 0,
    kind: "canvas",
    view: "main",
    owner: null,
    filter: null,
    w: 1080,
    h: 2340,
    format: "bgra8unorm",
    resolution: null,
    draws: 41,
    gpuMs: 3.1,
    share: 0.3,
    ...overrides
  };
}

const SUMMARY: PerfPassesSummary = {
  v: 1,
  source: "agent",
  t: 81_000,
  frames: 60,
  tiler: false,
  gpuTimer: true,
  chains: [
    {
      owner: 412,
      view: "fogLayer",
      kinds: ["fog.blur", "fog.blur"],
      applies: 120,
      mpx: 221,
      draws: 4,
      gpuMs: { p50: 3, max: 6.9 },
      share: 0.6
    }
  ],
  heaviest: {
    frame: 4852,
    passes: [
      passOf({}),
      passOf({
        index: 1,
        kind: "filter",
        view: "fogLayer",
        owner: 412,
        filter: "fog.blur",
        w: 1280,
        h: 720,
        format: null,
        draws: 2,
        gpuMs: 3,
        share: 0.3
      }),
      passOf({
        index: 2,
        kind: "filter",
        view: "fogLayer",
        owner: 412,
        filter: "fog.blur",
        w: 1280,
        h: 720,
        format: null,
        draws: 2,
        gpuMs: 3.9,
        share: 0.4
      })
    ]
  },
  shaders: { pipelines: 14, hits: 92, compiles: 14, variants: 3, relinks: 2 },
  targets: null,
  lost: 0
};

describe("passes", () => {
  it("a filter chain of one owner is one row; a chain shows 'in GPU spikes' only when max > 2 × p50", () => {
    // Bug: a chain's two blur passes listed as two unrelated passes; spikes named for a steady chain.
    const rows = passRows(SUMMARY);
    expect(rows.map(row => [row.chain, row.gpu, row.spikes])).toEqual([
      ["main", "3.1 ms", undefined],
      ["fogLayer → fog.blur → fog.blur", "6.9 ms", "6.9 in GPU spikes"]
    ]);
    expect(rows[1]?.target).toBe("1280×720, 4 draws");
    const [fog] = SUMMARY.chains;
    if (fog === undefined) throw new Error("the summary has a chain");
    const steady = { ...SUMMARY, chains: [{ ...fog, gpuMs: { p50: 3, max: 6 } }] };
    expect(passRows(steady)[1]?.spikes).toBeUndefined();
    expect(passRows({ ...SUMMARY, heaviest: null })).toEqual([]);
  });

  it("tiler shows gpuShare percentages, never ms per pass", () => {
    // Bug: a ranked decimal per pass on a tile GPU.
    const rows = passRows({ ...SUMMARY, tiler: true });
    expect(rows.map(row => row.gpu)).toEqual(["≈ 30 %", "≈ 70 %"]);
    expect(rows.some(row => row.spikes !== undefined)).toBe(false);
    expect(passCellText(passOf({ share: 0.52 }), true)).toBe("≈ 52 %");
    expect(passCellText(passOf({}), false)).toBe("3.1 ms");
    expect(passCellText(passOf({ gpuMs: null, share: null }), false)).toBe("—");
    expect(
      passRows({ ...SUMMARY, heaviest: { frame: 1, passes: [passOf({ draws: null })] } })[0]?.target
    ).toBe("1080×2340 bgra8unorm, draws not counted on WebGL");
  });

  it("WebGPU reads 'variants', WebGL 're-links'", () => {
    // Bug: "re-links" on WebGPU, where a program has variants.
    expect(shaderChips(SUMMARY, "webgpu")).toEqual([
      "14 programs",
      "3 variants",
      "92 of 106 cache hits"
    ]);
    expect(shaderChips(SUMMARY, "webgl")[1]).toBe("2 re-links");
    expect(shaderChips({ ...SUMMARY, shaders: null }, "webgpu")).toEqual([]);
  });

  it("boot compiles are counted in the note, not listed", () => {
    // Bug: 38 boot compiles listed as compiles inside frames.
    const history = withEvents(
      historyOf(
        rowsOf(4850, 10, {
          each: index => (index === 1 ? { ms: 41, causes: bitsOf("compile", "js") } : {})
        })
      ),
      [
        line.shader(9000, 1, "boot.a", 5, true),
        line.shader(9001, 1, "boot.b", 5, true),
        line.shader(10_017, 4851, "fog.blur", 31)
      ]
    );
    expect(compilesOf(history)).toEqual({
      rows: [{ frame: 4851, label: "fog.blur", sub: "f4851, by fogLayer, a spike", ms: "31 ms" }],
      note: "2 others compiled while loading, before the first frame."
    });
    const bootOnly = withEvents(historyOf(rowsOf(1, 5)), [line.shader(9000, 1, "boot.a", 5, true)]);
    expect(compilesOf(bootOnly).note).toBe(
      "All 1 compiled while loading. No compile inside a frame so far."
    );
  });

  it("each problem rule has its sentence and 'also while the game rests' when it started in a rest; a clear ends it", () => {
    // Bug: a problem kept after the engine cleared it, or two views on one rule cleared together.
    const history = withEvents(
      historyOf(
        rowsOf(4800, 10, { each: index => (index === 2 ? { rest: REST.idle, ms: 33 } : {}) })
      ),
      [
        line.problem(10_000, "filter-still", "fogLayer", false, 4802),
        line.problem(10_010, "filter-still", "hudLayer", false, 4801),
        line.problem(10_020, "target-churn", "fogLayer"),
        line.problem(10_030, "filter-still", "hudLayer", true)
      ]
    );
    const problems = activeProblems(history);
    expect(problems.map(problem => [problem.rule, problem.view])).toEqual([
      ["filter-still", "fogLayer"],
      ["target-churn", "fogLayer"]
    ]);
    const [still, churn] = problems;
    if (still === undefined || churn === undefined) throw new Error("two problems are active");
    expect(problemText(still, history)).toEqual({
      text: "fog.blur on fogLayer re-runs every frame while it is still — cache it",
      sub: "its kept picture was refused, over the budget; also while the game rests"
    });
    expect(problemText(churn, history).text).toBe("offscreen targets: 6 created / s");
  });
});

describe("problem sentences", () => {
  it("each rule of the engine reads its own sentence; an unknown rule shows its name and value", () => {
    // Bug: a newer rule shown as an empty row, or every rule worded like filter-still.
    const history = historyOf(rowsOf(1, 5));
    const sentence = (rule: string) => {
      const [problem] = activeProblems(
        withEvents(historyOf(rowsOf(1, 5)), [line.problem(10_000, rule, "fogLayer")])
      );
      if (problem === undefined) throw new Error("a problem is active");
      return problemText(problem, history).text;
    };
    expect(sentence("filter-area")).toBe("fog.blur on fogLayer covers 6× the canvas");
    expect(sentence("retakes")).toBe("fogLayer retook its kept picture 6 times / s");
    expect(sentence("late-compile")).toBe(
      "fogLayer compiled after the first frame, outside a warm-up"
    );
    expect(sentence("variants")).toBe("fogLayer has 6 pipeline variants");
    expect(sentence("pass-budget")).toBe("6 passes in a frame, over 2");
    expect(sentence("blur-storm")).toBe("blur-storm: 6");
  });
});

describe("chains without owners", () => {
  it("groups filter passes by view on an engine before owners", () => {
    // Bug: every filter pass of an older engine listed as its own chain.
    const older: PerfPassesSummary = {
      ...SUMMARY,
      chains: [],
      heaviest: {
        frame: 1,
        passes: [
          passOf({ index: 0, kind: "filter", view: "fogLayer", owner: null, filter: null }),
          passOf({ index: 1, kind: "filter", view: "fogLayer", owner: null, filter: null }),
          passOf({ index: 2, kind: "filter", view: "hud", owner: null, filter: null })
        ]
      }
    };
    expect(passRows(older).map(row => row.chain)).toEqual([
      "fogLayer → filter → filter",
      "hud → filter"
    ]);
  });
});
