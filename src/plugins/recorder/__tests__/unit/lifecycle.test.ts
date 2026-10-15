/* eslint-disable unicorn/no-null -- null is "no input", "no header" and "between frames" of the engine */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeMonitor, headerLine } from "../../../../../tests/fixtures/fake-monitor";
import { initRecorder, startRecorder, stopRecorder } from "../../lifecycle";
import { OPFS_DIR } from "../../store";
import { createFakeDirectory } from "../fake-opfs";
import { recorder } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// onInit and onStart: the monitor and the entries, the subscription, the timer,
// autoStart (also when a native shell holds the header back), a failing tick.
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 14, 15, 32, 10));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("onInit and onStart", () => {
  it("finds the monitor, adds the three entries, subscribes, ticks every flushEveryMs and auto-starts with the header", async () => {
    const t = recorder({ attached: false });
    t.state.monitor = undefined;
    initRecorder(t.ctx);
    expect(t.state.monitor).toBe(t.monitor);
    expect(t.added.map(entry => entry.descriptor.id)).toEqual([
      "editor.record",
      "editor.mark",
      "editor.recorder"
    ]);
    await startRecorder(t.ctx);
    expect(t.monitor.listeners).toBe(1);
    expect(t.state.session?.name).toBe("perf-20261014-1532-sm-a266b.jsonl");
    vi.advanceTimersByTime(1000);
    expect([t.monitor.begins, t.state.session?.lines]).toEqual([1, 2]);
    await stopRecorder(t.ctx);
  });

  it("logs recorder:no-monitor once without a monitor, and then starts no timer and no listener", async () => {
    const t = recorder({ monitor: false });
    initRecorder(t.ctx);
    await startRecorder(t.ctx);
    expect(t.log.info).toHaveBeenCalledWith("recorder:no-monitor", expect.any(Object));
    expect([t.monitor.listeners, vi.getTimerCount(), t.state.session]).toEqual([0, 0, undefined]);
  });

  it("starts the log on the next tick when the header comes after the subscribe (bug: a phone log named `device`, its header after the start)", async () => {
    const monitor = createFakeMonitor({ header: null });
    const t = recorder({ monitor, attached: false });
    await startRecorder(t.ctx);
    expect(t.state.session).toBeUndefined();
    monitor.emit(headerLine());
    vi.advanceTimersByTime(1000);
    expect(t.state.session?.name).toBe("perf-20261014-1532-sm-a266b.jsonl");
    expect(t.state.session?.pending[0]).toMatch(/^\{"v":1,"kind":"header"/);
    await stopRecorder(t.ctx);
  });

  it("warns a tick that throws and keeps ticking", async () => {
    const t = recorder({ attached: false });
    await startRecorder(t.ctx);
    const memoryBytes = t.state.memory.memoryBytes;
    t.state.memory.memoryBytes = () => {
      throw new Error("store broke");
    };
    vi.advanceTimersByTime(1000);
    expect(t.log.warn).toHaveBeenCalledWith("recorder:flush-failed", { message: "store broke" });
    t.state.memory.memoryBytes = memoryBytes;
    vi.advanceTimersByTime(1000);
    expect(t.state.session?.lines).toBe(2);
    await stopRecorder(t.ctx);
  });

  it("warns an OPFS directory that cannot be listed and records on in it", async () => {
    const top = createFakeDirectory();
    const root = await top.getDirectoryHandle(OPFS_DIR, { create: true });
    root.values = () => {
      throw new Error("NotReadableError: the directory is gone");
    };
    vi.stubGlobal("navigator", { storage: { getDirectory: async () => top } });
    const t = recorder({ attached: false, config: { storage: "auto" } });
    await startRecorder(t.ctx);
    expect(t.log.warn).toHaveBeenCalledWith("recorder:list-failed", {
      message: "NotReadableError: the directory is gone"
    });
    expect(t.api.files()).toMatchObject([{ current: true, storage: "opfs" }]);
    await stopRecorder(t.ctx);
  });

  it("waits ticks for a header that comes late and starts the log with it", async () => {
    const monitor = createFakeMonitor({ header: null });
    const t = recorder({ monitor, attached: false });
    await startRecorder(t.ctx);
    vi.advanceTimersByTime(3000);
    expect(t.state.session).toBeUndefined();
    monitor.emit(headerLine());
    vi.advanceTimersByTime(1000);
    expect(t.state.session?.name).toBe("perf-20261014-1532-sm-a266b.jsonl");
    expect(t.state.session?.pending[0]).toMatch(/^\{"v":1,"kind":"header"/);
    await stopRecorder(t.ctx);
  });

  it("starts anyway at the tenth tick when no header comes", async () => {
    const t = recorder({ monitor: createFakeMonitor({ header: null }), attached: false });
    await startRecorder(t.ctx);
    vi.advanceTimersByTime(9000);
    expect(t.state.session).toBeUndefined();
    vi.advanceTimersByTime(1000);
    expect(t.state.session?.name).toBe("perf-20261014-1532-device.jsonl");
    await stopRecorder(t.ctx);
  });
});
