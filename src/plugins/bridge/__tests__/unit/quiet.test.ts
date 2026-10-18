import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connect } from "../../connection/loop";
import { deviceDeps, editorNote, flush, LAN, socketOf } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// Quiet when no computer: one info line per streak before the page ever
// linked, a warning after a live link, the page backoff.
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Fails `count` attempts in a row: each socket closes before it opened.
 *
 * @param deps - The test deps (connected once already).
 * @param count - How many attempts fail.
 */
async function failAttempts(deps: ReturnType<typeof deviceDeps>, count: number): Promise<void> {
  for (let attempt = 0; attempt < count; attempt += 1) {
    socketOf(deps, attempt).emit("close", { code: 1006, reason: "" });
    await vi.advanceTimersByTimeAsync(deps.state.status.kind === "lost" ? 31_000 : 0);
  }
}

describe("device mode with no computer", () => {
  it("logs one info line for five failed attempts, the rest at debug", async () => {
    const deps = deviceDeps();
    await connect(deps);

    await failAttempts(deps, 5);

    expect(deps.log.info.mock.calls).toEqual([
      ["bridge:no-computer", { address: LAN, retryInMs: 1000 }]
    ]);
    expect(deps.log.warn).not.toHaveBeenCalled();
    expect(deps.log.debug.mock.calls.filter(([event]) => event === "bridge:lost")).toHaveLength(4);
  });

  it("warns once on a loss after a live link", async () => {
    const deps = deviceDeps();
    deps.state.remembered.links[LAN] = { device: "d-7f3a", token: "t" };
    await connect(deps);
    socketOf(deps).open();
    socketOf(deps).emit("message", {
      data: editorNote("session", { id: "s-1", open: true, engine: "0.14.12+9c41e0" })
    });
    deps.log.info.mockClear();

    socketOf(deps).emit("close", { code: 1006, reason: "" });

    expect(deps.log.warn).toHaveBeenCalledWith("bridge:lost", {
      reason: "socket closed (1006)",
      retryInMs: 1000
    });
    expect(deps.log.info).not.toHaveBeenCalled();
  });

  it("a stale token closed 4401, then no computer: info bridge:no-computer, not a warning", async () => {
    const deps = deviceDeps();
    deps.state.remembered.links[LAN] = { device: "d-7f3a", token: "dead" };
    await connect(deps);
    socketOf(deps).open();
    socketOf(deps).emit("close", { code: 4401, reason: "unpaired" });
    await flush();

    socketOf(deps, 1).emit("close", { code: 1006, reason: "" });

    expect(deps.log.warn).not.toHaveBeenCalled();
    expect(deps.log.info).toHaveBeenCalledWith("bridge:no-computer", {
      address: LAN,
      retryInMs: 1000
    });
  });

  it("a session starts the streak over: each loss after a session waits the first delay", async () => {
    const deps = deviceDeps();
    deps.state.remembered.links[LAN] = { device: "d-7f3a", token: "t" };
    await connect(deps);
    const delays: number[] = [];

    for (let link = 0; link < 2; link += 1) {
      const socket = socketOf(deps, link);
      socket.open();
      socket.emit("message", {
        data: editorNote("session", { id: `s-${String(link)}`, open: true })
      });
      socket.emit("close", { code: 1006, reason: "" });
      const { status } = deps.state;
      if (status.kind === "lost") delays.push(status.retryInMs);
      await vi.advanceTimersByTimeAsync(31_000);
    }

    expect(delays).toEqual([1000, 1000]);
  });

  it("backs off like page mode: 1000, 2000, 4000 with random 0.5", async () => {
    const deps = deviceDeps();
    await connect(deps);
    const delays: number[] = [];

    for (let attempt = 0; attempt < 3; attempt += 1) {
      socketOf(deps, attempt).emit("close", { code: 1006, reason: "" });
      const { status } = deps.state;
      if (status.kind === "lost") delays.push(status.retryInMs);
      await vi.advanceTimersByTimeAsync(31_000);
    }

    expect(delays).toEqual([1000, 2000, 4000]);
  });
});
