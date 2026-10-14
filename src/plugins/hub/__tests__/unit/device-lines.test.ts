import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notification } from "../../../registry/protocol";
import { acceptLines, isLineShape, MAX_LOGS } from "../../device/lines";
import type { LinkJson } from "../../protocol";
import type { HubDeviceEvent } from "../../types";
import type { DeviceHarness } from "../helpers";
import { createDeviceHarness, helloOf, pairAdb, paramsOf } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// perf.lines (C5): the pure acceptLines over a record's log indices, the
// shallow isLineShape guard, and the effects through the socket handler (the
// strike, the hub:device lines event, the ack).
// ─────────────────────────────────────────────────────────────────────────────

const LOG = "perf-20261014-1532-sm-a266b.jsonl";
const NOW = 1_791_986_090_000;

/**
 * A well-formed line.
 *
 * @param t - Its time.
 * @returns The line.
 */
function line(t: number): LinkJson {
  return { v: 1, kind: "sample", t };
}

/**
 * Lines of consecutive times.
 *
 * @param count - How many.
 * @param first - The first time.
 * @returns The lines.
 */
function lines(count: number, first = 0): LinkJson[] {
  return Array.from({ length: count }, (_, index) => line(first + index));
}

/**
 * A record whose logs expect the given next indices.
 *
 * @param logs - Next index per log.
 * @returns The record part acceptLines reads.
 */
function recordOf(logs: Record<string, number> = {}) {
  return { logs: new Map(Object.entries(logs)) };
}

describe("acceptLines", () => {
  it("skips a resend of lines the hub has (bug: duplicate lines after a lost ack)", () => {
    const record = recordOf({ [LOG]: 3 });

    const accepted = acceptLines(record, { log: LOG, from: 0, lines: lines(5) });

    expect(accepted).toEqual({ skip: 3, gap: 0, items: [line(3), line(4)], rejected: 0, next: 5 });
    expect(record.logs.get(LOG)).toBe(5);
  });

  it("reports a jump forward as a gap of lost lines", () => {
    const accepted = acceptLines(recordOf({ [LOG]: 3 }), { log: LOG, from: 5, lines: lines(2, 5) });

    expect(accepted).toMatchObject({ skip: 0, gap: 2, next: 7 });
    expect(accepted.items).toHaveLength(2);
  });

  it("keeps the next index cumulative: an all-duplicate batch never moves it back", () => {
    const record = recordOf({ [LOG]: 10 });

    const accepted = acceptLines(record, { log: LOG, from: 2, lines: lines(3, 2) });

    expect(accepted).toEqual({ skip: 3, gap: 0, items: [], rejected: 0, next: 10 });
    expect(record.logs.get(LOG)).toBe(10);
  });

  it("starts an unknown log at the batch: no skip, no gap", () => {
    expect(acceptLines(recordOf(), { log: LOG, from: 100, lines: lines(2) })).toMatchObject({
      skip: 0,
      gap: 0,
      next: 102
    });
  });

  it("drops and counts malformed items while the rest pass (bug: one bad line cutting the link)", () => {
    const accepted = acceptLines(recordOf(), {
      log: LOG,
      from: 0,
      lines: [line(0), { v: "1", kind: "sample" }, [], line(1), { kind: "mark" }]
    });

    expect(accepted.items).toEqual([line(0), line(1)]);
    expect(accepted.rejected).toBe(3);
    expect(accepted.next).toBe(5);
  });

  it("keeps at most 32 logs: a 33rd drops the oldest", () => {
    const record = recordOf();
    for (let index = 0; index <= MAX_LOGS; index += 1) {
      acceptLines(record, { log: `log-${index}.jsonl`, from: 0, lines: lines(1) });
    }

    expect(record.logs.size).toBe(MAX_LOGS);
    expect(record.logs.has("log-0.jsonl")).toBe(false);
    expect(record.logs.has(`log-${MAX_LOGS}.jsonl`)).toBe(true);
  });
});

describe("isLineShape", () => {
  it("passes { v: 1, kind } and hands on the same object, frozen", () => {
    const item: LinkJson = { v: 1, kind: "sample", fps: 60 };
    const accepted = acceptLines(recordOf(), { log: LOG, from: 0, lines: [item] });

    expect(isLineShape(item)).toBe(true);
    expect(accepted.items[0]).toBe(item);
    expect(Object.isFrozen(item)).toBe(true);
  });

  it("rejects a line without a numeric v or with a bad kind (bug: a line typed PerfLogLine reaching the collector's switch without a numeric v)", () => {
    const bad: LinkJson[] = [
      { v: "1", kind: "sample" },
      { v: 1, kind: "" },
      { v: 1, kind: "k".repeat(33) },
      { v: 1, kind: 5 },
      { v: 1 },
      [{ v: 1, kind: "sample" }],
      // eslint-disable-next-line unicorn/no-null -- a JSON null on the wire
      null,
      "sample"
    ];
    for (const item of bad) expect(isLineShape(item)).toBe(false);
    expect(isLineShape({ v: 1, kind: "k".repeat(32) })).toBe(true);
  });
});

describe("perf.lines through the socket handler", () => {
  let harness: DeviceHarness;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    harness = await createDeviceHarness();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * The hub:device lines events, in order.
   *
   * @returns The events.
   */
  function linesEvents(): Extract<HubDeviceEvent, { kind: "lines" }>[] {
    return harness.ctx.emit.mock.calls.flatMap(([name, payload]) =>
      name === "hub:device" && "kind" in payload && payload.kind === "lines" ? [payload] : []
    );
  }

  it("emits the new items with rx taken at receipt, and acks every batch, all duplicates included", () => {
    const { socket, id } = pairAdb(harness);
    const batch = (from: number, count: number) =>
      notification("editor", "perf.lines", { log: LOG, from, lines: lines(count, from) });

    harness.send(socket, batch(0, 3));
    vi.setSystemTime(NOW + 250);
    harness.send(socket, batch(2, 3));
    harness.send(socket, batch(0, 2));

    expect(socket.notes("editor", "perf.ack").map(note => paramsOf(note))).toEqual([
      { log: LOG, next: 3, n: 3 },
      { log: LOG, next: 5, n: 3 },
      { log: LOG, next: 5, n: 2 }
    ]);
    const events = linesEvents();
    expect(
      events.map(event => [
        event.device.id,
        event.lines.from,
        event.lines.items.length,
        event.lines.rx
      ])
    ).toEqual([
      [id, 0, 3, NOW],
      [id, 3, 2, NOW + 250]
    ]);
    expect(events[1]?.lines).toMatchObject({ log: LOG, gap: 0, rejected: 0 });
  });

  it("emits a gap even when the batch brings no item", () => {
    const { socket } = pairAdb(harness);
    harness.send(
      socket,
      notification("editor", "perf.lines", { log: LOG, from: 0, lines: lines(1) })
    );

    harness.send(
      socket,
      notification("editor", "perf.lines", { log: LOG, from: 4, lines: [{ v: "x" }] })
    );

    expect(linesEvents()[1]?.lines).toMatchObject({ from: 4, items: [], gap: 3, rejected: 1 });
  });

  it("counts a bad log, from or an empty or 5001-line batch as a strike and never acks it", () => {
    const { socket } = pairAdb(harness);
    const bad = [
      { log: "a/b", from: 0, lines: lines(1) },
      { log: LOG, from: -1, lines: lines(1) },
      { log: LOG, from: 0, lines: [] },
      { log: LOG, from: 0, lines: lines(5001) }
    ];

    for (const params of bad) harness.send(socket, notification("editor", "perf.lines", params));

    expect(harness.agentConn(socket).invalid).toBe(4);
    expect(socket.notes("editor", "perf.ack")).toEqual([]);
    expect(linesEvents()).toEqual([]);
  });

  it("accepts perf.lines before hello on a paired phone; anything else before hello closes 1008 hello first", () => {
    const { socket } = pairAdb(harness);
    harness.send(
      socket,
      notification("editor", "perf.lines", { log: LOG, from: 0, lines: lines(1) })
    );
    expect(socket.notes("editor", "perf.ack")).toHaveLength(1);

    harness.send(socket, notification("game", "heartbeat", { frame: 1, paused: false, at: 1 }));
    expect(socket.closes).toEqual([{ code: 1008, reason: "hello first" }]);
  });

  it("accepts perf.lines after hello too", () => {
    const { socket } = pairAdb(harness);
    harness.send(socket, helloOf());
    harness.send(
      socket,
      notification("editor", "perf.lines", { log: LOG, from: 0, lines: lines(2) })
    );

    expect(paramsOf(socket.notes("editor", "perf.ack")[0])).toEqual({ log: LOG, next: 2, n: 2 });
  });

  it("ignores perf.lines of a game page that is no device, with the unknown-notification line", () => {
    const { agent } = harness.hello();
    harness.ctx.log.debug.mockClear();

    harness.send(
      agent,
      notification("editor", "perf.lines", { log: LOG, from: 0, lines: lines(1) })
    );

    expect(agent.sent).toEqual([]);
    expect(linesEvents()).toEqual([]);
    expect(harness.ctx.log.debug).toHaveBeenCalledWith("hub:unknown-notification", {
      channel: "editor",
      method: "perf.lines"
    });
  });
});
