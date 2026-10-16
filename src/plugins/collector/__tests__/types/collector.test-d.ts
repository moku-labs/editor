import type { PerfLogLine as EngineLogLine } from "@moku-labs/game";
import { describe, expectTypeOf, it } from "vitest";
import type { ServerEvents } from "../../../../config";
import { createServerPlugin } from "../../../../config";
import type { DeviceTelemetry } from "../../../connect/protocol";
import { collectorPlugin } from "../..";
import type { PerfGapLine } from "../../report";
import type {
  CollectorConfig,
  CollectorCtx,
  CollectorHooks,
  CollectorSessionEvent,
  PerfTelemetryLine
} from "../../types";

// ─────────────────────────────────────────────────────────────────────────────
// Type-level checks of the per-plugin event collector:session and the config
// (checked by tsc; vitest does not run *.test-d.ts files).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A line as `JSON.parse` gives it back from the computer file: the same fields, every array
 * mutable (the engine's `Json` holds mutable arrays).
 */
type Parsed<Value> = Value extends readonly (infer Item)[]
  ? Parsed<Item>[]
  : Value extends object
    ? { -readonly [Key in keyof Value]: Parsed<Value[Key]> }
    : Value;

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

  it("writes telemetry and gap lines the engine's PerfLogLine lists (engine U4, 0.15.1; bug: a collector line a reader of the engine's union refuses)", () => {
    // The engine reads the computer file's lines as JSON.parse gives them back: arrays mutable.
    expectTypeOf<Parsed<PerfTelemetryLine>>().toExtend<
      Extract<EngineLogLine, { kind: "telemetry" }>
    >();
    expectTypeOf<Parsed<PerfGapLine>>().toExtend<Extract<EngineLogLine, { kind: "gap" }>>();
  });

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
