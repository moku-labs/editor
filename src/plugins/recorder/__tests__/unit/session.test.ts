/* eslint-disable unicorn/no-null -- null is "no label" of a log */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DISPLAY, eventLine } from "../../../../../tests/fixtures/fake-monitor";
import { logFileName } from "../../session";
import type { LogFileInfo } from "../../types";
import { engineMonitor, kinds, queued, recorder, settle, startupLine } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// Starting a log: the context lines first, the file name, a running log, no
// monitor, keepFiles.
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 14, 15, 32, 10));
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * A finished log of the memory store.
 *
 * @param name - Its name.
 * @param startedAt - Its start.
 * @returns The info.
 */
function finished(name: string, startedAt: number): LogFileInfo {
  return {
    name,
    label: null,
    startedAt,
    lines: 1,
    bytes: 2,
    sent: 0,
    current: false,
    storage: "memory"
  };
}

describe("start", () => {
  it("writes the header, the startup, the newest display, then the recorder start event (bug: a log the collector cannot read without a header)", () => {
    const t = recorder();
    const newest = { ...eventLine("display", null, DISPLAY), t: 1_760_454_003_000 };
    t.monitor.emit(startupLine());
    t.monitor.emit(eventLine("display", null, DISPLAY));
    t.monitor.emit(newest);
    const file = t.api.start({ label: "  garden, A26 " });
    const lines = queued(t.state);
    expect(kinds(lines)).toEqual(["header", "startup", "event:display", "event:recorder"]);
    expect(lines[2]).toBe(newest);
    expect(lines[3]).toMatchObject({ detail: { action: "start", label: "garden, A26" } });
    expect(file).toMatchObject({
      label: "garden, A26",
      current: true,
      lines: 0,
      storage: "memory"
    });
    expect(t.emit).toHaveBeenCalledExactlyOnceWith("recorder:status", {
      state: "recording",
      lines: 0,
      bytes: 0,
      sent: 0,
      pending: 0
    });
    expect(t.log.info).toHaveBeenCalledWith("recorder:started", {
      file: file.name,
      label: "garden, A26",
      storage: "memory"
    });
  });

  it("does not repeat a display older than the header", () => {
    const t = recorder();
    t.monitor.emit({ ...eventLine("display", null, DISPLAY), t: 1_760_453_999_000 });
    t.api.start();
    expect(kinds(queued(t.state))).toEqual(["header", "event:recorder"]);
  });

  it("names the file by the local minute and the lower-cased model, `device` without a header", () => {
    expect(recorder().api.start().name).toBe("perf-20261014-1532-sm-a266b.jsonl");
    const headless = recorder({ monitor: engineMonitor({ header: null }) }).api.start({
      label: " "
    });
    expect([headless.name, headless.label]).toEqual(["perf-20261014-1532-device.jsonl", null]);
  });

  it("adds -2, -3 before .jsonl to a name already taken, and turns every character outside [a-z0-9-] into -", () => {
    const at = new Date(2026, 9, 14, 9, 5);
    const taken = new Set(["perf-20261014-0905-pixel-8-pro.jsonl"]);
    expect(logFileName("Pixel 8/Pro", at, taken)).toBe("perf-20261014-0905-pixel-8-pro-2.jsonl");
    taken.add("perf-20261014-0905-pixel-8-pro-2.jsonl");
    expect(logFileName("Pixel 8/Pro", at, taken)).toBe("perf-20261014-0905-pixel-8-pro-3.jsonl");
    expect(logFileName("", at, new Set())).toBe("perf-20261014-0905-device.jsonl");
  });

  it("while a log runs answers that log and changes nothing", () => {
    const t = recorder();
    const first = t.api.start({ label: "first" });
    const again = t.api.start({ label: "second" });
    expect(again).toMatchObject({ name: first.name, label: "first" });
    expect(t.monitor.events.filter(event => event.name === "recorder")).toHaveLength(1);
    expect(t.api.files()).toHaveLength(1);
  });

  it("without a monitor throws a two-line Error (a lifecycle error, not a TypeError)", () => {
    const t = recorder({ monitor: false });
    const start = () => t.api.start();
    expect(start).toThrow(
      "[moku-editor] recorder.start: this game has no performance monitor.\n  Run a dev or debug build of @moku-labs/game with the monitor (block 2b)."
    );
    expect(start).not.toThrow(TypeError);
    expect(t.state.phase).toBe("idle");
  });

  it("removes the finished logs beyond keepFiles, oldest first (bug: a phone filled with old logs)", async () => {
    const t = recorder({ config: { keepFiles: 2 } });
    const old = [finished("a.jsonl", 1), finished("b.jsonl", 2), finished("c.jsonl", 3)];
    for (const info of old) await t.state.memory.append(info, "{}\n");
    t.state.files = [...old];
    const file = t.api.start();
    await settle();
    expect(t.api.files().map(info => info.name)).toEqual(["b.jsonl", "c.jsonl", file.name]);
    const kept = await t.state.memory.list();
    expect(kept.map(info => info.name)).toEqual(["b.jsonl", "c.jsonl"]);
  });
});
