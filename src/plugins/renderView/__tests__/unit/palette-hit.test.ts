// @vitest-environment happy-dom
/* eslint-disable unicorn/no-null -- null is a value of the wire and of perf's types */
import { describe, expect, it } from "vitest";
import { appendFrames } from "../../source/contract";
import { createRenderViewState } from "../../state";
import { frameAt } from "../../timeline/hit";
import { clearLabels, createLabelCache, LABELS_MAX, labelOf, widthOf } from "../../timeline/labels";
import { framesLayout, yMaxOf } from "../../timeline/layout";
import { causeColour, readPalette } from "../../timeline/palette";
import { createPaintScene, laneColourOf, markerTime, setMarker } from "../../timeline/scene";
import { CONFIG } from "../helpers";
import { rowsOf, wireOf } from "../mission-fixtures";
import { PALETTE, recorder } from "../paint-recorder";

// ─────────────────────────────────────────────────────────────────────────────
// timeline/palette.ts, hit.ts, labels.ts and scene.ts (spec 09 § M8, M11): the
// colours of the theme, the frame under a pointer, the bounded caches and the
// lane's colours.
// ─────────────────────────────────────────────────────────────────────────────

describe("readPalette", () => {
  it("resolves a defined token to its colour; an undefined one falls back to a visible grey, never an empty fillStyle; the probe goes", () => {
    // Bug: a canvas painted black (an empty colour string) where a token is missing.
    const root = document.createElement("div");
    root.style.setProperty("--teal", "rgb(1, 2, 3)");
    root.style.setProperty("--color-pick-pink", "rgb(4, 5, 6)");
    document.body.append(root);

    const palette = readPalette(root);

    expect(palette.teal).toBe("rgb(1, 2, 3)");
    expect(palette.pickPink).toBe("rgb(4, 5, 6)");
    expect(palette.ink).toBe("rgb(128, 128, 128)");
    expect(root.children).toHaveLength(0);
    expect(causeColour(PALETTE, 1)).toBe("pickPink");
    expect(causeColour(PALETTE, 5)).toBe("warn");
    expect(causeColour(PALETTE, 0)).toBe("muted");
  });
});

describe("frameAt", () => {
  it("answers the frame under the pointer; outside the plot or over a gap nothing", () => {
    // Bug: a click on an empty stretch selecting a frame seconds away.
    const { mission } = createRenderViewState({ config: CONFIG });
    appendFrames(
      mission.history,
      wireOf([...rowsOf(1, 60, { t0: 10_000 }), ...rowsOf(61, 60, { t0: 14_000 })])
    );
    const layout = framesLayout(650, 262, 1);

    expect(frameAt(mission.history, layout, 50, 10_000, 6000)).toBe(30);
    expect(frameAt(mission.history, layout, 700, 10_000, 6000)).toBeUndefined();
    expect(frameAt(mission.history, layout, 300, 10_000, 6000)).toBeUndefined();
    expect(frameAt(mission.history, layout, 410, 10_000, 6000)).toBe(66);
    expect(frameAt(mission.history, layout, 2, 20_000, 6000)).toBeUndefined();
  });
});

/**
 * An axis label of a value.
 *
 * @param value - Seconds.
 * @returns The label.
 */
function make(value: number): string {
  return `−${value} s`;
}

describe("label caches", () => {
  it("build a label once and start over past LABELS_MAX (a long session does not grow them)", () => {
    // Bug: one cached string per value forever: the tools page grows for hours.
    const labels = createLabelCache();
    expect(labelOf(labels.axis, 5, 5, make)).toBe("−5 s");
    expect(labelOf(labels.axis, 5, 6, make)).toBe("−5 s");
    for (let key = 0; key < LABELS_MAX + 10; key += 1) labelOf(labels.axis, key, key, make);
    expect(labels.axis.size).toBeLessThanOrEqual(LABELS_MAX);

    const { g, measures } = recorder();
    widthOf(labels, g, "mono500", "GC 4.2 MB");
    widthOf(labels, g, "mono500", "GC 4.2 MB");
    expect(measures()).toBe(1);
    for (let index = 0; index < LABELS_MAX + 10; index += 1)
      widthOf(labels, g, "mono500", `t${index}`);
    expect(labels.widths.mono500.size).toBeLessThanOrEqual(LABELS_MAX);
  });
});

describe("the scene", () => {
  it("gives main the first lane colour and the other views the next ones by first appearance", () => {
    // Bug: the same pass in two colours on two frames, or main coloured like a filter.
    const scene = createPaintScene(PALETTE);
    expect(laneColourOf(scene, "fogLayer")).toBe("pickPink");
    expect(laneColourOf(scene, "main")).toBe("phase1");
    expect(laneColourOf(scene, "hud")).toBe("phase2");
    expect(laneColourOf(scene, "fogLayer")).toBe("pickPink");
  });

  it("places a marker with the offset, else at the first row, else nowhere; a marker without ' · ' keeps its words", () => {
    // Bug: a marker drawn at 0 (the left edge) before any row of the new source arrived.
    const marker = {
      at: 1_792_000_093_963,
      kind: "user" as const,
      label: "Switched to Galaxy A26",
      device: null
    };
    expect(markerTime(marker, 0, 1_792_000_000_000, undefined)).toBe(93_963);
    expect(Number.isNaN(markerTime(marker, null, null, undefined))).toBe(true);
    const scene = createPaintScene(PALETTE);
    setMarker(scene, marker, 5, undefined);
    expect([scene.markerLeft, scene.markerRight, scene.markerBefore]).toEqual([
      "Switched to Galaxy A26",
      "",
      ""
    ]);
    setMarker(scene, undefined, 0, undefined);
    expect(Number.isNaN(scene.markerT)).toBe(true);
  });
});

describe("scale and caches", () => {
  it("the timeline's scale follows the newest awake budget: 20 ms at 120 fps, 36 at 60, 72 below", () => {
    // Bug: a 30 fps game's 33 ms frames clipped at the top of a 60 fps scale.
    expect(yMaxOf(8.33)).toBe(20);
    expect(yMaxOf(8.5)).toBe(36);
    expect(yMaxOf(16.7)).toBe(36);
    expect(yMaxOf(33.3)).toBe(72);
  });

  it("a source switch forgets the chips keyed by event seq (the new source's seqs start over)", () => {
    // Bug: the old source's "120 → 60" chip drawn for the new source's event with the same seq.
    const labels = createLabelCache();
    labelOf(labels.event, 3, "120 → 60, missed frames", text => text);
    labelOf(labels.flag, 1, "JS 22 ms", text => text);
    clearLabels(labels);
    expect(labelOf(labels.event, 3, "60 → 120, back on time", text => text)).toBe(
      "60 → 120, back on time"
    );
    expect(labels.flag.size).toBe(0);
  });
});
