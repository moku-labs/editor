/* eslint-disable unicorn/no-null -- null is "no label" and "no build" in the log lines */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eventLine, headerLine, sampleLine } from "../../../../../tests/fixtures/fake-monitor";
import type { PerfMarkLine } from "../../../perf/protocol";
import { flushTick } from "../../flush";
import { readLog } from "../../state";
import { createOpfsStore } from "../../store";
import type { LogFileInfo, RecorderConfig } from "../../types";
import { createFakeDirectory } from "../fake-opfs";
import type { TestRecorder } from "../helpers";
import { kinds, queued, recorder, settle, storedLines } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The flush tick: serialization inside the agent span, persistence by time and
// by size, failed writes, keepMb, and the status event on change only.
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 14, 15, 32, 10));
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Five seconds on, one flush tick, and its write awaited.
 *
 * @param t - The recorder under test.
 */
async function persistTick(t: TestRecorder): Promise<void> {
  vi.advanceTimersByTime(5000);
  flushTick(t.ctx);
  await t.state.session?.inflight;
}

/**
 * A mark line as the engine writes it.
 *
 * @param label - The label.
 * @returns The line.
 */
function markOf(label: string): PerfMarkLine {
  return { v: 1, kind: "mark", t: 1_760_454_002_000, build: null, label, auto: false };
}

describe("the flush tick", () => {
  it("serializes the queue between beginAgent and endAgent, counting lines and bytes", () => {
    const t = recorder();
    t.api.start();
    t.monitor.emit(sampleLine(3));
    const bytes = queued(t.state).reduce((sum, line) => sum + JSON.stringify(line).length + 1, 0);
    const seen: number[] = [];
    const { beginAgent, endAgent } = t.monitor;
    t.monitor.beginAgent = () => {
      seen.push(t.state.session?.lines ?? -1);
      beginAgent();
    };
    t.monitor.endAgent = () => {
      seen.push(t.state.session?.lines ?? -1);
      endAgent();
    };
    flushTick(t.ctx);
    expect(seen).toEqual([0, 3]);
    expect(t.state.session?.bytes).toBe(bytes);
    expect(t.state.queueSize).toBe(0);
  });

  it("closes the agent span also when the store throws inside it (bug: an open span charges the game every frame)", () => {
    const t = recorder();
    t.api.start();
    t.state.memory.memoryBytes = () => {
      throw new Error("store broke");
    };
    expect(() => flushTick(t.ctx)).toThrow("store broke");
    expect([t.monitor.begins, t.monitor.ends]).toEqual([1, 1]);
  });

  it("writes to the store at persistEveryMs and at 64 KB of text, not every tick", async () => {
    const t = recorder();
    const { name } = t.api.start();
    flushTick(t.ctx);
    vi.advanceTimersByTime(1000);
    flushTick(t.ctx);
    await settle();
    expect(await storedLines(t.state.memory, name)).toEqual([]);

    vi.advanceTimersByTime(4000);
    flushTick(t.ctx);
    await t.state.session?.inflight;
    expect(kinds(await storedLines(t.state.memory, name))).toEqual(["header", "event:recorder"]);

    t.monitor.emit(markOf("x".repeat(70_000)));
    vi.advanceTimersByTime(1000);
    flushTick(t.ctx);
    await t.state.session?.inflight;
    expect(kinds(await storedLines(t.state.memory, name)).at(-1)).toBe(
      `mark:${"x".repeat(70_000)}`
    );
  });

  it("keeps a failed chunk for the next try, and moves the log to memory at the third failure", async () => {
    const root = createFakeDirectory();
    root.failWrites = 3;
    const t = recorder({ store: createOpfsStore(root) });
    const { name } = t.api.start();
    const tick = (): Promise<void> => persistTick(t);

    await tick();
    expect(t.log.warn).toHaveBeenCalledWith("recorder:persist-failed", {
      file: name,
      message: "QuotaExceededError: the disk is full"
    });
    expect(t.state.session?.pending).toHaveLength(1);
    expect(t.state.session?.pending[0]).toMatch(/^\{"v":1,"kind":"header"/);
    expect(t.state.session?.store.kind).toBe("opfs");

    await tick();
    await tick();
    expect(t.log.info).toHaveBeenCalledWith("recorder:storage", {
      kind: "memory",
      reason: expect.stringContaining("QuotaExceededError")
    });
    expect(t.state.session?.store).toBe(t.state.memory);
    expect(t.api.files()[0]?.storage).toBe("memory");

    await tick();
    expect(kinds(await storedLines(t.state.memory, name))).toEqual(["header", "event:recorder"]);
  });

  it("over keepMb removes the oldest finished memory log first, then the oldest outbox lines, with one warn per streak", async () => {
    const t = recorder({ config: { persistEveryMs: 60_000 } });
    const old: LogFileInfo = {
      name: "old.jsonl",
      label: null,
      startedAt: 1,
      lines: 1,
      bytes: 5001,
      sent: 0,
      current: false,
      storage: "memory"
    };
    await t.state.memory.append(old, "o".repeat(5000));
    t.state.files = [old];
    const h = JSON.stringify(headerLine()).length;
    const s = JSON.stringify(eventLine("recorder", null, { action: "start", label: null })).length;
    const m = JSON.stringify(markOf("a".repeat(1000))).length;
    // The pending text plus the three marks left in the outbox: exactly at the bound.
    const bound = h + s + 3 * m + 5 + (3 * m + 3);
    (t.ctx.config as RecorderConfig).keepMb = bound / 1_048_576;
    const dropWarns = () =>
      t.log.warn.mock.calls.filter(([event]) => event === "recorder:dropped").length;

    const { name } = t.api.start();
    for (const letter of "abc") t.monitor.emit(markOf(letter.repeat(1000)));
    flushTick(t.ctx);
    expect(t.api.files().map(info => info.name)).toEqual([name]);
    expect(await t.state.memory.list()).toEqual([]);
    expect(t.log.info).toHaveBeenCalledWith("recorder:dropped-log", { file: "old.jsonl" });
    expect(t.api.status().dropped).toBe(2);
    expect(t.api.unsentRun(10)).toMatchObject({ log: name, from: 2 });
    expect(dropWarns()).toBe(1);

    t.monitor.emit(markOf("d".repeat(1000)));
    flushTick(t.ctx);
    expect([t.api.status().dropped, dropWarns()]).toEqual([4, 1]);

    flushTick(t.ctx);
    expect([t.api.status().dropped, dropWarns()]).toEqual([4, 1]);

    t.monitor.emit(markOf("e".repeat(1000)));
    flushTick(t.ctx);
    expect([t.api.status().dropped, dropWarns()]).toEqual([6, 2]);
    expect(t.api.unsentRun(10)?.from).toBe(6);
  });

  it("emits recorder:status only when a number changed", () => {
    const t = recorder();
    const { name } = t.api.start();
    t.emit.mockClear();
    flushTick(t.ctx);
    expect(t.emit).toHaveBeenCalledExactlyOnceWith(
      "recorder:status",
      expect.objectContaining({ lines: 2, pending: 2 })
    );
    flushTick(t.ctx);
    expect(t.emit).toHaveBeenCalledOnce();
    t.api.ack(name, 2);
    expect(t.emit).toHaveBeenCalledOnce();
    flushTick(t.ctx);
    expect(t.emit).toHaveBeenLastCalledWith(
      "recorder:status",
      expect.objectContaining({ sent: 2, pending: 0 })
    );
  });

  it("after a move to memory keeps the earlier chunks in OPFS, writes the rest to memory and reads the log whole (bug: a whole log copied into the heap)", async () => {
    const root = createFakeDirectory();
    const opfs = createOpfsStore(root);
    const t = recorder({ store: opfs });
    const { name } = t.api.start();
    const tick = (): Promise<void> => persistTick(t);
    await tick();
    t.monitor.emit(sampleLine(3));
    root.failWrites = 3;
    for (let failure = 1; failure <= 3; failure += 1) await tick();
    expect(t.state.session?.store).toBe(t.state.memory);
    expect(await storedLines(t.state.memory, name)).toEqual([]);

    await tick();
    const file = await t.api.stop();
    if (file === undefined) throw new Error("no log was running");
    const blob = await readLog(t.state, file);
    const text = await blob.text();
    expect(
      kinds(
        text
          .trim()
          .split("\n")
          .map(line => JSON.parse(line))
      )
    ).toEqual(["header", "event:recorder", "sample", "event:recorder"]);
    expect(await opfs.list()).toMatchObject([{ name, lines: 2, current: false }]);
  });
});
