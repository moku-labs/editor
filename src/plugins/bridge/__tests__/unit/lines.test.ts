import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Json, Message } from "../../../registry/protocol";
import { notification } from "../../../registry/protocol";
import { connect, onBeat } from "../../connection/loop";
import { memberOf } from "../../dispatch/params";
import { perfLinesText, shipNext } from "../../lines";
import { HIGH_WATER } from "../../types";
import type { FakeSocket, TestDeps } from "../helpers";
import { deviceDeps, editorNote, LAN, LOG, openDeps, socketOf } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// Log shipping: the recorder's oldest run as perf.lines, one batch in flight,
// every ack handed to the recorder, the tail again after a reconnect, a missed
// ack stalls once per link.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Device deps linked with credentials (phase open) at LAN.
 *
 * @param linesPerBatch - config.linesPerBatch.
 * @returns The deps and the open socket.
 */
async function linked(linesPerBatch = 200): Promise<{ deps: TestDeps; socket: FakeSocket }> {
  const deps = deviceDeps(LAN, { config: { linesPerBatch } });
  deps.state.remembered.links[LAN] = { device: "d-7f3a", token: "t" };
  await connect(deps);
  const socket = socketOf(deps, deps.net.sockets.length - 1);
  socket.open();
  return { deps, socket };
}

/**
 * The perf.lines batches a socket sent: `[from, count]` of each.
 *
 * @param socket - The socket.
 * @returns The batches.
 */
function batches(socket: FakeSocket): [Json | undefined, number][] {
  return socket
    .messages()
    .filter((message: Message) => "method" in message && message.method === "perf.lines")
    .map(message => {
      const params = "params" in message ? message.params : undefined;
      const lines = memberOf(params, "lines");
      return [memberOf(params, "from"), Array.isArray(lines) ? lines.length : -1];
    });
}

/**
 * The hub acks a batch.
 *
 * @param socket - The socket.
 * @param next - The next index the hub expects.
 * @param n - The batch size.
 * @param log - The log.
 */
function ack(socket: FakeSocket, next: number, n: number, log = LOG): void {
  socket.emit("message", { data: editorNote("perf.ack", { log, next, n }) });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("shipNext", () => {
  it("sends batches of at most linesPerBatch, one in flight, the next after the ack", async () => {
    const { deps, socket } = await linked(200);
    deps.recorder.add(LOG, 450);

    shipNext(deps);
    shipNext(deps);
    expect(batches(socket)).toEqual([[0, 200]]);

    ack(socket, 200, 200);
    expect(batches(socket)).toEqual([
      [0, 200],
      [200, 200]
    ]);
    ack(socket, 400, 200);
    expect(batches(socket).at(-1)).toEqual([400, 50]);
  });

  it("hands every ack to the recorder as (log, next), only once the hub answered", async () => {
    const { deps, socket } = await linked();
    deps.recorder.add(LOG, 3);

    shipNext(deps);
    expect(deps.recorder.ack).not.toHaveBeenCalled();
    ack(socket, 3, 3);

    expect(deps.recorder.ack.mock.calls).toEqual([[LOG, 3]]);
  });

  it("an ack of another log or another n ends no batch but is passed on", async () => {
    const { deps, socket } = await linked();
    deps.recorder.add(LOG, 5);
    shipNext(deps);

    ack(socket, 2, 2, "perf-older.jsonl");
    ack(socket, 4, 4);

    expect(batches(socket)).toEqual([[0, 5]]);
    expect(deps.recorder.ack.mock.calls).toEqual([
      ["perf-older.jsonl", 2],
      [LOG, 4]
    ]);
    expect(deps.log.debug).toHaveBeenCalledWith("bridge:late-ack", { log: LOG });
    expect(deps.state.shipping).toMatchObject({ log: LOG, from: 0, count: 5 });
  });

  it("acks nothing after a close and sends the unacked tail again after the next link", async () => {
    const { deps, socket } = await linked();
    deps.recorder.add(LOG, 5);
    shipNext(deps);

    socket.emit("close", { code: 1006, reason: "" });
    expect(deps.state.shipping).toBeUndefined();
    expect(deps.recorder.ack).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    const next = socketOf(deps, 1);
    next.open();

    expect(batches(next)).toEqual([[0, 5]]);
  });

  it("an ack deadline stalls shipping once on this link; the next link resumes", async () => {
    const { deps, socket } = await linked();
    deps.recorder.add(LOG, 5);
    shipNext(deps);

    await vi.advanceTimersByTimeAsync(5000);
    shipNext(deps);
    onBeat(deps, deps.channel.beat);

    expect(batches(socket)).toEqual([[0, 5]]);
    expect(deps.log.warn.mock.calls).toEqual([
      ["bridge:lines-unacked", { address: LAN, log: LOG, from: 0 }]
    ]);
    socket.emit("close", { code: 1006, reason: "" });
    await vi.advanceTimersByTimeAsync(1000);
    socketOf(deps, 1).open();
    expect(batches(socketOf(deps, 1))).toEqual([[0, 5]]);
  });

  it("drops a malformed ack without telling the recorder", async () => {
    const { deps, socket } = await linked();
    deps.recorder.add(LOG, 2);
    shipNext(deps);

    socket.emit("message", { data: editorNote("perf.ack", { log: LOG, next: -1, n: 2 }) });

    expect(deps.recorder.ack).not.toHaveBeenCalled();
    expect(deps.state.shipping).toMatchObject({ count: 2 });
    expect(deps.log.debug).toHaveBeenCalledWith("bridge:bad-ack");
  });

  it("ships on the heartbeat tick", async () => {
    const { deps, socket } = await linked();
    deps.recorder.add(LOG, 2);

    onBeat(deps, deps.channel.beat);

    expect(batches(socket)).toEqual([[0, 2]]);
  });

  it("sends nothing while the socket is congested", async () => {
    const { deps, socket } = await linked();
    deps.recorder.add(LOG, 2);
    socket.bufferedAmount = HIGH_WATER + 1;

    shipNext(deps);

    expect(batches(socket)).toEqual([]);
  });

  it("ships nothing in page mode", () => {
    const { deps, socket } = openDeps();
    deps.recorder.add(LOG, 2);

    shipNext(deps);

    expect(socket.sent).toEqual([]);
    expect(deps.recorder.unsentRun).not.toHaveBeenCalled();
  });

  it("ships nothing while pairing", async () => {
    const deps = deviceDeps();
    deps.recorder.add(LOG, 2);
    await connect(deps);
    socketOf(deps).open();

    shipNext(deps);

    expect(batches(socketOf(deps))).toEqual([]);
  });
});

describe("perfLinesText", () => {
  it("splices the recorder's texts into the message as JSON objects", () => {
    const line = '{"v":1,"kind":"mark","t":1,"build":null,"label":"boss","auto":false}';

    expect(JSON.parse(perfLinesText(LOG, 7, [line]))).toEqual(
      notification("editor", "perf.lines", { log: LOG, from: 7, lines: [JSON.parse(line)] })
    );
  });

  it("keeps a label with a quote and a log name with a quote intact", () => {
    const line = JSON.stringify({ v: 1, kind: "mark", label: 'say "hi"' });

    const parsed: unknown = JSON.parse(perfLinesText('a"b', 0, [line, line]));

    expect(parsed).toMatchObject({
      params: { log: 'a"b', from: 0, lines: [{ label: 'say "hi"' }, { label: 'say "hi"' }] }
    });
  });
});
