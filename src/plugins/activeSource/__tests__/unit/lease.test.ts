import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createActiveSourceApi } from "../../api";
import { startActiveSource, stopActiveSource } from "../../lifecycle";
import type { TestCtx } from "../helpers";
import { createCtx, deviceSession, localSession, settle } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The leases on connect (spec 11 § 4 B4 step 4, scan()): renewed every renewMs
// while needed, and only then.
// ─────────────────────────────────────────────────────────────────────────────

let started: TestCtx | undefined;

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"]
  });
});

afterEach(() => {
  if (started !== undefined) stopActiveSource(started);
  started = undefined;
  vi.useRealTimers();
});

/**
 * Counts the calls of one editor method.
 *
 * @param methods - The methods callEditor received.
 * @param method - The method.
 * @returns How many.
 */
function count(methods: readonly string[], method: string): number {
  return methods.filter(name => name === method).length;
}

describe("activeSource · leases", () => {
  it("scan() calls connect.scan now and every renewMs until its stop", async () => {
    const { ctx, link } = createCtx();
    started = ctx;
    startActiveSource(ctx);
    const api = createActiveSourceApi(ctx);

    const stop = api.scan();
    expect(count(link.methods(), "connect.scan")).toBe(1);
    await vi.advanceTimersByTimeAsync(8000);
    expect(count(link.methods(), "connect.scan")).toBe(3);
    stop();
    stop();
    await vi.advanceTimersByTimeAsync(20_000);

    // Bug caught: the panel closed and the computer keeps polling adb for nobody.
    expect(count(link.methods(), "connect.scan")).toBe(3);
    expect(ctx.state.timers.renew).toBeUndefined();
  });

  it("renews the watch lease while a device is the source and stops on a switch", async () => {
    const { ctx, link } = createCtx();
    started = ctx;
    startActiveSource(ctx);
    const api = createActiveSourceApi(ctx);
    link.list([localSession("s-1", false), deviceSession("s-9")], "s-1");
    await settle();
    expect(count(link.methods(), "connect.watch")).toBe(1);

    await vi.advanceTimersByTimeAsync(4000);
    expect(count(link.methods(), "connect.watch")).toBe(2);
    await api.useLocal();
    await vi.advanceTimersByTimeAsync(12_000);

    expect(count(link.methods(), "connect.watch")).toBe(2);
    expect(link.callEditor).toHaveBeenLastCalledWith("connect.unwatch", { device: "d-7f3a" });
  });
});
