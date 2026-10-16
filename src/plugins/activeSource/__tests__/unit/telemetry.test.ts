import { afterEach, describe, expect, it } from "vitest";
import type { DeviceTelemetry } from "../../../connect/protocol";
import { createActiveSourceApi } from "../../api";
import { startActiveSource, stopActiveSource } from "../../lifecycle";
import type { TestCtx } from "../helpers";
import { createCtx, deviceSession, localSession, settle, telemetryOf } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// Wired telemetry (spec 11 § 4, requirement 8): only the active device's
// records reach telemetry() and onTelemetry listeners.
// ─────────────────────────────────────────────────────────────────────────────

let started: TestCtx | undefined;

afterEach(() => {
  if (started !== undefined) stopActiveSource(started);
  started = undefined;
});

describe("activeSource · telemetry", () => {
  it("delivers only the active device's records, and none after useLocal", async () => {
    const { ctx, link } = createCtx();
    started = ctx;
    startActiveSource(ctx);
    const api = createActiveSourceApi(ctx);
    const seen: DeviceTelemetry[] = [];
    api.onTelemetry(record => seen.push(record));
    link.chosen = "s-1";
    link.list([localSession("s-1", false), deviceSession("s-9")], "s-1");
    await settle();

    const mine = telemetryOf("d-7f3a");
    link.publishTelemetry(mine);
    link.publishTelemetry(telemetryOf("d-11c2"));
    expect(seen).toEqual([mine]);
    expect(api.telemetry()).toBe(mine);

    await api.useLocal();
    link.publishTelemetry(telemetryOf("d-7f3a", 1_791_986_084_963));

    // Bug caught: the cards showing a phone's memory while the local preview is the source.
    expect(seen).toEqual([mine]);
    expect(api.telemetry()).toBeUndefined();
  });

  it("stops calling an unsubscribed listener", async () => {
    const { ctx, link } = createCtx();
    started = ctx;
    startActiveSource(ctx);
    const api = createActiveSourceApi(ctx);
    const seen: DeviceTelemetry[] = [];
    const off = api.onTelemetry(record => seen.push(record));
    link.list([localSession("s-1", false), deviceSession("s-9")], "s-1");
    await settle();

    off();
    link.publishTelemetry(telemetryOf("d-7f3a"));

    expect(seen).toEqual([]);
  });

  it("logs a throwing listener and still calls the others", async () => {
    const { ctx, link } = createCtx();
    started = ctx;
    startActiveSource(ctx);
    const api = createActiveSourceApi(ctx);
    const seen: DeviceTelemetry[] = [];
    api.onTelemetry(() => {
      throw new Error("boom");
    });
    api.onTelemetry(record => seen.push(record));
    link.list([localSession("s-1", false), deviceSession("s-9")], "s-1");
    await settle();

    link.publishTelemetry(telemetryOf("d-7f3a"));

    expect(seen).toHaveLength(1);
    expect(ctx.log.error).toHaveBeenCalledWith(
      "activeSource:telemetry-listener-failed",
      {},
      expect.any(Error)
    );
  });
});
