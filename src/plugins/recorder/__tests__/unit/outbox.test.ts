import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sampleLine } from "../../../../../tests/fixtures/fake-monitor";
import { flushTick } from "../../flush";
import type { TestRecorder } from "../helpers";
import { recorder } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The outbox the bridge pulls: unsentRun peeks one log's oldest lines, ack
// confirms them by index; a reconnect answers the unconfirmed tail again.
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 14, 15, 32, 10));
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Two logs in the outbox: A (finished: header, start, 3 samples, stop) and B (current: header,
 * start, 2 samples).
 *
 * @returns The recorder and the two names.
 */
async function twoLogs(): Promise<{ t: TestRecorder; a: string; b: string }> {
  const t = recorder();
  const a = t.api.start().name;
  for (let frame = 1; frame <= 3; frame += 1) t.monitor.emit(sampleLine(frame));
  await t.api.stop();
  const b = t.api.start().name;
  t.monitor.emit(sampleLine(4));
  t.monitor.emit(sampleLine(5));
  flushTick(t.ctx);
  return { t, a, b };
}

/**
 * The kinds of a run's lines.
 *
 * @param lines - JSON texts.
 * @returns Their kinds.
 */
function kindsOf(lines: readonly string[] | undefined): string[] {
  return (lines ?? []).map(text => (JSON.parse(text) as { kind: string }).kind);
}

describe("unsentRun", () => {
  it("peeks one log's oldest lines with its name and the index of the first, without taking them", async () => {
    const { t, a, b } = await twoLogs();
    expect(b).toBe(`${a.slice(0, -".jsonl".length)}-2.jsonl`);
    const run = t.api.unsentRun(100);
    expect(run).toMatchObject({ log: a, from: 0 });
    expect(kindsOf(run?.lines)).toEqual(["header", "event", "sample", "sample", "sample", "event"]);
    expect(t.api.unsentRun(100)).toEqual(run);
    expect(t.api.unsentRun(2)?.lines).toHaveLength(2);
    expect(t.api.unsentRun(0)?.lines).toHaveLength(1);
    expect(t.api.unsentRun(2.5)?.lines).toHaveLength(1);

    t.api.ack(a, 6);
    expect(t.api.unsentRun(100)).toMatchObject({ log: b, from: 0 });
    expect(kindsOf(t.api.unsentRun(100)?.lines)).toEqual(["header", "event", "sample", "sample"]);
  });

  it("answers undefined for an empty outbox", () => {
    expect(recorder().api.unsentRun(10)).toBeUndefined();
  });

  it("answers the unconfirmed tail again after a reconnect (bug: a gap in the computer's log)", async () => {
    const { t, a } = await twoLogs();
    const sent = t.api.unsentRun(3);
    // The hub took two of the three, then the link dropped: the bridge asks again.
    t.api.ack(a, 2);
    const again = t.api.unsentRun(3);
    expect(again).toMatchObject({ log: a, from: 2 });
    expect(again?.lines[0]).toBe(sent?.lines[2]);
  });
});

describe("ack", () => {
  it("removes only that log's lines below next and counts them as sent for that log", async () => {
    const { t, a, b } = await twoLogs();
    t.api.ack(a, 2);
    expect(t.api.unsentRun(100)).toMatchObject({ log: a, from: 2 });
    expect(t.api.status()).toMatchObject({ sent: 2, pending: 8 });
    expect(t.api.files().map(file => [file.name, file.sent])).toEqual([
      [a, 2],
      [b, 0]
    ]);

    // B's lines wait behind A's: an ack of B removes nothing yet.
    t.api.ack(b, 4);
    expect(t.api.status()).toMatchObject({ sent: 2, pending: 8 });
  });

  it("removes nothing more on an older or repeated ack or an unknown log, and confirms all at an ack past the end", async () => {
    const { t, a, b } = await twoLogs();
    t.api.ack(a, 3);
    t.api.ack(a, 3);
    t.api.ack(a, 1);
    t.api.ack("perf-20261014-0000-unknown.jsonl", 100);
    expect(t.api.status()).toMatchObject({ sent: 3, pending: 7 });
    t.api.ack(a, 1000);
    t.api.ack(b, 1000);
    expect(t.api.status()).toMatchObject({ sent: 10, pending: 0 });
    expect(t.api.files().map(file => file.sent)).toEqual([6, 4]);
    expect(t.api.unsentRun(1)).toBeUndefined();
  });

  it.each([
    -1, 1.5
  ])("throws a two-line TypeError for next %s (bug: an ack that rewinds the outbox)", async next => {
    const { t, a } = await twoLogs();
    const ack = () => t.api.ack(a, next);
    expect(ack).toThrow(TypeError);
    expect(ack).toThrow(
      `[moku-editor] recorder.ack(${a}, ${next}) needs a whole line index from 0.\n  Pass the next of the hub's perf.ack, for example 1840.`
    );
    expect(t.api.status().pending).toBe(10);
  });

  it("compacts the consumed head and keeps the indices (bug: an outbox that grows for hours)", () => {
    const t = recorder();
    const { name } = t.api.start();
    for (let frame = 1; frame <= 5000; frame += 1) {
      t.monitor.emit(sampleLine(frame));
      if (frame % 2500 === 0) flushTick(t.ctx);
    }
    t.api.ack(name, 4600);
    expect(t.state.outbox.length).toBeLessThan(500);
    expect(t.api.unsentRun(1000)).toMatchObject({ log: name, from: 4600 });
    expect(t.api.unsentRun(1000)?.lines).toHaveLength(402);
    expect(JSON.parse(t.api.unsentRun(1)?.lines[0] ?? "{}")).toMatchObject({ frame: 4599 });
  });
});
