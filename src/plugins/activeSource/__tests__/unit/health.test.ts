/* eslint-disable unicorn/no-null -- null is a JSON value on the wire (device mode off, no latency) */
import { afterEach, describe, expect, it } from "vitest";
import { createActiveSourceApi } from "../../api";
import { medianOffset, noteOffset, offsetOf, resetOffsets } from "../../health";
import { startActiveSource, stopActiveSource } from "../../lifecycle";
import { createActiveSourceState } from "../../state";
import type { TestCtx } from "../helpers";
import { createCtx, deviceSession, directoryOf, linkedOf, localSession, settle } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// Link health and the clock offset (spec 11 § 4 health, clockOffsetMs): one
// sample per directory update of the active device in a ring allocated once,
// and the median of the last 8 heartbeat offsets.
// ─────────────────────────────────────────────────────────────────────────────

let started: TestCtx | undefined;

afterEach(() => {
  if (started !== undefined) stopActiveSource(started);
  started = undefined;
});

describe("activeSource.health", () => {
  it("takes one sample per directory update of the active device into the same ring, NaN for a gap", async () => {
    const { ctx, link } = createCtx();
    started = ctx;
    startActiveSource(ctx);
    const api = createActiveSourceApi(ctx);
    link.list([localSession("s-1", false), deviceSession("s-9")], "s-1");
    await settle();
    const ring = api.health().samples;

    link.publishDevices(directoryOf({ linked: [linkedOf({ latencyMs: 9 })] }));
    link.publishDevices(directoryOf({ linked: [linkedOf({ latencyMs: null })] }));
    link.publishDevices(directoryOf({ linked: [linkedOf({ latencyMs: 12 })] }));

    const health = api.health();
    // Bug caught: a per-second array behind the health sparkline.
    expect(health.samples).toBe(ring);
    expect(health).toMatchObject({ kind: "wire", latencyMs: 12 });
    expect(health.samples.slice(health.head - 2, health.head + 1)).toEqual(
      new Float32Array([9, Number.NaN, 12])
    );
  });

  it("reads no latency for the local preview", () => {
    const { ctx } = createCtx();
    expect(createActiveSourceApi(ctx).health()).toMatchObject({ kind: "local", latencyMs: null });
  });
});

describe("activeSource.clockOffsetMs", () => {
  it("is 0 for the local preview and null for a device before two beats", async () => {
    const { ctx, link } = createCtx();
    started = ctx;
    startActiveSource(ctx);
    const api = createActiveSourceApi(ctx);
    expect(api.clockOffsetMs()).toBe(0);

    link.list([localSession("s-1", false), deviceSession("s-9")], "s-1");
    await settle();

    // Bug caught: telemetry placed on the phone's axis with the computer's clock (offset 0).
    expect(api.clockOffsetMs()).toBeNull();
  });

  it("estimates phone − computer from the beat time and the ping midpoint", () => {
    // Sent at phone 10 000, received at computer 10 420 with a 16 ms round trip: sent at 10 412.
    expect(offsetOf(10_000, 10_420, 16)).toBe(-412);
  });

  it("is null before two beats, then the median of the last 8 (one late beat moves nothing)", () => {
    const { offsets } = createActiveSourceState();
    noteOffset(offsets, -412);
    expect(medianOffset(offsets)).toBeNull();
    noteOffset(offsets, -410);
    noteOffset(offsets, -900);
    expect(medianOffset(offsets)).toBe(-412);
    resetOffsets(offsets);
    for (const value of [-410, -414, -411, -413, -409, -415, -412]) noteOffset(offsets, value);
    noteOffset(offsets, 90);

    // Bug caught: one late heartbeat throwing every GC mark half a second off.
    expect(medianOffset(offsets)).toBe(-411.5);
    expect(offsets.count).toBe(8);
  });
});
