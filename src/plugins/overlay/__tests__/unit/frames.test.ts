/* eslint-disable unicorn/no-null -- null is the engine's and perf's "not measured" */
import { describe, expect, it } from "vitest";
import {
  counterCells,
  deviceLabel,
  framesNote,
  moreParts,
  moreText,
  navView,
  rateSuffix,
  systemsText
} from "../../model/frames";
import type { CounterCell } from "../../model/types";
import { secondOf } from "../helpers";

/**
 * A counter cell by key.
 *
 * @param cells - The cells.
 * @param key - The key.
 * @returns The cell.
 */
function cell(cells: readonly CounterCell[], key: CounterCell["key"]): CounterCell {
  const found = cells.find(each => each.key === key);
  if (found === undefined) throw new Error(`no ${key} cell`);
  return found;
}

const PASSES = { mean: 5.6, max: 7, stencil: null };
const DRAWS = { mean: 211.6, max: 240 };

describe("counterCells", () => {
  it("the drawn / loop cell reads 54 / 60 @120 (3 + 3 cells, no separate rate cell)", () => {
    const second = secondOf(
      { rate: { fps: 120, mode: "auto", reason: "start", displayHz: 120, switches: 0 } },
      { passes: PASSES, draws: DRAWS }
    );
    const cells = counterCells(second, 6.1, false, true);
    expect(cells.map(each => each.key)).toEqual([
      "fps",
      "p90",
      "gpu",
      "passes",
      "draws",
      "texture"
    ]);
    expect(cells.map(each => each.span)).toEqual([4, 4, 4, 3, 3, 6]);
    expect(cell(cells, "fps")).toMatchObject({ value: "54 / 60", unit: "fps" });
    expect(cell(cells, "fps").rate).toEqual({
      text: "@120",
      caution: false,
      title: "120 fps, auto; display 120 Hz"
    });
    expect(cell(cells, "passes").value).toBe("6");
    expect(cell(cells, "draws").value).toBe("212");
    const compact = counterCells(second, 6.1, true, true);
    expect(compact.map(each => each.key)).toEqual(["fps", "p90", "gpu"]);
    expect(cell(compact, "fps").rate?.text).toBe("@120");
  });

  it("the compact card clips 57 / 58 @60 fps (there the suffix rides the label line)", () => {
    const second = secondOf({
      fps: { loop: 58, drawn: 57 },
      rate: { fps: 60, mode: "auto", reason: "missed", displayHz: 120, switches: 1 }
    });
    expect(cell(counterCells(second, 6, true, true), "fps")).toMatchObject({
      label: "fps",
      value: "57 / 58",
      unit: "",
      ratePlace: "label",
      title: "drawn / loop · 60 fps, auto (missed); display 120 Hz",
      rate: { text: "@60", caution: true }
    });
    expect(cell(counterCells(second, 6, false, true), "fps")).toMatchObject({
      label: "drawn / loop",
      title: "60 fps, auto (missed); display 120 Hz"
    });
    const unknown = secondOf({
      rate: { fps: null, mode: null, reason: null, displayHz: null, switches: 0 }
    });
    expect(cell(counterCells(unknown, 6, true, true), "fps").title).toBe("drawn / loop");
    expect(cell(counterCells(second, 6, false, true), "fps").ratePlace).toBe("value");
    expect(cell(counterCells(second, undefined, false, false), "fps").ratePlace).toBe("value");
  });

  it("the @ suffix shows the display Hz instead of the loop's rate", () => {
    const second = secondOf({
      rate: { fps: 60, mode: "auto", reason: "missed", displayHz: 120, switches: 1 }
    });
    expect(rateSuffix(second.rate)?.text).toBe("@60");
  });

  it("a fall back to 60 under auto is not amber (the suffix is; the mode is in the title)", () => {
    const fell = rateSuffix({
      fps: 60,
      mode: "auto",
      reason: "missed",
      displayHz: 120,
      switches: 1
    });
    expect(fell).toEqual({
      text: "@60",
      caution: true,
      title: "60 fps, auto (missed); display 120 Hz"
    });
    const fixed = rateSuffix({
      fps: 60,
      mode: "fixed",
      reason: "start",
      displayHz: 120,
      switches: 0
    });
    expect(fixed?.caution).toBe(false);
    expect(cell(counterCells(secondOf(), undefined, false, true), "fps").caution).toBe(false);
  });

  it("an unknown rate prints '@null' (no suffix)", () => {
    expect(
      rateSuffix({ fps: null, mode: null, reason: null, displayHz: null, switches: 0 })
    ).toBeUndefined();
    expect(rateSuffix({ fps: 60, mode: null, reason: null, displayHz: null, switches: 0 })).toEqual(
      {
        text: "@60",
        caution: false,
        title: "60 fps"
      }
    );
  });

  it("p90 under budget is amber (only over the frame's budget)", () => {
    const under = counterCells(
      secondOf({}, { gapMs: { p50: 9, p90: 12, p99: 14 } }),
      1,
      false,
      true
    );
    expect(cell(under, "p90")).toMatchObject({ value: "12.0", unit: "ms", caution: false });
    const over = counterCells(
      secondOf({}, { gapMs: { p50: 9, p90: 18.2, p99: 20 } }),
      1,
      false,
      true
    );
    expect(cell(over, "p90")).toMatchObject({ value: "18.2", caution: true });
  });

  it("p90 of 12 ms at 120 fps is cyan (the 8.3 ms budget makes it amber)", () => {
    const second = secondOf({ budgetMs: 8.33 }, { gapMs: { p50: 9, p90: 12, p99: 14 } });
    expect(cell(counterCells(second, 1, false, true), "p90").caution).toBe(true);
  });

  it("a null GPU time shows 0.0 (it shows — no timer)", () => {
    expect(cell(counterCells(secondOf(), undefined, false, true), "gpu")).toMatchObject({
      value: "—",
      unit: "no timer"
    });
    expect(cell(counterCells(secondOf(), 6.06, false, true), "gpu")).toMatchObject({
      value: "6.1",
      unit: "ms"
    });
  });

  it("passes and draws read — with a reason when the sample has none", () => {
    const cells = counterCells(secondOf(), 1, false, true);
    expect(cell(cells, "passes")).toMatchObject({ value: "—", unit: "" });
    expect(cell(cells, "draws")).toMatchObject({ value: "—", unit: "on WebGL" });
  });

  it("the P9 row keeps passes and draws (it shows device and heap)", () => {
    const second = secondOf(
      {
        device: {
          userAgent:
            "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
          model: "iPhone 15",
          modelFrom: "shell",
          webview: null,
          cores: 6,
          memoryGb: 6
        }
      },
      { heapMb: null }
    );
    const cells = counterCells(second, undefined, false, false);
    expect(cells.map(each => each.key)).toEqual(["fps", "p90", "gpu", "device", "heap"]);
    expect(cell(cells, "device")).toMatchObject({
      label: "device, iOS 18, WebKit",
      value: "iPhone 15",
      span: 6
    });
    expect(cell(cells, "heap")).toMatchObject({ value: "—", unit: "not in WebKit", span: 6 });
  });

  it("the P9 row loses the rate suffix (it keeps it)", () => {
    const second = secondOf({
      rate: { fps: 60, mode: "fixed", reason: "start", displayHz: 60, switches: 0 }
    });
    expect(cell(counterCells(second, undefined, false, false), "fps").rate?.text).toBe("@60");
  });

  it("the texture counter's kept reads sample.textures.kept (0) while render.kept.mb is 1.4", () => {
    const second = secondOf(
      {
        render: {
          passesMax: 3,
          kept: { pictures: 1, mb: 1.4, retakes: 0 },
          redraws: 0,
          rebuilds: 0
        }
      },
      { textures: { count: 9, mb: 128, art: 96.2, targets: 32, kept: 0 } }
    );
    expect(cell(counterCells(second, 1, false, true), "texture")).toMatchObject({
      label: "texture art / targets / kept",
      value: "96 / 32 / 1",
      unit: "MB"
    });
  });

  it("a null render.kept prints NaN (it falls back to the sample)", () => {
    const second = secondOf(
      { render: { passesMax: null, kept: null, redraws: null, rebuilds: null } },
      { textures: { count: 9, mb: 128, art: 96, targets: 32, kept: 2 } }
    );
    expect(cell(counterCells(second, 1, false, true), "texture").value).toBe("96 / 32 / 2");
    expect(cell(counterCells(secondOf({ render: null }), 1, false, true), "texture").value).toBe(
      "32 / 10 / 0"
    );
  });

  it("reads — everywhere before the first sample", () => {
    const cells = counterCells(secondOf({}, null), 1, false, true);
    expect(cell(cells, "p90").value).toBe("—");
    expect(cell(cells, "texture").value).toBe("—");
  });
});

describe("moreParts", () => {
  it("a null heap prints NaN MB (it prints — not in WebKit)", () => {
    expect(moreText(moreParts(secondOf({}, { heapMb: null }), false))).toContain(
      "heap — not in WebKit"
    );
    expect(moreText(moreParts(secondOf(), false))).toContain("heap 151 MB");
  });

  it("kept pictures and retakes are missing from More", () => {
    expect(moreText(moreParts(secondOf(), false))).toContain("kept 4 pictures, 0 retakes");
    const old = secondOf({
      render: { passesMax: null, kept: null, redraws: null, rebuilds: null }
    });
    expect(moreText(moreParts(old, false))).toContain("kept — engine without kept pictures");
  });

  it("a production build prints redraws 0 (null redraws / rebuilds read dev builds only)", () => {
    const production = secondOf({
      render: {
        passesMax: 2,
        kept: { pictures: 0, mb: 0, retakes: 0 },
        redraws: null,
        rebuilds: null
      }
    });
    const text = moreText(moreParts(production, false));
    expect(text).toContain("redraws — dev builds only");
    expect(text).toContain("rebuilds — dev builds only");
    expect(moreText(moreParts(secondOf(), false))).toContain("redraws 0 · rebuilds 0");
  });

  it("passes max is left out", () => {
    expect(moreText(moreParts(secondOf(), false))).toContain("passes max 3");
  });

  it("reads the screen facts and prefixes passes, draws and texture on the compact card", () => {
    const second = secondOf(
      {},
      { passes: { mean: 6, max: 7, stencil: null }, draws: { mean: 212, max: 230 } }
    );
    const text = moreText(moreParts(second, false));
    expect(text).toContain("insets t32 b24 l0 r0");
    expect(text).toContain("backend webgpu");
    expect(text).toContain("canvas 1080 × 2340, scale 2.0");
    expect(text).toContain("device SM-A266B, 60 Hz, dpr 2.81");
    expect(text).not.toContain("passes 6 ·");
    const compact = moreText(moreParts(second, true));
    expect(compact.startsWith("passes 6 · draws 212 · texture 32 / 10 / 2 MB")).toBe(true);
  });

  it("names the three slowest systems of the second", () => {
    expect(
      systemsText(
        secondOf(
          {},
          {
            systems: [
              { name: "glass", mean: 0.9, max: 1 },
              { name: "frost-apply", mean: 2.1, max: 3 },
              { name: "lens", mean: 0.2, max: 1 },
              { name: "ripple", mean: 1.4, max: 2 }
            ]
          }
        ).sample
      )
    ).toBe("frost-apply 2.1 · ripple 1.4 · glass 0.9 ms");
    expect(systemsText(null)).toBe("—");
  });
});

describe("deviceLabel, navView and framesNote", () => {
  it("names Android and the WebView", () => {
    expect(deviceLabel(secondOf().device)).toBe("Android 15, WebView 141");
    expect(deviceLabel(null)).toBe("—");
  });

  it("a selected non-spike frame shows 1/6 (it shows –/6)", () => {
    expect(navView(6, 0)).toEqual({ counter: "–/6", disabled: false });
    expect(navView(6, 5)).toEqual({ counter: "5/6", disabled: false });
    expect(navView(0, 0)).toEqual({ counter: "–/0", disabled: true });
  });

  it("names why the graph is missing", () => {
    expect(framesNote({ state: "off", reason: "no-monitor" })).toBe(
      "No frame monitor in this build. It needs @moku-labs/game with the monitor (block 2b) on a dev or debug page."
    );
    expect(framesNote({ state: "off", reason: "no-renderer" })).toBe(
      "This game has no renderer (a headless run)."
    );
    expect(framesNote({ state: "waiting" })).toBe("Waiting for the first frames.");
    expect(framesNote({ state: "on", lost: 0, gpuTimer: true })).toBeUndefined();
  });
});
