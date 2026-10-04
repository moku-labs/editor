/* eslint-disable unicorn/no-null -- null is the wire value for "no input" */
import { defineSource } from "@moku-labs/game/inspect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCatalogue } from "../../catalogue";
import { currentManifest, refreshManifest } from "../../manifest";
import type { Json, SourceDescriptor } from "../../protocol";
import { isRetryable, ProtocolError } from "../../protocol";
import type { GameLike, SourceEntry } from "../../types";
import type { StartedGame, TestCtx } from "../helpers";
import { createCtx, startBareGame, thrownBy, withEffects } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The probe of the door sources: a source whose game plugin is missing answers
// "not installed" (-32008) instead of failing on every read.
// ─────────────────────────────────────────────────────────────────────────────

let game: StartedGame;
let ctx: TestCtx;

beforeEach(async () => {
  vi.stubGlobal("__MOKU_GAME_DEV__", true);
  game = await startBareGame();
});

afterEach(async () => {
  await game.stop();
  vi.unstubAllGlobals();
});

/**
 * Builds the catalogue over a game and returns the ctx.
 *
 * @param app - The game app.
 * @param modules - Dev modules.
 * @returns The ctx with its catalogue built.
 */
function catalogueOf(app: GameLike, modules: TestCtx["config"]["modules"] = []): TestCtx {
  const built = createCtx({ game: app, modules, name: "bare-game" });
  buildCatalogue(built);
  return built;
}

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

/**
 * How many `registry:source-unavailable` infos named a source.
 *
 * @param id - The source id.
 * @returns The count.
 */
function unavailableInfos(id: string): number {
  return ctx.log.info.mock.calls.filter(
    ([event, data]) =>
      event === "registry:source-unavailable" &&
      typeof data === "object" &&
      data !== null &&
      "id" in data &&
      data.id === id
  ).length;
}

describe("the probe when the manifest is built", () => {
  it("marks a door source that throws on its default input unavailable, with the reason", () => {
    ctx = catalogueOf(game.app);

    expect(described("game.effects")).toEqual({
      id: "game.effects",
      title: "Effects",
      input: {},
      changes: "frame",
      available: false,
      reason: expect.stringContaining("effects")
    });
    expect(described("game.ui")).toMatchObject({ available: false });
    expect(described("game.entities")).toMatchObject({ available: false });
    expect(described("game.projections")).toMatchObject({ available: false });
  });

  it("leaves a source that answers as it was: no available key", () => {
    ctx = catalogueOf(game.app);

    expect(described("game.position")).toEqual({
      id: "game.position",
      title: "Position",
      input: {},
      changes: "edge"
    });
  });

  it("does not probe a source with a required input (game.at)", () => {
    ctx = catalogueOf(game.app);

    expect(described("game.at")).not.toHaveProperty("available");
    expect(thrownBy(() => entryOf("game.at").read({ x: 0, y: 0 }))).toMatchObject({
      code: -32_000
    });
  });

  it("does not probe a module source", () => {
    const broken = defineSource({
      id: "bare.broken",
      title: "Broken",
      input: {},
      changes: "commit",
      read: () => {
        throw new Error("module broke");
      }
    });
    ctx = catalogueOf(game.app, [{ sources: [broken] }]);

    expect(described("bare.broken")).not.toHaveProperty("available");
    expect(thrownBy(() => entryOf("bare.broken").read(null))).toMatchObject({ code: -32_000 });
  });

  it("logs one registry:source-unavailable info per source at probe time, never a warn", () => {
    ctx = catalogueOf(game.app);
    currentManifest(ctx.state, ctx.config);

    expect(ctx.log.info).toHaveBeenCalledWith("registry:source-unavailable", {
      id: "game.effects",
      reason: expect.stringContaining("effects")
    });
    expect(unavailableInfos("game.effects")).toBe(1);

    thrownBy(() => entryOf("game.effects").read(null));
    thrownBy(() => entryOf("game.effects").watch(null, () => undefined));
    expect(unavailableInfos("game.effects")).toBe(1);
    expect(ctx.log.warn).not.toHaveBeenCalled();
  });
});

describe("reads and watches of an unavailable source", () => {
  it("read answers -32008 not_installed, not retryable, and logs no warn", () => {
    ctx = catalogueOf(game.app);
    const reason = described("game.effects")?.reason;
    const error = thrownBy(() => entryOf("game.effects").read(null));

    expect(error).toBeInstanceOf(ProtocolError);
    expect(error).toMatchObject({
      code: -32_008,
      message: `[moku-editor] source game.effects is not available in this game: ${String(reason)}`,
      data: { reason: "not_installed", retryable: false, id: "game.effects" }
    });
    expect(isRetryable(error)).toBe(false);
    expect(ctx.log.warn).not.toHaveBeenCalled();
  });

  it("watch answers -32008 at once and opens no door watch", () => {
    ctx = catalogueOf(game.app);
    currentManifest(ctx.state, ctx.config);
    const values: Json[] = [];

    expect(
      thrownBy(() => entryOf("game.effects").watch(null, value => values.push(value)))
    ).toMatchObject({
      code: -32_008
    });
    game.app.time.step(16);
    expect(values).toEqual([]);
    expect(ctx.log.warn).not.toHaveBeenCalled();
  });

  it("an unprobed source keeps the old path (no manifest built yet)", () => {
    ctx = catalogueOf(game.app);

    expect(thrownBy(() => entryOf("game.effects").read(null))).toMatchObject({ code: -32_000 });
    expect(ctx.log.warn).toHaveBeenCalledWith("registry:source-failed", {
      id: "game.effects",
      message: expect.stringContaining("effects")
    });
  });
});

describe("probing again", () => {
  it("probes on each manifest rebuild: a source that answers now is available again", () => {
    const effects = withEffects(game.app);
    ctx = catalogueOf(effects.app);
    expect(described("game.effects")).toMatchObject({ available: false });

    effects.install(true);
    ctx.state.manifest = undefined;

    expect(described("game.effects")).not.toHaveProperty("available");
    expect(entryOf("game.effects").read(null)).toEqual({
      particles: 0,
      emitters: 0,
      filters: 0,
      renderPasses: 0
    });
  });

  it("logs the info once while the source stays unavailable over rebuilds", () => {
    ctx = catalogueOf(game.app);
    currentManifest(ctx.state, ctx.config);
    ctx.state.manifest = undefined;
    currentManifest(ctx.state, ctx.config);

    expect(unavailableInfos("game.effects")).toBe(1);
  });

  it("refreshManifest (onStart) drops the cache and probes now", () => {
    const effects = withEffects(game.app);
    ctx = catalogueOf(effects.app);
    const before = currentManifest(ctx.state, ctx.config);
    expect(before.sources.find(source => source.id === "game.effects")).toMatchObject({
      available: false
    });

    effects.install(true);
    refreshManifest(ctx);

    expect(ctx.state.manifest).not.toBe(before);
    expect(described("game.effects")).not.toHaveProperty("available");
  });
});
