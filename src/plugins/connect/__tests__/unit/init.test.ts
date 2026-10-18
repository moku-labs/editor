import { describe, expect, it } from "vitest";
import { initConnect } from "../../init";
import type { ConnectConfig } from "../../types";
import { createCtx } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// spec 11 Config, C1, C9: onInit validates the config with two-line TypeErrors
// and registers the editor methods on the hub.
// Bug: a typo in pluginConfigs (heapEveryMs: 10) polling the phone 100 times a
// second, or a method the tools page calls answered "unknown method".
// ─────────────────────────────────────────────────────────────────────────────

describe("initConnect", () => {
  it("refuses each field out of its rule with the two-line message", () => {
    const refused: [Partial<ConnectConfig>, string][] = [
      [
        { heapEveryMs: 10 },
        "connect.heapEveryMs is 10.\n  Give a whole number from 100 to 5000, for example 250."
      ],
      [
        { adbTimeoutMs: 499 },
        "connect.adbTimeoutMs is 499.\n  Give a whole number from 500 to 60000, for example 5000."
      ],
      [
        { scanEveryMs: 1.5 },
        "connect.scanEveryMs is 1.5.\n  Give a whole number from 500 to 60000, for example 2000."
      ],
      [
        { answerTimeoutMs: 300_001 },
        "connect.answerTimeoutMs is 300001.\n  Give a whole number from 1000 to 300000, for example 20000."
      ],
      [
        { leaseMs: 1999 },
        "connect.leaseMs is 1999.\n  Give a whole number from 2000 to 120000, for example 10000."
      ],
      [
        { telemetryEveryMs: 249 },
        "connect.telemetryEveryMs is 249.\n  Give a whole number from 250 to 10000, for example 1000."
      ],
      [
        { meminfoEveryMs: 60_001 },
        "connect.meminfoEveryMs is 60001.\n  Give a whole number from 1000 to 60000, for example 5000."
      ],
      [
        { gcDropMb: 0.01 },
        "connect.gcDropMb is 0.01.\n  Give a number from 0.05 to 64, for example 0.5."
      ],
      [
        { gcDropMb: Number.NaN },
        "connect.gcDropMb is NaN.\n  Give a number from 0.05 to 64, for example 0.5."
      ],
      [
        { adb: "" },
        'connect.adb is "".\n  Give the adb command, a name on PATH or a path, for example "adb".'
      ],
      [
        { wire: "always" as ConnectConfig["wire"] },
        'connect.wire is "always".\n  Give "manual" or "auto".'
      ],
      [{ gcTrace: "yes" as unknown as boolean }, 'connect.gcTrace is "yes".\n  Give true or false.']
    ];
    for (const [config, message] of refused) {
      const ctx = createCtx({ config });
      expect(() => initConnect(ctx), message).toThrow(TypeError);
      expect(() => initConnect(ctx), message).toThrow(`[moku-editor] ${message}`);
      expect(ctx.hub.addEditorMethods).not.toHaveBeenCalled();
    }
  });

  it("registers the eight editor methods of the tools page", () => {
    const ctx = createCtx();
    initConnect(ctx);
    expect([...ctx.hub.methods.keys()].toSorted()).toEqual([
      "connect.confirm",
      "connect.network",
      "connect.off",
      "connect.refuse",
      "connect.scan",
      "connect.unwatch",
      "connect.watch",
      "connect.wire"
    ]);
  });
});
