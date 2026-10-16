import { describe, expectTypeOf, it } from "vitest";
import type { ServerEvents } from "../../../../config";
import { createServerPlugin } from "../../../../config";
import type { DeviceTelemetry } from "../../../connect/protocol";
import { collectorPlugin } from "../..";
import type {
  CollectorConfig,
  CollectorCtx,
  CollectorHooks,
  CollectorSessionEvent
} from "../../types";

// ─────────────────────────────────────────────────────────────────────────────
// Type-level checks of the per-plugin event collector:session and the config
// (checked by tsc; vitest does not run *.test-d.ts files).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Emits a session event without its device: a compile error.
 *
 * @param emit - The collector's emit.
 */
function emitWithoutDevice(emit: CollectorCtx["emit"]): void {
  // @ts-expect-error — collector:session carries the device, state, counts and digest
  emit("collector:session", { file: "/game/.moku/perf/a.jsonl" });
}

describe("collector:session types", () => {
  it("lets a plugin that depends on collectorPlugin hook collector:session, typed CollectorSessionEvent", () => {
    const watcher = createServerPlugin("liveLine", {
      depends: [collectorPlugin],
      hooks: () => ({
        "collector:session": (event: CollectorSessionEvent) => {
          expectTypeOf(event.state).toEqualTypeOf<"live" | "away" | "done">();
          expectTypeOf(event.last?.rate).toEqualTypeOf<number | null | undefined>();
        }
      })
    });
    expectTypeOf(watcher.name).toEqualTypeOf<"liveLine">();
  });

  it("refuses a hook of collector:session in a plugin that does not depend on collectorPlugin", () => {
    const blind = createServerPlugin("blindLine", {
      // @ts-expect-error — collector:session is the collector's per-plugin event, visible through depends only
      hooks: () => ({ "collector:session": (_event: CollectorSessionEvent) => undefined })
    });
    expectTypeOf(blind.name).toEqualTypeOf<"blindLine">();
  });

  it("keeps collector:session out of the global ServerEvents (bug: the event leaking into every plugin)", () => {
    type Leaked = "collector:session" extends keyof ServerEvents ? true : false;
    expectTypeOf<Leaked>().toEqualTypeOf<false>();
  });

  it("refuses a session event without its device", () => {
    expectTypeOf(emitWithoutDevice).toBeFunction();
  });

  it("types the collector's connect:telemetry hook with connect's DeviceTelemetry (bug: a hand-copied record shape drifting from connect's)", () => {
    expectTypeOf<
      Parameters<CollectorHooks["connect:telemetry"]>[0]
    >().toEqualTypeOf<DeviceTelemetry>();
  });

  // eslint-disable-next-line sonarjs/todo-tag -- waits for the engine's 0.15.x types (agreed 2026-10-16)
  // TODO(engine): the 0.15.x patch (U4) lists `telemetry` and `gap` as collector-written kinds in the
  // engine's PerfLogLine union (types only). The installed @moku-labs/game 0.15.0 exports neither
  // line type; once it does, assert PerfTelemetryLine and PerfGapLine assignable to them here.

  it("refuses a numeric appId", () => {
    const config: CollectorConfig = {
      out: ".moku/perf",
      everyS: 10,
      reverseEveryMs: 2000,
      adb: "adb",
      adbTimeoutMs: 5000,
      // @ts-expect-error — appId is the Android package name, a string
      appId: 42
    };
    expectTypeOf(config.appId).toEqualTypeOf<string | undefined>();
  });
});
