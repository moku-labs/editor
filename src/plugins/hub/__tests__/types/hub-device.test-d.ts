import { describe, expectTypeOf, it } from "vitest";
import { createServerPlugin } from "../../../../config";
import type { PerfLogLine } from "../../../perf/protocol";
import type { Json } from "../../../registry/protocol";
import { hubPlugin } from "../..";
import type { LinkJson } from "../../protocol";
import type { DeviceLines, HubApi, HubCtx, HubDeviceEvent } from "../../types";

// ─────────────────────────────────────────────────────────────────────────────
// Type-level checks of the per-plugin event hub:device, of the device-link
// types and of the editor methods another plugin registers (checked by tsc;
// vitest does not run *.test-d.ts files).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Registers a handler that answers synchronously, and one that answers a value no wire carries:
 * compile errors (H2: a handler is async and answers Json).
 *
 * @param hub - The hub api.
 */
function registerWrong(hub: HubApi): void {
  // @ts-expect-error — an editor method answers a promise
  hub.addEditorMethods({ "connect.scan": () => ({ wire: [] }) });
  // @ts-expect-error — the answer goes on the wire: Json only
  hub.addEditorMethods({ "connect.scan": async () => new Map<string, number>() });
}

/**
 * Emits a lines event without its device and lines: a compile error.
 *
 * @param emit - The hub's emit.
 */
function emitWrong(emit: HubCtx["emit"]): void {
  // @ts-expect-error — a lines event carries device and lines
  emit("hub:device", { kind: "lines" });
}

describe("hub:device types", () => {
  it("lets a plugin that depends on hubPlugin hook hub:device and narrow on kind", () => {
    const watcher = createServerPlugin("deviceWatch", {
      depends: [hubPlugin],
      hooks: () => ({
        "hub:device": (event: HubDeviceEvent) => {
          if (event.kind === "lines")
            expectTypeOf(event.lines.items).toEqualTypeOf<readonly PerfLogLine[]>();
          if (event.kind === "closed")
            expectTypeOf(event.reason).toEqualTypeOf<"bye" | "lost" | "replaced" | "stopped">();
        }
      })
    });
    expectTypeOf(watcher.name).toEqualTypeOf<"deviceWatch">();
  });

  it("refuses a hook of hub:device in a plugin that does not depend on hubPlugin", () => {
    const blind = createServerPlugin("blind", {
      // @ts-expect-error — hub:device is the hub's per-plugin event, visible through depends only
      hooks: () => ({ "hub:device": (_event: HubDeviceEvent) => undefined })
    });
    expectTypeOf(blind.name).toEqualTypeOf<"blind">();
  });

  it("refuses a lines event without its device and lines", () => {
    expectTypeOf(emitWrong).toBeFunction();
  });

  it("types the items of a device log batch as PerfLogLine (bug: loose records the collector must cast)", () => {
    expectTypeOf<DeviceLines["items"][number]>().toEqualTypeOf<PerfLogLine>();
  });

  it("refuses an editor method that is not async or answers a value that is no Json", () => {
    expectTypeOf(registerWrong).toBeFunction();
  });

  it("keeps LinkJson and registry/protocol's Json assignable both ways", () => {
    expectTypeOf<LinkJson>().toExtend<Json>();
    expectTypeOf<Json>().toExtend<LinkJson>();
  });
});
