import { describe, expect, it } from "vitest";
import type { Json, LinkStatus } from "../../protocol";
import { isHotSwapEntry, isReloading } from "../../protocol";

// ─────────────────────────────────────────────────────────────────────────────
// The two reload signals (U9 B5, U10 B1): the neutral `lost` of an expected
// reload, and the game.log entry game 0.5.0 writes after a dev hot swap
// (`ctx.log.info("ui:hot-swap", summary)` in the ui plugin).
// ─────────────────────────────────────────────────────────────────────────────

/** One game.log entry of game 0.5.0 after a save of a styles module. */
const HOT_SWAP: Json = {
  level: "info",
  event: "ui:hot-swap",
  data: {
    file: "/work/merge-game/features/home/styles.ts",
    components: [],
    projections: [],
    animations: [],
    emitters: [],
    strings: [],
    textStyles: ["title"]
  },
  ts: 1_759_680_000_000
};

/** The entry game 0.5.0 writes before it throws a refused swap: Bun then reloads the page. */
const HOT_REFUSED: Json = {
  level: "info",
  event: "ui:hot-refused",
  data: { file: "/work/merge-game/features/home/view.tsx", reason: "a new projection" },
  ts: 1_759_680_000_000
};

describe("isReloading", () => {
  it("is true for a lost status of an expected reload", () => {
    const status: LinkStatus = {
      kind: "lost",
      reason: "game_reloaded",
      lastFrame: 1825,
      retryInMs: 1000,
      reloading: true
    };

    expect(isReloading(status)).toBe(true);
  });

  it("is false for a real loss", () => {
    const status: LinkStatus = {
      kind: "lost",
      reason: "socket_closed",
      lastFrame: 1825,
      retryInMs: 1000
    };

    expect(isReloading(status)).toBe(false);
  });

  it.each<LinkStatus>([
    { kind: "connecting" },
    { kind: "live", frame: 1840 },
    { kind: "paused", frame: 1840 },
    { kind: "silent", since: 1_759_680_000_000, lastFrame: 1840 },
    { kind: "empty" }
  ])("is false for $kind", status => {
    expect(isReloading(status)).toBe(false);
  });
});

describe("isHotSwapEntry", () => {
  it("is true for the hot swap entry of game 0.5.0", () => {
    expect(isHotSwapEntry(HOT_SWAP)).toBe(true);
  });

  it("is true for a swap that changed nothing by name (a styles module Bun already patched)", () => {
    const entry: Json = { level: "info", event: "ui:hot-swap", data: { file: "/g/a.tsx" }, ts: 1 };

    expect(isHotSwapEntry(entry)).toBe(true);
  });

  it("is false for a refused swap: the page reloads instead", () => {
    expect(isHotSwapEntry(HOT_REFUSED)).toBe(false);
  });

  it("is false for another log event", () => {
    const entry: Json = { level: "warn", event: "assets: missing texture", data: {}, ts: 1 };

    expect(isHotSwapEntry(entry)).toBe(false);
  });

  it("is false for the whole game.log value: the caller tests the entries", () => {
    expect(isHotSwapEntry([HOT_SWAP])).toBe(false);
  });

  it.each<[string, Json]>([
    ["no ts", { level: "info", event: "ui:hot-swap", data: { file: "/g/a.tsx" } }],
    ["no data", { level: "info", event: "ui:hot-swap", ts: 1 }],
    ["data that is no object", { level: "info", event: "ui:hot-swap", data: "/g/a.tsx", ts: 1 }],
    [
      "data.file that is no text",
      { level: "info", event: "ui:hot-swap", data: { file: 1 }, ts: 1 }
    ],
    // eslint-disable-next-line unicorn/no-null -- null is a wire value the guard must refuse
    ["null", null],
    ["text", "ui:hot-swap"],
    ["a number", 0]
  ])("is false for %s", (_label, value) => {
    expect(isHotSwapEntry(value)).toBe(false);
  });
});
