import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { teardownDevices } from "../../device/listen";
import { devicesOf } from "../../device/records";
import type { DeviceHarness, FakeSocket } from "../helpers";
import { createDeviceHarness, pairAdb } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// Device link latency (spec 11 § 5.1 H4): every paired device connection is
// pinged once a second; the pong that carries the payload of the last ping sets
// the record's `latencyMs` (null before the first pong), reported in
// `LinkedDevice.latencyMs`. Bugs: a latency taken from Bun's own keep-alive
// pong, a missing pong wiping the last value, and the ping interval keeping a
// stopped hub alive.
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/**
 * Answers the newest ping of a socket with its payload.
 *
 * @param harness - The device harness.
 * @param socket - The phone's socket.
 * @param payload - The payload the pong echoes (default: the newest ping's).
 */
function pong(harness: DeviceHarness, socket: FakeSocket, payload = socket.pings.at(-1)): void {
  harness.handler.pong(socket, new TextEncoder().encode(payload ?? ""));
}

/**
 * The latency the hub reports for its first device.
 *
 * @param harness - The device harness.
 * @returns `LinkedDevice.latencyMs` of the first device.
 */
function latencyOf(harness: DeviceHarness): number | null | undefined {
  return devicesOf(harness.ctx.state)[0]?.latencyMs;
}

describe("device ping", () => {
  it("pings paired device connections once a second and sets latencyMs from the matching pong", async () => {
    const harness = await createDeviceHarness();
    const { socket } = pairAdb(harness);
    const game = harness.connect("agent");
    const pairing = harness.device({ link: "adb", address: "127.0.0.1" });
    const tools = harness.connect("tools");
    expect(latencyOf(harness)).toBeNull();

    await vi.advanceTimersByTimeAsync(1000);
    expect(socket.pings).toHaveLength(1);
    expect([game.pings, pairing.pings, tools.pings]).toEqual([[], [], []]);

    await vi.advanceTimersByTimeAsync(9);
    pong(harness, socket);
    expect(latencyOf(harness)).toBe(9);
  });

  it("keeps the last value when no pong comes, and ignores a pong without the ping's payload (Bun's keep-alive)", async () => {
    const harness = await createDeviceHarness();
    const { socket } = pairAdb(harness);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(9);
    pong(harness, socket);

    await vi.advanceTimersByTimeAsync(2000);
    expect(socket.pings).toHaveLength(3);
    expect(latencyOf(harness)).toBe(9);

    await vi.advanceTimersByTimeAsync(400);
    pong(harness, socket, "");
    pong(harness, socket, socket.pings[1]);
    expect(latencyOf(harness)).toBe(9);
  });

  it("clears the ping interval in teardownDevices (bug: a ping interval keeping a stopped hub alive)", async () => {
    const harness = await createDeviceHarness();
    pairAdb(harness);
    expect(vi.getTimerCount()).toBe(1);

    await teardownDevices(harness.ctx.state);

    expect(vi.getTimerCount()).toBe(0);
    expect(harness.ctx.state.pingTimer).toBeUndefined();
  });
});
