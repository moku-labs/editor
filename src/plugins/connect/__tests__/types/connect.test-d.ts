import { describe, expectTypeOf, it } from "vitest";
import { createServerPlugin } from "../../../../config";
import type { PublishParams } from "../../../registry/protocol";
import { connectPlugin } from "../..";
import type { DeviceDirectory, DeviceTelemetry, Reading } from "../../protocol";

// ─────────────────────────────────────────────────────────────────────────────
// Type-level checks of connect's per-plugin event and published values
// (checked by tsc; vitest does not run *.test-d.ts files).
// ─────────────────────────────────────────────────────────────────────────────

describe("connect types", () => {
  it("lets a plugin that depends on connectPlugin hook connect:telemetry typed DeviceTelemetry", () => {
    const recorder = createServerPlugin("telemetryLog", {
      depends: [connectPlugin],
      hooks: () => ({
        "connect:telemetry": (record: DeviceTelemetry) => {
          expectTypeOf(record.memory.app).toEqualTypeOf<DeviceTelemetry["memory"]["app"]>();
        }
      })
    });
    expectTypeOf(recorder.name).toEqualTypeOf<"telemetryLog">();
  });

  it("refuses connect:telemetry in a plugin that does not depend on connectPlugin", () => {
    const blind = createServerPlugin("blindTelemetry", {
      // @ts-expect-error — connect:telemetry is connect's per-plugin event, visible through depends only
      hooks: () => ({ "connect:telemetry": (_record: DeviceTelemetry) => undefined })
    });
    expectTypeOf(blind.name).toEqualTypeOf<"blindTelemetry">();
  });

  it("publishes the directory and the telemetry with connect's types", () => {
    expectTypeOf<PublishParams["devices"]>().toEqualTypeOf<DeviceDirectory>();
    expectTypeOf<PublishParams["deviceTelemetry"]>().toEqualTypeOf<DeviceTelemetry>();
  });

  it("gives a reading that is not available no value", () => {
    const off: Reading<number> = { available: false, source: "none", reason: "not-wired" };
    // @ts-expect-error — an unavailable reading has no value
    const value: number = off.value;
    expectTypeOf(value).toBeNumber();
    const reading = { available: true, source: "/sys/kernel/gpu", value: 221 } as Reading<number>;
    if (reading.available) expectTypeOf(reading.value).toBeNumber();
  });
});
