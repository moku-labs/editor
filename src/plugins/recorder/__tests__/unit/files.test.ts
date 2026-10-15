import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startRecorder, stopRecorder } from "../../lifecycle";
import { createOpfsStore, OPFS_DIR } from "../../store";
import type { LogFileInfo } from "../../types";
import { createFakeDirectory } from "../fake-opfs";
import { recorder } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The logs on the device: remove refuses the current and unknown logs; files()
// lists the logs an earlier page left in OPFS, a dead page's as finished.
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 14, 15, 32, 10));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("remove", () => {
  it("refuses the current log (Error) and an unknown name (TypeError) with their two-line messages, and deletes a finished one", async () => {
    const t = recorder();
    const first = t.api.start().name;
    await t.api.stop();
    const second = t.api.start().name;

    const current = t.api.remove(second);
    await expect(current).rejects.toThrow(
      `[moku-editor] recorder.remove: ${second} is being recorded.\n  Stop the recording first.`
    );
    await expect(current).rejects.not.toThrow(TypeError);
    const unknown = t.api.remove("perf-20261014-0000-nope.jsonl");
    await expect(unknown).rejects.toThrow(TypeError);
    await expect(unknown).rejects.toThrow(
      '[moku-editor] recorder.remove: no log named "perf-20261014-0000-nope.jsonl".\n  Pick a name from recorder.files().'
    );

    t.emit.mockClear();
    await t.api.remove(first);
    expect(t.api.files().map(file => file.name)).toEqual([second]);
    await expect(t.state.memory.list()).resolves.toEqual([]);
    expect(t.emit).toHaveBeenCalledOnce();
  });
});

describe("files", () => {
  it("lists after start the logs the store kept, a log a dead page left current as finished", async () => {
    const top = createFakeDirectory();
    const root = await top.getDirectoryHandle(OPFS_DIR, { create: true });
    const dead: LogFileInfo = {
      name: "perf-20261013-2210-sm-a266b.jsonl",
      label: "night run",
      startedAt: 1_792_000_000_000,
      lines: 1,
      bytes: 3,
      sent: 0,
      current: true,
      storage: "opfs"
    };
    await createOpfsStore(root).append(dead, "{}\n");
    vi.stubGlobal("navigator", { storage: { getDirectory: async () => top } });

    const t = recorder({ attached: false, config: { storage: "auto" } });
    await startRecorder(t.ctx);
    expect(t.api.files()).toEqual([
      { ...dead, current: false },
      expect.objectContaining({
        name: "perf-20261014-1532-sm-a266b.jsonl",
        current: true,
        storage: "opfs"
      })
    ]);
    expect(t.api.status().storage).toBe("opfs");
    await stopRecorder(t.ctx);
  });

  it("answers copies: a caller cannot change the list or the marks", () => {
    const t = recorder();
    t.api.start();
    const files = t.api.files() as LogFileInfo[];
    files.length = 0;
    expect(t.api.files()).toHaveLength(1);
    expect(t.api.marks()).not.toBe(t.api.marks());
  });
});
