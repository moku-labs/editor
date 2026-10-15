/* eslint-disable unicorn/no-null -- null is "no build" in the engine's log lines */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sampleLine } from "../../../../../tests/fixtures/fake-monitor";
import type { PerfLogLine, PerfMarkLine } from "../../../perf/protocol";
import { flushTick, utf8Length } from "../../flush";
import { startRecorder, stopRecorder } from "../../lifecycle";
import { rotateIfFull } from "../../rotate";
import type { LogFileInfo } from "../../types";
import type { TestRecorder } from "../helpers";
import { kinds, recorder, settle, storedLines } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// Rotation at maxLogMb: no finished log passes the cap in UTF-8 bytes (non-ASCII
// lines included, so a default log stays shareable); the next log starts with
// the same label and the context lines; no line is lost or written twice; a
// remove, a share and onStop wait for a log that is still being finished.
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 14, 15, 32, 10));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/**
 * A mark line as the engine writes it.
 *
 * @param label - The label.
 * @returns The line.
 */
function markOf(label: string): PerfMarkLine {
  return { v: 1, kind: "mark", t: 1_760_454_002_000, build: null, label, auto: false };
}

/**
 * The frames of a log's sample lines.
 *
 * @param lines - Log lines.
 * @returns The frames.
 */
function framesOf(lines: readonly PerfLogLine[]): number[] {
  return lines.flatMap(line => (line.kind === "sample" ? [line.frame] : []));
}

/**
 * Ticks (flush, then rotation) until the queue is empty and no log is full.
 *
 * @param t - The recorder under test.
 */
async function tickUntilDrained(t: TestRecorder): Promise<void> {
  for (let turn = 0; turn < 50; turn += 1) {
    flushTick(t.ctx);
    const rotation = rotateIfFull(t.ctx);
    await rotation;
    if (rotation === undefined && t.state.queueSize === 0) return;
  }
}

/**
 * A gate on a store's append for one log: its writes wait until `open` is called.
 *
 * @param t - The recorder under test.
 * @param name - The gated log.
 * @returns The opener.
 */
function gateAppend(t: TestRecorder, name: () => string | undefined): () => void {
  let open: (() => void) | undefined;
  const gate = new Promise<void>(resolve => {
    open = resolve;
  });
  const append = t.state.memory.append;
  t.state.memory.append = async (info: LogFileInfo, text: string) => {
    if (info.name === name()) await gate;
    return append(info, text);
  };
  return () => open?.();
}

describe("rotation at maxLogMb", () => {
  it("never lets a finished log pass the cap in UTF-8 bytes, and loses or repeats no line across logs", async () => {
    const cap = 6000;
    const t = recorder({ config: { maxLogMb: cap / 1_048_576 } });
    t.api.start({ label: "boss run" });
    expect(rotateIfFull(t.ctx)).toBeUndefined();
    for (let frame = 1; frame <= 20; frame += 1) {
      t.monitor.emit(sampleLine(frame));
      if (frame % 5 === 0) await tickUntilDrained(t);
    }
    await t.api.stop();

    const files = t.api.files();
    expect(files.length).toBeGreaterThan(2);
    const all: PerfLogLine[] = [];
    for (const file of files) {
      const blob = await t.state.memory.read(file.name);
      const lines = await storedLines(t.state.memory, file.name);
      expect({ size: blob.size <= cap, bytes: file.bytes }).toEqual({
        size: true,
        bytes: blob.size
      });
      expect(kinds(lines).slice(0, 2)).toEqual(["header", "event:recorder"]);
      expect(lines.at(-1)).toMatchObject({ kind: "event", detail: { action: "stop" } });
      expect(lines[1]).toMatchObject({ detail: { action: "start", label: "boss run" } });
      all.push(...lines);
    }
    expect(framesOf(all)).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
    expect(t.log.info).toHaveBeenCalledWith("recorder:rotated", {
      from: files[0]?.name,
      to: files[1]?.name
    });
  });

  it("counts non-ASCII lines in UTF-8 bytes (bug: a finished log over the cap on disk)", async () => {
    const cap = 8000;
    const t = recorder({ config: { maxLogMb: cap / 1_048_576 } });
    t.api.start();
    for (let mark = 1; mark <= 12; mark += 1) {
      t.monitor.emit(markOf("€".repeat(400)));
      await tickUntilDrained(t);
    }
    await t.api.stop();
    for (const file of t.api.files()) {
      const blob = await t.state.memory.read(file.name);
      expect({ name: file.name, fits: blob.size <= cap, bytes: file.bytes }).toEqual({
        name: file.name,
        fits: true,
        bytes: blob.size
      });
    }
  });

  it("counts UTF-8 bytes like TextEncoder, 1 to 4 bytes a character and a lone surrogate", () => {
    for (const text of ["plain", "é", "€", "🔥", "aé€🔥", "\uD800", "x\uDC00y"]) {
      expect({ text, bytes: utf8Length(text) }).toEqual({
        text,
        bytes: new TextEncoder().encode(text).byteLength
      });
    }
  });

  it("leaves room for the stop event when small lines fill a log to its budget (bug: the stop event pushing a log past the cap)", async () => {
    const cap = 6000;
    const t = recorder({ config: { maxLogMb: cap / 1_048_576 } });
    t.api.start();
    for (let mark = 1; mark <= 200; mark += 1) {
      t.monitor.emit(markOf("x"));
      if (mark % 20 === 0) await tickUntilDrained(t);
    }
    await t.api.stop();
    expect(t.api.files().length).toBeGreaterThan(1);
    for (const file of t.api.files()) {
      const blob = await t.state.memory.read(file.name);
      expect({ name: file.name, fits: blob.size <= cap }).toEqual({ name: file.name, fits: true });
    }
  });

  it("keeps a finished log of the default size shareable through the native share", async () => {
    const share = vi.fn(async (_file: { bytes: Uint8Array }) => ({ shared: true }));
    vi.stubGlobal("__MOKU_NATIVE__", { version: 1, share });
    const t = recorder({ config: { keepMb: 512 } });
    t.api.start();
    const half = "x".repeat(524_288);
    for (let mark = 1; mark <= 66 && t.api.files().length < 2; mark += 1) {
      t.monitor.emit(markOf(half));
      await tickUntilDrained(t);
    }
    const [finished] = t.api.files();
    expect(t.api.files()).toHaveLength(2);
    await expect(t.api.share(finished?.name ?? "")).resolves.toBe("shared");
    expect(share.mock.calls[0]?.[0].bytes.byteLength).toBeLessThanOrEqual(32 * 1_048_576);
  });

  it("goes on in the next log and keeps the old log's unsent lines in the outbox", async () => {
    const t = recorder({ config: { maxLogMb: 3000 / 1_048_576 } });
    const first = t.api.start().name;
    for (let frame = 1; frame <= 4; frame += 1) t.monitor.emit(sampleLine(frame));
    await tickUntilDrained(t);
    const second = t.api.files()[1]?.name;
    expect(t.api.status().file).not.toBe(first);
    const oldRun = t.api.unsentRun(100);
    expect(oldRun).toMatchObject({ log: first, from: 0 });
    t.api.ack(first, oldRun?.lines.length ?? 0);
    expect(t.api.unsentRun(100)).toMatchObject({ log: second, from: 0 });
  });

  it("leaves a log under the cap alone", () => {
    const t = recorder();
    t.api.start();
    flushTick(t.ctx);
    expect(rotateIfFull(t.ctx)).toBeUndefined();
    expect(t.api.files()).toHaveLength(1);
  });

  it("does not rotate when the finish fails before it detaches the log, and warns recorder:rotate-failed", async () => {
    const t = recorder({ config: { maxLogMb: 3000 / 1_048_576 } });
    const { name } = t.api.start();
    for (let frame = 1; frame <= 4; frame += 1) t.monitor.emit(sampleLine(frame));
    flushTick(t.ctx);
    const queued = t.state.queueSize;
    t.monitor.event = () => {
      throw new Error("monitor gone");
    };
    await rotateIfFull(t.ctx);
    expect(t.state.session?.name).toBe(name);
    expect(t.state.queueSize).toBe(queued);
    expect(t.log.warn).toHaveBeenCalledWith("recorder:rotate-failed", {
      file: name,
      message: "monitor gone"
    });
    expect(t.log.info).not.toHaveBeenCalledWith("recorder:rotated", expect.anything());
  });

  it("rotates on the flush timer", async () => {
    const t = recorder({
      attached: false,
      config: { autoStart: true, maxLogMb: 3000 / 1_048_576 }
    });
    await startRecorder(t.ctx);
    const first = t.api.status().file;
    for (let frame = 1; frame <= 6; frame += 1) t.monitor.emit(sampleLine(frame));
    vi.advanceTimersByTime(1000);
    expect(t.api.status().file).not.toBe(first);
    expect(t.log.info).toHaveBeenCalledWith("recorder:rotated", {
      from: first,
      to: t.api.status().file
    });
    await stopRecorder(t.ctx);
  });
});

describe("a log that is still being finished", () => {
  it("is removed only after its finish (bug: an orphan log the finish wrote after the remove)", async () => {
    const t = recorder({ config: { maxLogMb: 3000 / 1_048_576 } });
    const first = t.api.start().name;
    const open = gateAppend(t, () => first);
    for (let frame = 1; frame <= 4; frame += 1) t.monitor.emit(sampleLine(frame));
    flushTick(t.ctx);
    const rotation = rotateIfFull(t.ctx);
    const removing = t.api.remove(first);
    await settle();
    open();
    await Promise.all([rotation, removing]);
    await settle();
    expect(t.api.files().map(file => file.name)).not.toContain(first);
    const stored = await t.state.memory.list();
    expect(stored.map(file => file.name)).not.toContain(first);
  });

  it("is shared whole after its stop (bug: a share missing the last lines and the stop event)", async () => {
    const share = vi.fn(async (_file: { bytes: Uint8Array }) => ({ shared: true }));
    vi.stubGlobal("__MOKU_NATIVE__", { version: 1, share });
    const t = recorder();
    const { name } = t.api.start();
    const open = gateAppend(t, () => name);
    t.monitor.emit(sampleLine(1));
    const stopping = t.api.stop();
    const sharing = t.api.share(name);
    await settle();
    open();
    await stopping;
    await expect(sharing).resolves.toBe("shared");
    const text = new TextDecoder().decode(share.mock.calls[0]?.[0].bytes);
    const lines = text
      .trim()
      .split("\n")
      .map(line => JSON.parse(line) as PerfLogLine);
    expect(kinds(lines)).toEqual(["header", "event:recorder", "sample", "event:recorder"]);
  });

  it("is waited for by onStop (bug: a rotated log left unfinished at teardown)", async () => {
    const t = recorder({ config: { maxLogMb: 3000 / 1_048_576 } });
    const first = t.api.start().name;
    const open = gateAppend(t, () => first);
    for (let frame = 1; frame <= 4; frame += 1) t.monitor.emit(sampleLine(frame));
    flushTick(t.ctx);
    rotateIfFull(t.ctx);
    let stopped = false;
    const stopping = stopRecorder({ config: t.ctx.config, state: t.state }).then(() => {
      stopped = true;
    });
    await settle();
    expect(stopped).toBe(false);
    open();
    await stopping;
    expect(t.api.files()[0]).toMatchObject({ name: first, current: false });
    expect(kinds(await storedLines(t.state.memory, first)).at(-1)).toBe("event:recorder");
  });
});
