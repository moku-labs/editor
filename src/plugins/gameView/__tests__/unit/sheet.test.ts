import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  closeSheetLayer,
  openSheet,
  seriesIndexOf,
  showShot,
  stepSheet,
  toggleBug
} from "../../capture/sheet";
import type { SeriesIndex } from "../../types";
import { conflict } from "../files-store";
import { createCtx, PNG, type TestCtx } from "../helpers";

const FOLDER = ".moku/captures/series-2026-09-24-1015/";
const INDEX_PATH = `${FOLDER}index.json`;
const INDEX: SeriesIndex = {
  label: "merge refused shake",
  durationMs: 200,
  intervalMs: 50,
  fromFrame: 1777,
  shots: [
    { file: "001.png", frame: 1777, atMs: 0, bug: false },
    { file: "002.png", frame: 1780, atMs: 50, bug: false },
    { file: "003.png", frame: 1783, atMs: 100, bug: false }
  ]
};

let ctx: TestCtx;

beforeEach(async () => {
  vi.useFakeTimers();
  ctx = createCtx({ [INDEX_PATH]: JSON.stringify(INDEX) });
  await ctx.link.files.writeBinary(`${FOLDER}001.png`, PNG);
  await ctx.link.files.writeBinary(`${FOLDER}003.png`, `${PNG}#3`);
  ctx.link.files.writes.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("openSheet", () => {
  it("reads index.json, then every PNG with readBinary; a missing file is a placeholder", async () => {
    const readBinary = vi.spyOn(ctx.link.files, "readBinary");
    await openSheet(ctx, INDEX_PATH);

    expect(ctx.workspace.show).toHaveBeenCalledWith("game");
    expect(readBinary.mock.calls.map(call => call[0])).toEqual([
      `${FOLDER}001.png`,
      `${FOLDER}002.png`,
      `${FOLDER}003.png`
    ]);
    expect(ctx.state.series.sheet).toEqual({
      indexPath: INDEX_PATH,
      index: INDEX,
      images: [PNG, undefined, `${PNG}#3`],
      version: ctx.link.files.version(INDEX_PATH),
      big: undefined
    });
  });

  it("toasts an index it cannot read", async () => {
    ctx.link.files.put(INDEX_PATH, "{ nope");
    await openSheet(ctx, INDEX_PATH);
    expect(ctx.state.series.sheet).toBeUndefined();
    expect(ctx.workspace.toast).toHaveBeenCalledWith(
      expect.stringMatching(/^Contact sheet not readable · /)
    );
  });

  it("toasts a JSON file that is not a series index", async () => {
    ctx.link.files.put(INDEX_PATH, JSON.stringify({ label: 1 }));
    await openSheet(ctx, INDEX_PATH);
    expect(ctx.state.series.sheet).toBeUndefined();
    expect(ctx.workspace.toast).toHaveBeenCalledWith(
      `Contact sheet not readable · ${INDEX_PATH} is not a series index.`
    );
  });
});

describe("marking bugs", () => {
  it("flips the shot and saves index.json once per burst, 400 ms after the last toggle", async () => {
    await openSheet(ctx, INDEX_PATH);
    const version = ctx.state.series.sheet?.version;

    toggleBug(ctx, 0);
    await vi.advanceTimersByTimeAsync(300);
    toggleBug(ctx, 1);
    toggleBug(ctx, 0);
    await vi.advanceTimersByTimeAsync(399);
    expect(ctx.link.files.writes).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);

    expect(ctx.link.files.writes).toEqual([{ path: INDEX_PATH, kind: "text" }]);
    const saved: SeriesIndex = JSON.parse(ctx.link.files.text(INDEX_PATH));
    expect(saved.shots.map(shot => shot.bug)).toEqual([false, true, false]);
    expect(ctx.state.series.sheet?.version).not.toBe(version);
    expect(ctx.state.series.sheet?.version).toBe(ctx.link.files.version(INDEX_PATH));
    expect(ctx.workspace.toast).toHaveBeenCalledWith("✓ Saved", INDEX_PATH);
  });

  it("toasts a conflict and keeps the marks", async () => {
    await openSheet(ctx, INDEX_PATH);
    ctx.link.files.failWrites(INDEX_PATH, conflict(INDEX_PATH));
    toggleBug(ctx, 2);
    await vi.advanceTimersByTimeAsync(400);
    expect(ctx.workspace.toast).toHaveBeenCalledWith(`Save failed · ${INDEX_PATH} changed on disk`);
    expect(ctx.state.series.sheet?.index.shots[2]?.bug).toBe(true);
  });

  it("ignores a shot that does not exist or a closed sheet", () => {
    toggleBug(ctx, 0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("stepping and closing", () => {
  it("opens the large view on the first step and steps, clamped at the ends", async () => {
    await openSheet(ctx, INDEX_PATH);
    stepSheet(ctx, 1);
    expect(ctx.state.series.sheet?.big).toBe(0);
    stepSheet(ctx, -1);
    expect(ctx.state.series.sheet?.big).toBe(0);
    showShot(ctx, 2);
    stepSheet(ctx, 1);
    expect(ctx.state.series.sheet?.big).toBe(2);
    stepSheet(ctx, -1);
    expect(ctx.state.series.sheet?.big).toBe(1);
  });

  it("the first back step from the grid opens the last shot", async () => {
    await openSheet(ctx, INDEX_PATH);
    stepSheet(ctx, -1);
    expect(ctx.state.series.sheet?.big).toBe(2);
  });

  it("Esc closes the large view first, then the sheet; false when nothing is open", async () => {
    expect(closeSheetLayer(ctx)).toBe(false);
    await openSheet(ctx, INDEX_PATH);
    showShot(ctx, 1);

    expect(closeSheetLayer(ctx)).toBe(true);
    expect(ctx.state.series.sheet?.big).toBeUndefined();
    expect(closeSheetLayer(ctx)).toBe(true);
    expect(ctx.state.series.sheet).toBeUndefined();
  });

  it("closing the sheet saves pending marks at once", async () => {
    await openSheet(ctx, INDEX_PATH);
    toggleBug(ctx, 1);
    closeSheetLayer(ctx);
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.link.files.writes).toEqual([{ path: INDEX_PATH, kind: "text" }]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("seriesIndexOf", () => {
  it("reads the index shape; bug defaults to false; device and stoppedEarly are kept", () => {
    expect(
      seriesIndexOf({
        label: "a",
        durationMs: 1,
        intervalMs: 1,
        fromFrame: 0,
        shots: [{ file: "001.png", frame: 0, atMs: 0 }],
        device: { name: "iPhone 15", w: 393, h: 852, orientation: "portrait" },
        stoppedEarly: true
      })
    ).toEqual({
      label: "a",
      durationMs: 1,
      intervalMs: 1,
      fromFrame: 0,
      shots: [{ file: "001.png", frame: 0, atMs: 0, bug: false }],
      device: { name: "iPhone 15", w: 393, h: 852, orientation: "portrait" },
      stoppedEarly: true
    });
  });

  it("is undefined for anything else", () => {
    expect(seriesIndexOf([])).toBeUndefined();
    expect(seriesIndexOf({ ...INDEX, shots: [{ file: 3 }] })).toBeUndefined();
    expect(seriesIndexOf({ ...INDEX, durationMs: "1" })).toBeUndefined();
  });
});
