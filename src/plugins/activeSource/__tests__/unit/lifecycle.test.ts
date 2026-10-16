/* eslint-disable unicorn/no-null -- null is a JSON value on the wire (device mode off, no latency) */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createActiveSourceApi } from "../../api";
import { checkActiveSourceConfig, startActiveSource, stopActiveSource } from "../../lifecycle";
import { createCtx, deviceSession, directoryOf, localSession, settle, wireOf } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle (spec 11 § 4): onInit refuses a bad config with two-line
// TypeErrors; onStop is state-only — no interval, timer, subscription or
// listener left, nothing emitted or logged, the local preview not resumed.
// ─────────────────────────────────────────────────────────────────────────────

afterEach(() => {
  vi.useRealTimers();
});

describe("activeSource · onStop", () => {
  it("leaves no interval, timer, subscription or listener, and emits and logs nothing", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"]
    });
    const { ctx, link } = createCtx({ autoUse: true });
    startActiveSource(ctx);
    const api = createActiveSourceApi(ctx);
    api.onChange(() => undefined);
    api.onTelemetry(() => undefined);
    link.list([localSession("s-1", false), deviceSession("s-9")], "s-1");
    await settle();
    link.list([localSession("s-1", false)]);
    await settle();
    api.scan();
    link.devices = directoryOf({
      mode: { on: false, owner: null, listen: null },
      wire: [wireOf({ phase: "ready", device: null })],
      linked: []
    });
    const waiting = api.connectDevice("R5CX30ABCDE").catch((error: unknown) => error);
    await settle();
    expect(ctx.state.timers.renew).toBeDefined();
    expect(ctx.state.timers.notice).toBeDefined();
    ctx.emit.mockClear();
    const calls = link.callEditor.mock.calls.length;

    stopActiveSource({ config: ctx.config, state: ctx.state });

    expect(vi.getTimerCount()).toBe(0);
    expect(link.sessionListeners.size).toBe(0);
    expect(link.heartbeatListeners.size).toBe(0);
    expect([...link.publishedListeners.values()].every(listeners => listeners.size === 0)).toBe(
      true
    );
    expect(ctx.state.listeners.size + ctx.state.telemetryListeners.size).toBe(0);
    expect(await waiting).toBeInstanceOf(Error);
    // Bug caught: a teardown that talks to a stopping link or keeps the page alive.
    expect(ctx.emit).not.toHaveBeenCalled();
    expect(ctx.log.info).not.toHaveBeenCalled();
    expect(link.callEditor.mock.calls.length).toBe(calls);
    expect(link.commands()).toEqual(["s-1 game.pause", "s-1 game.resume"]);
  });

  it("ignores a sessions list that arrives after stop", async () => {
    const { ctx, link } = createCtx();
    startActiveSource(ctx);
    const late = [...link.sessionListeners];
    stopActiveSource(ctx);

    for (const listener of late) listener([localSession("s-1", false), deviceSession("s-9")]);
    await settle();

    expect(link.choose).not.toHaveBeenCalled();
  });
});

describe("activeSource · onInit", () => {
  it("accepts the defaults", () => {
    const { ctx } = createCtx();
    expect(() => checkActiveSourceConfig(ctx)).not.toThrow();
  });

  it("refuses a flag that is not a boolean", () => {
    const { ctx } = createCtx({ autoUse: "yes" as unknown as boolean });
    expect(() => checkActiveSourceConfig(ctx)).toThrow(
      new TypeError('[moku-editor] activeSource.autoUse is "yes".\n  Give true or false.')
    );
  });

  it.each([
    ["rejoinMs", 600_001, "Give a whole number from 0 to 600000, for example 15000."],
    ["noticeMs", 999, "Give a whole number from 1000 to 120000, for example 12000."],
    ["renewMs", 4000.5, "Give a whole number from 500 to 60000, for example 4000."],
    ["markers", 0, "Give a whole number from 1 to 512, for example 32."]
  ] as const)("refuses %s = %s with the range in the message", (field, value, fix) => {
    const { ctx } = createCtx({ [field]: value });
    expect(() => checkActiveSourceConfig(ctx)).toThrow(
      new TypeError(`[moku-editor] activeSource.${field} is ${String(value)}.\n  ${fix}`)
    );
  });

  it("accepts the bounds: rejoinMs 0 turns rejoin off", () => {
    const { ctx } = createCtx({ rejoinMs: 0, noticeMs: 120_000, renewMs: 500, markers: 512 });
    expect(() => checkActiveSourceConfig(ctx)).not.toThrow();
  });
});
