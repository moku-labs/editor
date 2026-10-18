import { describe, expect, it } from "vitest";
import { mergePluginConfigs, perfConfigOf } from "../../plugin-configs";
import type { PerfArgs } from "../../types";

/** `moku-editor perf --lan --port 47601 --out logs --every 5 --no-ui`. */
const ARGS: PerfArgs = { kind: "perf", lan: true, port: 47_601, out: "logs", every: 5, ui: false };

describe("perfConfigOf", () => {
  it("puts every switch into the plugin that owns it, with no project index", () => {
    expect(perfConfigOf(ARGS, "/game", "com.example.garden")).toEqual({
      files: { root: "/game", project: false },
      hub: { devicePort: 47_601, deviceLan: true },
      collector: { out: "logs", everyS: 5, appId: "com.example.garden" },
      pages: { toolsPage: false }
    });
  });

  it("leaves appId out of the collector when the game has none", () => {
    const configs = perfConfigOf({ ...ARGS, ui: true }, "/game", undefined);
    expect("appId" in configs.collector).toBe(false);
    expect(configs.pages.toolsPage).toBe(true);
  });
});

describe("mergePluginConfigs", () => {
  it("keeps --out and --every when tests add collector.adb (a plain spread would drop them)", () => {
    const merged = mergePluginConfigs(perfConfigOf(ARGS, "/game", undefined), {
      collector: { adb: "/no/adb" },
      pages: { pageDir: "/tools" }
    });
    expect(merged.collector).toEqual({ out: "logs", everyS: 5, adb: "/no/adb" });
    expect(merged.pages).toEqual({ toolsPage: false, pageDir: "/tools" });
    expect(merged.hub).toEqual({ devicePort: 47_601, deviceLan: true });
  });

  it("lets a field of the extra config win", () => {
    const merged = mergePluginConfigs(perfConfigOf(ARGS, "/game", undefined), {
      collector: { everyS: 1 }
    });
    expect(merged.collector).toEqual({ out: "logs", everyS: 1 });
  });

  it("answers the run's configs without an extra config", () => {
    const base = perfConfigOf(ARGS, "/game", undefined);
    expect(mergePluginConfigs(base, undefined)).toEqual(base);
  });
});
