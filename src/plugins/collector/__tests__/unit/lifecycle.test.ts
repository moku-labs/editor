import { join } from "node:path/posix";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAdbLoop } from "../../adb/loop";
import { createCollectorApi } from "../../api";
import { STOP_FLUSH_MS, stopCollector } from "../../lifecycle";
import { createCollectorState, createLogSession } from "../../state";
import type { AdbRunner, CollectorState, LogSession } from "../../types";
import { createCtx, DEFAULT_CONFIG, deviceOf, LOG } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// onStop with a teardown ctx (global, config, state: no log, no emit): timers,
// handles, and the 2 s flush bound recorded as stopTimedOut.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A log session with a fake open handle.
 *
 * @param state - The state it joins.
 * @param name - Its file name.
 * @returns The session and its handle's close mock.
 */
function sessionIn(state: CollectorState, name: string) {
  const close = vi.fn(async () => undefined);
  const session: LogSession = createLogSession({
    device: deviceOf({ id: `d-${name}` }),
    log: LOG,
    file: join("/game", name),
    model: "SM-A266B"
  });
  session.handle = { appendFile: async () => undefined, close };
  state.sessions.set(session.key, session);
  return { session, close };
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"]
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("stopCollector", () => {
  it("resolves after STOP_FLUSH_MS for a queue that never settles and records it as stopTimedOut (bug: a teardown that logs and throws)", async () => {
    const state = createCollectorState();
    const stuck = sessionIn(state, "stuck");
    stuck.session.queue = new Promise<void>(() => undefined);
    const flushed = sessionIn(state, "flushed");
    const teardown = { global: {}, config: DEFAULT_CONFIG, state };

    let done = false;
    const stopping = stopCollector(teardown).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(STOP_FLUSH_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await stopping;

    expect(flushed.close).toHaveBeenCalledTimes(1);
    expect(stuck.close).not.toHaveBeenCalled();
    const api = createCollectorApi({ ...createCtx("/game"), state });
    expect(api.sessions().map(info => [info.device.id, info.state, info.stopTimedOut])).toEqual([
      ["d-stuck", "done", true],
      ["d-flushed", "done", false]
    ]);
  });

  it("clears the adb timers and the throttle timers and closes every handle", async () => {
    const state = createCollectorState();
    const run = vi.fn<AdbRunner>(async () => ({ code: 0, text: "", missing: false }));
    state.adb = createAdbLoop({ ...createCtx("/game"), state }, 47_600, run);
    const one = sessionIn(state, "one");
    const two = sessionIn(state, "two");
    one.session.emitTimer = setTimeout(() => undefined, 500);
    expect(vi.getTimerCount()).toBe(3);

    await stopCollector({ state });

    expect(vi.getTimerCount()).toBe(0);
    expect(state.adb).toBeUndefined();
    expect(state.stopped).toBe(true);
    expect([one.close.mock.calls.length, two.close.mock.calls.length]).toEqual([1, 1]);
    expect(one.session.handle).toBeUndefined();
    expect(run).not.toHaveBeenCalled();
  });
});
