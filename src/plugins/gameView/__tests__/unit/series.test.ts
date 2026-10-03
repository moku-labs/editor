import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Json, RunResult } from "../../../registry/protocol";
import { errorCode, wireError } from "../../../registry/protocol";
import { recordSeries, setPopover, stopRecording } from "../../capture/series";
import type { SeriesIndex } from "../../types";
import { createCtx, flush, manifestOf, PNG, resultOf, type TestCtx, useScene } from "../helpers";

const FOLDER = ".moku/captures/series-2026-09-24-1015/";
const INDEX = `${FOLDER}index.json`;
const DEVICE = { w: 393, h: 852, orientation: "portrait" } as const;

/**
 * The value of editor.series with n shots.
 *
 * @param count - Shots.
 * @returns The value.
 */
function seriesValue(count: number): Json {
  return {
    shots: Array.from({ length: count }, (_, index) => ({
      image: `${PNG}#${index}`,
      frame: 1777 + index * 3,
      atMs: index * 50
    })),
    device: DEVICE
  };
}

let ctx: TestCtx;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 24, 10, 15));
  ctx = createCtx();
  useScene(ctx);
  ctx.panels.answers.set("editor.series", seriesValue(4));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("recordSeries", () => {
  it("makes one editor.series call through panels.run with the chosen input", async () => {
    await recordSeries(ctx, { durationMs: 200, intervalMs: 50 });

    expect(ctx.panels.run.mock.calls).toEqual([
      ["editor.series", { durationMs: 200, intervalMs: 50 }]
    ]);
    expect(ctx.link.run).not.toHaveBeenCalled();
    expect(ctx.workspace.show).toHaveBeenCalledWith("game");
  });

  it("writes 001.png…004.png in order, then index.json with the exact shape", async () => {
    const result = await recordSeries(ctx, { durationMs: 200, intervalMs: 50 });

    expect(result).toEqual({ folder: FOLDER, indexPath: INDEX, shots: 4 });
    expect(ctx.link.files.writes.map(write => write.path)).toEqual([
      `${FOLDER}001.png`,
      `${FOLDER}002.png`,
      `${FOLDER}003.png`,
      `${FOLDER}004.png`,
      INDEX
    ]);
    expect(ctx.link.files.dataUrl(`${FOLDER}003.png`)).toBe(`${PNG}#2`);
    const index: SeriesIndex = JSON.parse(ctx.link.files.text(INDEX));
    expect(index).toEqual({
      label: "board/awaitIntent",
      durationMs: 200,
      intervalMs: 50,
      fromFrame: 1777,
      shots: [
        { file: "001.png", frame: 1777, atMs: 0, bug: false },
        { file: "002.png", frame: 1780, atMs: 50, bug: false },
        { file: "003.png", frame: 1783, atMs: 100, bug: false },
        { file: "004.png", frame: 1786, atMs: 150, bug: false }
      ],
      device: { name: "iPhone 15", w: 393, h: 852, orientation: "portrait" }
    });
    expect(ctx.workspace.toast).toHaveBeenCalledWith("✓ 4 shots saved", FOLDER);
  });

  it("opens the contact sheet with the in-memory images", async () => {
    await recordSeries(ctx, { durationMs: 200, intervalMs: 50, label: "merge refused shake" });

    const sheet = ctx.state.series.sheet;
    expect(sheet?.indexPath).toBe(INDEX);
    expect(sheet?.index.label).toBe("merge refused shake");
    expect(sheet?.images).toHaveLength(4);
    expect(sheet?.version).toBe(ctx.link.files.version(INDEX));
    expect(ctx.state.series.recording).toBeUndefined();
    expect(ctx.state.series.popover).toBe(false);
  });

  it("shows the recording while the call runs, then the writing phase", async () => {
    const { promise, resolve } = Promise.withResolvers<RunResult>();
    ctx.panels.answers.set("editor.series", () => promise);
    const pending = recordSeries(ctx, { durationMs: 2000, intervalMs: 100 });
    await flush();

    expect(ctx.state.series.recording).toMatchObject({
      folder: FOLDER,
      planned: 20,
      phase: "recording",
      written: 0,
      stopRequested: false
    });
    expect(ctx.state.series.durationMs).toBe(2000);
    resolve(resultOf(seriesValue(2)));
    await pending;
    expect(ctx.state.series.recording).toBeUndefined();
  });

  it("stopSeries runs editor.seriesStop; the index gets stoppedEarly and the elapsed length", async () => {
    const { promise, resolve } = Promise.withResolvers<RunResult>();
    ctx.panels.answers.set("editor.series", () => promise);
    ctx.panels.answers.set("editor.seriesStop", { stopped: true });
    const pending = recordSeries(ctx, { durationMs: 20_000, intervalMs: 100 });
    await flush();
    await vi.advanceTimersByTimeAsync(1500);

    stopRecording(ctx);
    expect(ctx.panels.run).toHaveBeenCalledWith("editor.seriesStop");
    expect(ctx.state.series.recording?.stopRequested).toBe(true);
    resolve(resultOf(seriesValue(2)));
    await pending;

    const index: SeriesIndex = JSON.parse(ctx.link.files.text(INDEX));
    expect(index.stoppedEarly).toBe(true);
    expect(index.durationMs).toBe(1500);
    expect(index.shots).toHaveLength(2);
  });

  it("a failed call writes nothing and toasts the bare message", async () => {
    ctx.panels.answers.set(
      "editor.series",
      wireError(errorCode.gameReloaded, "[moku-editor] The game page reloaded.", {
        reason: "game_reloaded",
        retryable: true
      })
    );

    expect(await recordSeries(ctx, { durationMs: 200, intervalMs: 50 })).toBeUndefined();
    expect(ctx.link.files.writes).toEqual([]);
    expect(ctx.workspace.toast).toHaveBeenCalledWith("Series failed · The game page reloaded.");
    expect(ctx.log.warn).toHaveBeenCalledWith(
      "gameView: series failed",
      expect.objectContaining({ code: -32_001 })
    );
    expect(ctx.state.series.recording).toBeUndefined();
  });

  it("a value of the wrong shape counts as a failed call", async () => {
    ctx.panels.answers.set("editor.series", { shots: "nope" });
    expect(await recordSeries(ctx, { durationMs: 200, intervalMs: 50 })).toBeUndefined();
    expect(ctx.link.files.writes).toEqual([]);
  });

  it("a failed PNG write stops, writes a partial index with stoppedEarly and toasts", async () => {
    ctx.link.files.failWrites(
      `${FOLDER}003.png`,
      wireError(errorCode.forbiddenPath, "[moku-editor] Disk full.", { reason: "forbidden_path" })
    );

    const result = await recordSeries(ctx, { durationMs: 200, intervalMs: 50 });

    expect(result?.shots).toBe(2);
    const index: SeriesIndex = JSON.parse(ctx.link.files.text(INDEX));
    expect(index.shots.map(shot => shot.file)).toEqual(["001.png", "002.png"]);
    expect(index.stoppedEarly).toBe(true);
    expect(ctx.workspace.toast).toHaveBeenCalledWith("Series not fully saved · Disk full.");
  });

  it("refuses while another series runs", async () => {
    const { promise, resolve } = Promise.withResolvers<RunResult>();
    ctx.panels.answers.set("editor.series", () => promise);
    const first = recordSeries(ctx, { durationMs: 200, intervalMs: 50 });
    await flush();

    expect(await recordSeries(ctx, { durationMs: 200, intervalMs: 50 })).toBeUndefined();
    expect(ctx.workspace.toast).toHaveBeenCalledWith("A series is already recording.");
    resolve(resultOf(seriesValue(1)));
    await first;
    expect(ctx.panels.run.mock.calls.filter(call => call[0] === "editor.series")).toHaveLength(1);
  });

  it("refuses without a game or without editor.series", async () => {
    ctx.link.manifestValue = manifestOf([["editor.capture", "read"]]);
    expect(await recordSeries(ctx, { durationMs: 200, intervalMs: 50 })).toBeUndefined();
    ctx.link.manifestValue = manifestOf();
    ctx.link.current = { kind: "empty" };
    expect(await recordSeries(ctx, { durationMs: 200, intervalMs: 50 })).toBeUndefined();
    expect(ctx.panels.run).not.toHaveBeenCalled();
  });

  it("uses the next folder name when the minute is taken", async () => {
    ctx.link.files.put(`${FOLDER}index.json`, "{}");
    const result = await recordSeries(ctx, { durationMs: 200, intervalMs: 50 });
    expect(result?.folder).toBe(".moku/captures/series-2026-09-24-1015-2/");
  });
});

describe("stopRecording and setPopover", () => {
  it("still asks the game to stop when nothing records here, and logs a failure", async () => {
    ctx.panels.answers.set(
      "editor.seriesStop",
      wireError(errorCode.noSession, "[moku-editor] No game session.", { reason: "no_session" })
    );
    stopRecording(ctx);
    await flush();
    expect(ctx.panels.run).toHaveBeenCalledWith("editor.seriesStop");
    expect(ctx.log.warn).toHaveBeenCalledWith("gameView: series stop failed", {
      error: expect.objectContaining({
        code: errorCode.noSession,
        message: "[moku-editor] No game session."
      })
    });
  });

  it("opens and closes the popover; closing tells whether it was open", () => {
    expect(setPopover(ctx, true)).toBe(true);
    expect(ctx.state.series.popover).toBe(true);
    expect(setPopover(ctx, false)).toBe(true);
    expect(setPopover(ctx, false)).toBe(false);
  });
});
