// @vitest-environment happy-dom
/* eslint-disable unicorn/no-null -- null is a JSON value */
import { afterEach, describe, expect, it, vi } from "vitest";
import { errorCode, wireError } from "../../../registry/protocol";
import { recordSeries, seriesValueOf } from "../../capture/series";
import { openSheet, seriesIndexOf, showShot, stepSheet } from "../../capture/sheet";
import { deviceOf, shotOf } from "../../capture/shot";
import { hasCommand } from "../../commands";
import { highlightElement, hoverAt, selectElement } from "../../element/select";
import { importCandidates, styleInRange } from "../../element/source";
import { openStyleCard, stepStyle } from "../../element/styles";
import { stopGameView } from "../../lifecycle";
import { chooseDevice } from "../../palette";
import { messageOf, uiMessage } from "../../report";
import { calibrate, pageRectOf } from "../../scene/calibrate";
import { frameOf } from "../../scene/rebuild";
import { reloadGame } from "../../stage/reload";
import { answer, createCtx, flush, place, type TestCtx, useScene } from "../helpers";
import { boardScene } from "../ui";

// ─────────────────────────────────────────────────────────────────────────────
// Edge branches of the domain modules: unusual values, failures and the paths a
// normal flow does not take.
// ─────────────────────────────────────────────────────────────────────────────

let ctx: TestCtx | undefined;

afterEach(() => {
  if (ctx !== undefined) stopGameView(ctx);
  ctx = undefined;
  vi.restoreAllMocks();
});

describe("report", () => {
  it("reads the message of an Error, a wire-error object and anything else", () => {
    expect(messageOf(new Error("boom"))).toBe("boom");
    expect(messageOf({ code: -32_000, message: "[moku-editor] door threw" })).toBe(
      "[moku-editor] door threw"
    );
    expect(messageOf(42)).toBe("42");
    expect(uiMessage(new Error("[moku-editor] A is invalid.\n  Use B."))).toBe("A is invalid.");
  });
});

describe("value readers", () => {
  it("pageRectOf reads a rect and refuses anything else", () => {
    expect(pageRectOf({ x: 1, y: 2, w: 3, h: 4 })).toEqual({ x: 1, y: 2, w: 3, h: 4 });
    expect(pageRectOf({ x: 1, y: 2, w: 3 })).toBeUndefined();
    expect(pageRectOf(null)).toBeUndefined();
  });

  it("frameOf follows the status kinds", () => {
    expect(frameOf({ kind: "silent", since: 1, lastFrame: 7 }, 0)).toBe(7);
    expect(frameOf({ kind: "lost", reason: "x", lastFrame: 8, retryInMs: 1 }, 0)).toBe(8);
    expect(frameOf({ kind: "connecting" }, 3)).toBe(3);
  });

  it("shot, device and series readers refuse other shapes", () => {
    expect(deviceOf({ w: 1, h: 1, orientation: "upside" })).toBeUndefined();
    expect(deviceOf("x")).toBeUndefined();
    expect(shotOf({ image: "a", frame: 1, device: null })).toBeUndefined();
    expect(
      seriesValueOf({ shots: ["x"], device: { w: 1, h: 1, orientation: "portrait" } })
    ).toBeUndefined();
    expect(
      seriesValueOf({
        shots: [{ image: "a", frame: 1 }],
        device: { w: 1, h: 1, orientation: "portrait" }
      })
    ).toBeUndefined();
    expect(hasCommand(undefined, "editor.capture")).toBe(false);
  });

  it("seriesIndexOf drops a device of the wrong shape", () => {
    const base = { label: "a", durationMs: 1, intervalMs: 1, fromFrame: 0, shots: [] };
    expect(
      seriesIndexOf({ ...base, device: { name: "x", w: 1, h: 1, orientation: "flat" } })
    ).toEqual(base);
    expect(seriesIndexOf({ ...base, device: { name: 1 } })).toEqual(base);
    expect(seriesIndexOf({ ...base, device: "phone" })).toEqual(base);
  });

  it("styleInRange and importCandidates handle the edges", () => {
    expect(styleInRange([], [1, 1, 1, 2])).toBeUndefined();
    expect(styleInRange(['<A key="a" style />'], [1, 1, 1, 20])).toBeUndefined();
    expect(importCandidates('import type { a } from "./styles";', "a", "Hud.tsx")).toEqual([
      "styles.ts",
      "styles.tsx",
      "styles/index.ts",
      "styles/index.tsx"
    ]);
  });
});

describe("failure paths", () => {
  it("calibrate does nothing without a ui value", async () => {
    ctx = createCtx();
    await calibrate(ctx);
    expect(ctx.state.calibrationRead).toBe(false);
  });

  it("reloadGame logs a rejected reload", async () => {
    ctx = createCtx();
    ctx.workspace.reload.mockRejectedValueOnce(new Error("frame gone"));
    await reloadGame(ctx, { restore: false });
    expect(ctx.log.warn).toHaveBeenCalledWith("gameView: reload failed", { message: "frame gone" });
  });

  it("chooseDevice ignores an unknown preset", () => {
    ctx = createCtx();
    chooseDevice(ctx, "nope");
    expect(ctx.workspace.api.setDevice).not.toHaveBeenCalled();
  });

  it("openStyleCard logs a failing load and reports missing", async () => {
    ctx = createCtx({ "src/Hud.tsx": '<Pill key="coinPill" style={coinPill} />' });
    answer(ctx, "jsx:coinPill", place("src/Hud.tsx", [1, 1, 1, 42], { hash: "v-src/Hud.tsx" }));
    ctx.state.scene = boardScene();
    const ref = { kind: "ui", path: "boardScreen/hudRow/coinPill" } as const;
    ctx.state.selected = ref;
    const read = vi.spyOn(ctx.link.files, "read");
    read.mockImplementation(path =>
      read.mock.calls.length > 1
        ? Promise.reject(wireError(errorCode.commandFailed, "[moku-editor] disk"))
        : Promise.resolve({
            text: '<Pill key="coinPill" style={coinPill} />',
            version: `v-${path}`
          })
    );
    await openStyleCard(ctx, ref);
    expect(ctx.state.lookup).toEqual({ key: "coinPill", status: "missing" });
    expect(ctx.log.warn).toHaveBeenCalledWith("gameView: style search failed", {
      key: "coinPill",
      message: "[moku-editor] disk"
    });
  });

  it("select saves a pending style edit before it clears the card", async () => {
    ctx = createCtx({
      "src/Hud.tsx":
        '<Pill key="coinPill" style={coinPill} />\nconst coinPill = defineStyle({\n  height: 76\n});\n'
    });
    answer(ctx, "jsx:coinPill", place("src/Hud.tsx", [1, 1, 1, 42]));
    ctx.state.scene = boardScene();
    const ref = { kind: "ui", path: "boardScreen/hudRow/coinPill" } as const;
    ctx.state.selected = ref;
    await openStyleCard(ctx, ref);
    stepStyle(ctx, "height", -1, false);
    selectElement(ctx, undefined);
    await flush();
    expect(ctx.link.files.text("src/Hud.tsx")).toContain("height: 75");
  });

  it("a second series call while the first reads the folder is refused", async () => {
    ctx = createCtx();
    useScene(ctx);
    ctx.panels.answers.set("editor.series", {
      shots: [],
      device: { w: 1, h: 1, orientation: "portrait" }
    });
    const first = recordSeries(ctx, { durationMs: 100, intervalMs: 50 });
    const second = recordSeries(ctx, { durationMs: 100, intervalMs: 50 });
    const results = await Promise.all([first, second]);
    expect(results.filter(result => result === undefined)).toHaveLength(1);
    expect(ctx.workspace.toast).toHaveBeenCalledWith("A series is already recording.");
  });

  it("a failed index.json write toasts and still opens the sheet", async () => {
    ctx = createCtx();
    useScene(ctx);
    ctx.panels.answers.set("editor.series", {
      shots: [],
      device: { w: 1, h: 1, orientation: "portrait" }
    });
    vi.spyOn(ctx.link.files, "write").mockRejectedValueOnce(new Error("[moku-editor] disk full"));
    const result = await recordSeries(ctx, { durationMs: 100, intervalMs: 50 });
    expect(result?.shots).toBe(0);
    expect(ctx.workspace.toast).toHaveBeenCalledWith("Series not fully saved · disk full");
    expect(ctx.state.series.sheet?.version).toBeUndefined();
  });

  it("the sheet ignores steps and shots without a sheet or shots", async () => {
    ctx = createCtx({
      "s/index.json": JSON.stringify({
        label: "a",
        durationMs: 1,
        intervalMs: 1,
        fromFrame: 0,
        shots: []
      })
    });
    stepSheet(ctx, 1);
    showShot(ctx, 0);
    await openSheet(ctx, "s/index.json");
    stepSheet(ctx, 1);
    showShot(ctx, 3);
    expect(ctx.state.series.sheet?.big).toBeUndefined();
  });

  it("highlight drops a failure of a request a newer one replaced; hover without a box finds nothing", async () => {
    ctx = createCtx();
    ctx.link.read.mockRejectedValue(new Error("offline"));
    highlightElement(ctx, { kind: "ui", path: "a" });
    highlightElement(ctx);
    await flush();
    expect(ctx.log.warn).not.toHaveBeenCalled();

    ctx.state.scene = boardScene();
    ctx.workspace.box = { left: 0, top: 0, width: 0, height: 0, scale: 0, docked: "hidden" };
    hoverAt(ctx, { x: 1, y: 1 });
    expect(ctx.state.picker.hover).toBeUndefined();
  });
});
