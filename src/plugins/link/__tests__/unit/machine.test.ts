import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LinkStatus } from "../../../registry/protocol";
import { applyStatus, emitStatus, lastFrameOf, nextStatus, setStatus } from "../../status/machine";
import { checkSilence, startSilenceWatch } from "../../status/silence";
import { createCtx } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The pure reducer: every row of the status table
// ─────────────────────────────────────────────────────────────────────────────

const connecting: LinkStatus = { kind: "connecting" };
const live: LinkStatus = { kind: "live", frame: 1840 };
const paused: LinkStatus = { kind: "paused", frame: 77 };
const silent: LinkStatus = { kind: "silent", since: 5000, lastFrame: 12 };
const lost: LinkStatus = { kind: "lost", reason: "game_reloaded", lastFrame: 9, retryInMs: 1000 };
const empty: LinkStatus = { kind: "empty" };

describe("nextStatus", () => {
  it("socket-open → connecting from any state", () => {
    for (const from of [live, lost, empty, silent]) {
      expect(nextStatus(from, { type: "socket-open" })).toEqual(connecting);
    }
  });

  it("socket-closed → lost with lastFrame carried from the last heartbeat", () => {
    const input = { type: "socket-closed", reason: "socket_closed", retryInMs: 2000 } as const;
    expect(nextStatus(live, input)).toEqual({
      kind: "lost",
      reason: "socket_closed",
      lastFrame: 1840,
      retryInMs: 2000
    });
    expect(nextStatus(paused, input)).toMatchObject({ lastFrame: 77 });
    expect(nextStatus(silent, input)).toMatchObject({ lastFrame: 12 });
    expect(nextStatus(lost, input)).toMatchObject({ lastFrame: 9, retryInMs: 2000 });
    expect(nextStatus(connecting, input)).toMatchObject({ lastFrame: 0 });
  });

  it("no-boot → lost no_boot with no timer", () => {
    expect(nextStatus(connecting, { type: "no-boot" })).toEqual({
      kind: "lost",
      reason: "no_boot",
      lastFrame: 0,
      retryInMs: 0
    });
  });

  it("sessions with count 0 and nothing attached → empty from connecting or empty", () => {
    const input = { type: "sessions", attached: false, count: 0 } as const;
    expect(nextStatus(connecting, input)).toEqual(empty);
    expect(nextStatus(empty, input)).toEqual(empty);
  });

  it("lost with sessions count 0 stays lost", () => {
    expect(nextStatus(lost, { type: "sessions", attached: false, count: 0 })).toBe(lost);
  });

  it("sessions with sessions or attached keeps the status", () => {
    expect(nextStatus(connecting, { type: "sessions", attached: true, count: 0 })).toBe(connecting);
    expect(nextStatus(connecting, { type: "sessions", attached: false, count: 2 })).toBe(
      connecting
    );
    expect(nextStatus(live, { type: "sessions", attached: false, count: 0 })).toBe(live);
  });

  it("attached → connecting", () => {
    expect(nextStatus(live, { type: "attached" })).toEqual(connecting);
    expect(nextStatus(lost, { type: "attached" })).toEqual(connecting);
  });

  it("heartbeat → live or paused from connecting, live, paused and silent", () => {
    for (const from of [connecting, live, paused, silent]) {
      expect(nextStatus(from, { type: "heartbeat", frame: 5, paused: false })).toEqual({
        kind: "live",
        frame: 5
      });
      expect(nextStatus(from, { type: "heartbeat", frame: 6, paused: true })).toEqual({
        kind: "paused",
        frame: 6
      });
    }
  });

  it("heartbeat leaves lost and empty alone", () => {
    expect(nextStatus(lost, { type: "heartbeat", frame: 5, paused: false })).toBe(lost);
    expect(nextStatus(empty, { type: "heartbeat", frame: 5, paused: false })).toBe(empty);
  });

  it("silence → silent from live and paused only", () => {
    expect(nextStatus(live, { type: "silence", since: 123 })).toEqual({
      kind: "silent",
      since: 123,
      lastFrame: 1840
    });
    expect(nextStatus(paused, { type: "silence", since: 9 })).toEqual({
      kind: "silent",
      since: 9,
      lastFrame: 77
    });
    expect(nextStatus(connecting, { type: "silence", since: 9 })).toBe(connecting);
    expect(nextStatus(silent, { type: "silence", since: 9 })).toBe(silent);
  });

  it("session-closed → lost with the reason and the retry delay", () => {
    expect(
      nextStatus(live, { type: "session-closed", reason: "game_reloaded", retryInMs: 1000 })
    ).toEqual({ kind: "lost", reason: "game_reloaded", lastFrame: 1840, retryInMs: 1000 });
  });

  it("lost-expired → empty from lost only", () => {
    expect(nextStatus(lost, { type: "lost-expired" })).toEqual(empty);
    expect(nextStatus(live, { type: "lost-expired" })).toBe(live);
  });

  it("lastFrameOf reads the frame of every kind", () => {
    expect(
      [connecting, live, paused, silent, lost, empty].map(status => lastFrameOf(status))
    ).toEqual([0, 1840, 77, 12, 9, 0]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// setStatus / applyStatus / emitStatus
// ─────────────────────────────────────────────────────────────────────────────

describe("setStatus", () => {
  it("stores and emits link:status with the session on a change", () => {
    const ctx = createCtx();
    ctx.state.chosen = "s-1";

    expect(setStatus(ctx, live)).toBe(true);
    expect(ctx.state.status).toEqual(live);
    expect(ctx.emit).toHaveBeenCalledWith("link:status", { status: live, session: "s-1" });
  });

  it("does not emit when nothing changed", () => {
    const ctx = createCtx();
    expect(setStatus(ctx, { kind: "connecting" })).toBe(false);
    expect(ctx.emit).not.toHaveBeenCalled();
  });

  it("emits on a new frame and on a new retryInMs", () => {
    const ctx = createCtx();
    setStatus(ctx, live);
    setStatus(ctx, { kind: "live", frame: 1841 });
    setStatus(ctx, lost);
    setStatus(ctx, { ...lost, retryInMs: 2000 });
    expect(ctx.emit).toHaveBeenCalledTimes(4);
  });

  it("emitStatus omits session when none is chosen", () => {
    const ctx = createCtx();
    emitStatus(ctx);
    expect(ctx.emit).toHaveBeenCalledWith("link:status", { status: { kind: "connecting" } });
  });

  it("applyStatus runs the reducer on the current status", () => {
    const ctx = createCtx();
    expect(applyStatus(ctx, { type: "heartbeat", frame: 3, paused: false })).toBe(true);
    expect(ctx.state.status).toEqual({ kind: "live", frame: 3 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// checkSilence: the R6 silent rule
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A ctx that just got a heartbeat.
 *
 * @param isPaused - The heartbeat's paused flag.
 * @returns The ctx.
 */
function afterBeat(isPaused: boolean) {
  const ctx = createCtx();
  ctx.state.heartbeat = { frame: 50, paused: isPaused, receivedAt: Date.now() };
  ctx.state.status = isPaused ? { kind: "paused", frame: 50 } : { kind: "live", frame: 50 };
  return ctx;
}

describe("checkSilence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("live turns silent after 6 s without a beat", () => {
    const ctx = afterBeat(false);
    vi.advanceTimersByTime(5999);
    checkSilence(ctx);
    expect(ctx.state.status.kind).toBe("live");

    vi.advanceTimersByTime(1);
    checkSilence(ctx);
    expect(ctx.state.status).toEqual({ kind: "silent", since: 100_000, lastFrame: 50 });
  });

  it("paused stays paused at 60 s and turns silent at 65 s (R6)", () => {
    const ctx = afterBeat(true);
    vi.advanceTimersByTime(60_000);
    checkSilence(ctx);
    expect(ctx.state.status.kind).toBe("paused");

    vi.advanceTimersByTime(5000);
    checkSilence(ctx);
    expect(ctx.state.status).toEqual({ kind: "silent", since: 100_000, lastFrame: 50 });
  });

  it("a new beat resets the clock", () => {
    const ctx = afterBeat(false);
    vi.advanceTimersByTime(5000);
    ctx.state.heartbeat = { frame: 51, paused: false, receivedAt: Date.now() };
    vi.advanceTimersByTime(5000);
    checkSilence(ctx);
    expect(ctx.state.status.kind).toBe("live");
  });

  it("does nothing without a heartbeat, outside live/paused or after stop", () => {
    const ctx = createCtx();
    vi.advanceTimersByTime(100_000);
    checkSilence(ctx);
    expect(ctx.state.status.kind).toBe("connecting");

    const stopped = afterBeat(false);
    stopped.state.stopped = true;
    vi.advanceTimersByTime(10_000);
    checkSilence(stopped);
    expect(stopped.state.status.kind).toBe("live");
  });

  it("startSilenceWatch checks once a second", () => {
    const ctx = afterBeat(false);
    startSilenceWatch(ctx);
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(6000);
    expect(ctx.state.status.kind).toBe("silent");
    clearInterval(ctx.state.silenceTimer);
  });
});
