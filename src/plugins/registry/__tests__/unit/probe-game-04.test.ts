/* eslint-disable unicorn/no-null -- null is the wire value for "no input" */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCatalogue } from "../../catalogue";
import { currentManifest } from "../../manifest";
import type { SourceDescriptor } from "../../protocol";
import type { SourceEntry } from "../../types";
import type { StartedGame, TestCtx } from "../helpers";
import { createCtx, startBareGame, thrownBy } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The probe on the door sources of @moku-labs/game 0.4 (U11). The installed
// game is 0.1, so the door catalogue is swapped for the 0.4 one in the test:
// game.rect is gone, game.locate takes { key?, target? } and throws on {}, and
// the opt-in game.sounds throws the 0.4.2 "needs audioPlugin" error when the
// audio plugin is missing.
// ─────────────────────────────────────────────────────────────────────────────

/** What game 0.4.2 throws from game.sounds without audioPlugin (flow/doors/dev.ts notInstalled). */
const SOUNDS_MESSAGE =
  "[game] The source game.sounds needs audioPlugin.\n  Add audioPlugin to createApp({ plugins }).";

/** What game 0.4 throws from game.locate without a key or a target (ui/inspect.ts). */
const LOCATE_MESSAGE =
  "[game] game.locate takes a key or a target.\n  Pass exactly one of { key } and { target }.";

vi.mock("@moku-labs/game/inspect", async importOriginal => {
  const actual = await importOriginal<typeof import("@moku-labs/game/inspect")>();
  const kept = Object.fromEntries(
    Object.entries(actual.sources).filter(([name]) => name !== "rect")
  );
  const locate = actual.defineSource({
    id: "game.locate",
    title: "Locate",
    input: { key: "string?", target: "json?" },
    changes: "frame",
    read: (_app, input) => {
      if (input.key !== undefined) return { x: 0, y: 0, w: 412, h: 915 };
      throw new Error(
        "[game] game.locate takes a key or a target.\n  Pass exactly one of { key } and { target }."
      );
    }
  });
  const sounds = actual.defineSource({
    id: "game.sounds",
    title: "Sounds",
    input: {},
    changes: "frame",
    read: () => {
      throw new Error(
        "[game] The source game.sounds needs audioPlugin.\n  Add audioPlugin to createApp({ plugins })."
      );
    }
  });
  return { ...actual, sources: Object.freeze({ ...kept, locate, sounds }) };
});

let game: StartedGame;
let ctx: TestCtx;

beforeEach(async () => {
  vi.stubGlobal("__MOKU_GAME_DEV__", true);
  game = await startBareGame();
  ctx = createCtx({ game: game.app, modules: [], name: "bare-game" });
  buildCatalogue(ctx);
});

afterEach(async () => {
  await game.stop();
  vi.unstubAllGlobals();
});

/**
 * The manifest descriptor of a source.
 *
 * @param id - The source id.
 * @returns The descriptor.
 */
function described(id: string): SourceDescriptor | undefined {
  return currentManifest(ctx.state, ctx.config).sources.find(source => source.id === id);
}

/**
 * The entry of a source.
 *
 * @param id - The source id.
 * @returns The entry; throws when the catalogue lacks it.
 */
function entryOf(id: string): SourceEntry {
  const entry = ctx.state.sources.get(id);
  if (entry === undefined) throw new Error(`no entry ${id}`);
  return entry;
}

describe("the probe on a game 0.4 door catalogue", () => {
  it("lists game.sounds without audioPlugin as not installed, with the game's first line", () => {
    expect(described("game.sounds")).toEqual({
      id: "game.sounds",
      title: "Sounds",
      input: {},
      changes: "frame",
      available: false,
      reason: "[game] The source game.sounds needs audioPlugin."
    });
    expect(ctx.log.info).toHaveBeenCalledWith("registry:source-unavailable", {
      id: "game.sounds",
      reason: SOUNDS_MESSAGE.split("\n")[0]
    });
  });

  it("answers -32008 for game.sounds reads, naming the game's reason, with no warn", () => {
    currentManifest(ctx.state, ctx.config);

    expect(thrownBy(() => entryOf("game.sounds").read(null))).toMatchObject({
      code: -32_008,
      message:
        "[moku-editor] source game.sounds is not available in this game: [game] The source game.sounds needs audioPlugin.",
      data: { reason: "not_installed", retryable: false, id: "game.sounds" }
    });
    expect(ctx.log.warn).not.toHaveBeenCalled();
  });

  it("never probes game.locate: it is listed without an available key and answers { key }", () => {
    expect(described("game.locate")).toEqual({
      id: "game.locate",
      title: "Locate",
      input: { key: "string?", target: "json?" },
      changes: "frame"
    });
    expect(ctx.log.info).not.toHaveBeenCalledWith(
      "registry:source-unavailable",
      expect.objectContaining({ id: "game.locate" })
    );
    expect(entryOf("game.locate").read({ key: "homeBackground" })).toEqual({
      x: 0,
      y: 0,
      w: 412,
      h: 915
    });
  });

  it("lets a game.locate read without a key fail per read, as before (-32000)", () => {
    currentManifest(ctx.state, ctx.config);

    expect(thrownBy(() => entryOf("game.locate").read(null))).toMatchObject({
      code: -32_000,
      message: expect.stringContaining(LOCATE_MESSAGE.split("\n")[0] ?? "")
    });
  });

  it("lists no game.rect: the 0.4 catalogue does not have it", () => {
    expect(described("game.rect")).toBeUndefined();
  });
});
