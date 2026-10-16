/* eslint-disable unicorn/no-null -- null is "no session" on an attach record */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { currentDirectory } from "../../directory";
import { createAttachRecord } from "../../state";
import type { AdbResult } from "../../types";
import { renewScan, scanOnce } from "../../wire/scan";
import { a26, a26Device, createCtx, fakeRunner, fixture, MISSING, ok, SERIAL } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// spec 11 C4: the scan loop — adb devices -l every scanEveryMs while a scan
// lease holds or device mode is on, getprop once per new ready phone, adb
// missing stops it until the next connect.scan.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Whether an argv is `adb devices -l`.
 *
 * @param args - The argv.
 * @returns True for it.
 */
function isList(args: readonly string[]): boolean {
  return args[0] === "devices";
}

/** A second A26 on USB. */
const TWIN = "R5CX30ZZZZZ";

/**
 * Two A26s on USB: the first runs the garden (ps-a26.txt), the twin runs no game.
 *
 * @param args - The argv.
 * @returns The answer.
 */
function twoA26(args: readonly string[]): AdbResult {
  if (isList(args)) {
    return ok(`List of devices attached\n${SERIAL} device usb:1-1\n${TWIN} device usb:1-2\n\n`);
  }
  if (args[3] === "getprop") return ok(fixture("getprop-a26.txt"));
  if (args[3] === "ps" && args[1] === TWIN) return ok("  PID NAME\n  612 surfaceflinger\n");
  return a26(args);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the scan", () => {
  it("asks getprop once per ready phone, never for an unauthorized one", async () => {
    // Bug: a getprop per phone every 2 s, or a shell on a phone that did not allow debugging.
    const ctx = createCtx();
    await scanOnce(ctx);
    await scanOnce(ctx);
    const getprops = ctx.run
      .calls()
      .filter(args => args[3] === "getprop")
      .map(args => args[1]);
    expect(getprops).toEqual([SERIAL, "192.168.1.23:37011"]);
    expect(ctx.state.wire.get(SERIAL)?.facts).toEqual({
      model: "SM-A266B",
      name: "Galaxy A26",
      os: "Android 15"
    });
    expect(ctx.state.wire.get("RZ8T20QWERT")?.facts).toBeUndefined();
  });

  it("asks getprop again on the next round when it failed", async () => {
    let failing = true;
    const run = fakeRunner(args =>
      args[3] === "getprop" && failing ? { code: 1, text: "", missing: false } : a26(args)
    );
    const ctx = createCtx({ run });
    await scanOnce(ctx);
    failing = false;
    await scanOnce(ctx);
    expect(ctx.state.wire.get(SERIAL)?.facts?.model).toBe("SM-A266B");
  });

  it("runs every scanEveryMs while the lease holds, then stops", async () => {
    const ctx = createCtx();
    renewScan(ctx);
    await vi.advanceTimersByTimeAsync(9000);
    expect(ctx.run.calls().filter(args => isList(args))).toHaveLength(5);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(ctx.run.calls().filter(args => isList(args))).toHaveLength(5);
    expect(ctx.state.timers.scan).toBeUndefined();
  });

  it("says adb is missing and stops until the next connect.scan retries", async () => {
    let missing = true;
    const ctx = createCtx({ run: fakeRunner(args => (missing ? MISSING : a26(args))) });
    renewScan(ctx);
    await vi.advanceTimersByTimeAsync(6000);
    expect(ctx.run.calls()).toEqual([["devices", "-l"]]);
    expect(ctx.state.adb).toEqual({ available: false, reason: "missing" });

    missing = false;
    renewScan(ctx);
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.state.adb).toEqual({ available: true, reason: undefined });
    expect(ctx.state.wire.size).toBe(4);
  });

  it("calls a failing adb an error and keeps the phones it knew", async () => {
    let failing = false;
    const ctx = createCtx({
      run: fakeRunner(args =>
        failing ? ({ code: -1, text: "", missing: false } satisfies AdbResult) : a26(args)
      )
    });
    await scanOnce(ctx);
    failing = true;
    await scanOnce(ctx);
    expect(ctx.state.adb).toEqual({ available: false, reason: "error" });
    expect(ctx.state.wire.size).toBe(4);
  });

  it("asks ps of two phones of one model only while their linked device names an app, and links the one running it", async () => {
    // Bug: ps on every phone every 2 s, or two A26s left ambiguous although the app tells them apart.
    const single = createCtx();
    single.hub.linked.push(a26Device({ appId: "com.moku.garden.debug" }));
    await scanOnce(single);
    expect(single.run.calls().filter(args => args[3] === "ps")).toEqual([]);

    const ctx = createCtx({ run: fakeRunner(twoA26) });
    ctx.hub.linked.push(a26Device());
    await scanOnce(ctx);
    expect(ctx.run.calls().filter(args => args[3] === "ps")).toEqual([]);

    ctx.hub.linked[0] = a26Device({ appId: "com.moku.garden.debug" });
    await scanOnce(ctx);
    expect(
      ctx.run
        .calls()
        .filter(args => args[3] === "ps")
        .map(args => args[1])
    ).toEqual([SERIAL, TWIN]);
    expect(currentDirectory(ctx).wire.map(phone => [phone.serial, phone.device])).toEqual([
      [SERIAL, "d-7f3a"],
      [TWIN, null]
    ]);
  });

  it("forgets a phone that left and detaches its telemetry", async () => {
    let unplugged = false;
    const ctx = createCtx({
      run: fakeRunner(args =>
        unplugged && isList(args) ? ok("List of devices attached\n\n") : a26(args)
      )
    });
    await scanOnce(ctx);
    const attach = createAttachRecord("d-7f3a", SERIAL, null);
    ctx.state.attaches.set("d-7f3a", attach);

    unplugged = true;
    await scanOnce(ctx);
    expect(ctx.state.wire.size).toBe(0);
    expect(attach.ended).toBe(true);
    expect(ctx.state.attaches.size).toBe(0);
  });
});
