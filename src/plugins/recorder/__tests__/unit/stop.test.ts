import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sampleLine } from "../../../../../tests/fixtures/fake-monitor";
import { stopRecorder } from "../../lifecycle";
import { createOpfsStore } from "../../store";
import { createFakeDirectory } from "../fake-opfs";
import { kinds, recorder, storedLines } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// Stopping a log: the stop event, the queue drained, every pending text in the
// store, the log finished; the same at onStop without emit or log.
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 14, 15, 32, 10));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("stop", () => {
  it("writes the stop event, drains the queue, stores every line, finishes the log and emits idle", async () => {
    const t = recorder();
    t.api.start();
    t.monitor.emit(sampleLine(3));
    const file = await t.api.stop();
    expect(file).toMatchObject({ current: false, lines: 4 });
    const lines = await storedLines(t.state.memory, file?.name ?? "");
    expect(kinds(lines)).toEqual(["header", "event:recorder", "sample", "event:recorder"]);
    expect(lines.at(-1)).toMatchObject({ detail: { action: "stop" } });
    expect(t.monitor.begins).toBe(t.monitor.ends);
    expect(t.api.files()).toEqual([file]);
    expect(t.emit).toHaveBeenLastCalledWith(
      "recorder:status",
      expect.objectContaining({ state: "idle", lines: 4 })
    );
    expect(t.api.status()).toMatchObject({ state: "idle", lines: 4, sinceMs: 0, file: file?.name });
    expect(t.log.info).toHaveBeenCalledWith("recorder:stopped", {
      file: file?.name,
      lines: 4,
      bytes: file?.bytes
    });
  });

  it("answers undefined while idle and emits nothing", async () => {
    const t = recorder();
    await expect(t.api.stop()).resolves.toBeUndefined();
    expect(t.emit).not.toHaveBeenCalled();
  });

  it("keeps the log in memory when the store fails at stop, and warns recorder:persist-failed", async () => {
    const root = createFakeDirectory();
    root.failWrites = 1;
    const t = recorder({ store: createOpfsStore(root) });
    t.api.start();
    const file = await t.api.stop();
    expect(file?.storage).toBe("memory");
    expect(kinds(await storedLines(t.state.memory, file?.name ?? ""))).toEqual([
      "header",
      "event:recorder",
      "event:recorder"
    ]);
    expect(t.log.warn).toHaveBeenCalledWith("recorder:persist-failed", {
      file: file?.name,
      message: "QuotaExceededError: the disk is full"
    });
  });
});

describe("onStop", () => {
  it("finishes a running log without emit or log, clears the timer and unsubscribes (bug: a log left current forever)", async () => {
    const t = recorder();
    const { name } = t.api.start();
    t.state.timer = setInterval(() => undefined, 1000);
    t.emit.mockClear();
    t.log.info.mockClear();
    await stopRecorder({ config: t.ctx.config, state: t.state });
    expect(kinds(await storedLines(t.state.memory, name)).at(-1)).toBe("event:recorder");
    expect(t.api.files()[0]).toMatchObject({ name, current: false });
    expect(t.state.phase).toBe("idle");
    expect([t.monitor.listeners, vi.getTimerCount()]).toEqual([0, 0]);
    expect(t.emit).not.toHaveBeenCalled();
    expect(t.log.info).not.toHaveBeenCalled();
  });
});
