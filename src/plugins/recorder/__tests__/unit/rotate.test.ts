import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sampleLine } from "../../../../../tests/fixtures/fake-monitor";
import type { PerfLogLine } from "../../../perf/protocol";
import { flushTick } from "../../flush";
import { startRecorder, stopRecorder } from "../../lifecycle";
import { rotateIfFull } from "../../rotate";
import { kinds, recorder, storedLines } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// Rotation at maxLogMb: the full log is finished (stop event, persisted), the
// next starts with the same label and the context lines; no line is lost or
// written twice; the outbox keeps the old log's unsent lines.
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 14, 15, 32, 10));
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * The frames of a log's sample lines.
 *
 * @param lines - Log lines.
 * @returns The frames.
 */
function framesOf(lines: readonly PerfLogLine[]): number[] {
  return lines.flatMap(line => (line.kind === "sample" ? [line.frame] : []));
}

describe("rotation at maxLogMb", () => {
  it("finishes the full log and goes on in the next, losing and repeating no line (bug: an OPFS log that grows without bound)", async () => {
    // A cap of 3000 bytes: the header, the start event and six samples pass it.
    const t = recorder({ config: { maxLogMb: 3000 / 1_048_576 } });
    const first = t.api.start({ label: "boss run" }).name;
    expect(rotateIfFull(t.ctx)).toBeUndefined();
    for (let frame = 1; frame <= 6; frame += 1) t.monitor.emit(sampleLine(frame));
    flushTick(t.ctx);

    const finishing = rotateIfFull(t.ctx);
    for (let frame = 7; frame <= 8; frame += 1) t.monitor.emit(sampleLine(frame));
    await finishing;
    flushTick(t.ctx);
    const second = t.api.status().file;
    expect(second).toBe("perf-20261014-1532-sm-a266b-2.jsonl");
    expect(t.log.info).toHaveBeenCalledWith("recorder:rotated", { from: first, to: second });

    const old = await storedLines(t.state.memory, first);
    expect(kinds(old)).toEqual([
      "header",
      "event:recorder",
      ...Array.from<string>({ length: 6 }).fill("sample"),
      "event:recorder"
    ]);
    expect(old.at(-1)).toMatchObject({ detail: { action: "stop" } });
    expect(t.api.files()).toMatchObject([
      { name: first, label: "boss run", current: false, lines: 9 },
      { name: second, label: "boss run", current: true }
    ]);

    // The outbox serves the old log first, then the new one from its header.
    const oldRun = t.api.unsentRun(100);
    expect(oldRun).toMatchObject({ log: first, from: 0 });
    t.api.ack(first, 9);
    const newRun = t.api.unsentRun(100);
    expect(newRun).toMatchObject({ log: second, from: 0 });
    const fresh = (newRun?.lines ?? []).map(text => JSON.parse(text) as PerfLogLine);
    expect(kinds(fresh).slice(0, 2)).toEqual(["header", "event:recorder"]);
    expect(fresh[1]).toMatchObject({ detail: { action: "start", label: "boss run" } });
    expect([...framesOf(old), ...framesOf(fresh)]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("leaves a log under the cap alone", () => {
    const t = recorder();
    t.api.start();
    flushTick(t.ctx);
    expect(rotateIfFull(t.ctx)).toBeUndefined();
    expect(t.api.files()).toHaveLength(1);
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
