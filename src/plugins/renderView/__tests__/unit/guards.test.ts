/* eslint-disable unicorn/no-null -- null is a JSON value on the wire */
import { describe, expect, it } from "vitest";
import { asAssetsUsage, asEffectsStats, asRenderStats } from "../../guards";

// ─────────────────────────────────────────────────────────────────────────────
// guards.ts: game.render, game.assets and game.effects narrowed from Json; the
// game's own examples pass, anything else is undefined.
// ─────────────────────────────────────────────────────────────────────────────

describe("asRenderStats", () => {
  it("accepts the game's example, with and without drawCalls", () => {
    const example = {
      fps: 60,
      frameMs: 3.4,
      textures: 12,
      textureMb: 41.25,
      views: 180,
      pooled: 24
    };

    expect(asRenderStats(example)).toEqual(example);
    expect(asRenderStats({ ...example, drawCalls: 7 })).toEqual({ ...example, drawCalls: 7 });
  });

  it("accepts the game 0.0.3 example with renderPasses and drawCalls", () => {
    const example = {
      fps: 60,
      frameMs: 3.4,
      textures: 12,
      textureMb: 41.25,
      views: 180,
      pooled: 24,
      renderPasses: 1,
      drawCalls: 14
    };

    expect(asRenderStats(example)).toEqual(example);
    expect(asRenderStats({ ...example, renderPasses: "1" })).not.toHaveProperty("renderPasses");
  });

  it("drops a drawCalls that is not a number and extra fields", () => {
    const value = {
      fps: 0,
      frameMs: 0,
      textures: 0,
      textureMb: 0,
      views: 0,
      pooled: 0,
      drawCalls: null,
      extra: 1
    };

    expect(asRenderStats(value)).toEqual({
      fps: 0,
      frameMs: 0,
      textures: 0,
      textureMb: 0,
      views: 0,
      pooled: 0
    });
  });

  it("rejects other shapes", () => {
    expect(asRenderStats(null)).toBeUndefined();
    expect(asRenderStats([1])).toBeUndefined();
    expect(
      asRenderStats({
        fps: "60",
        frameMs: 3.4,
        textures: 12,
        textureMb: 41.25,
        views: 180,
        pooled: 24
      })
    ).toBeUndefined();
    expect(asRenderStats({ fps: 60 })).toBeUndefined();
  });
});

describe("asAssetsUsage", () => {
  it("accepts the game's example", () => {
    const example = {
      textureMb: 3.5,
      budgetMb: 192,
      bundles: [{ name: "board", tier: "scene", mb: 3.5, lastUsed: 12 }]
    };

    expect(asAssetsUsage(example)).toEqual(example);
    expect(asAssetsUsage({ textureMb: 0, budgetMb: 192, bundles: [] })).toEqual({
      textureMb: 0,
      budgetMb: 192,
      bundles: []
    });
  });

  it("rejects other shapes", () => {
    expect(asAssetsUsage("assets")).toBeUndefined();
    expect(asAssetsUsage({ textureMb: 3.5, budgetMb: 192 })).toBeUndefined();
    expect(
      asAssetsUsage({ textureMb: 3.5, budgetMb: 192, bundles: [{ name: "board" }] })
    ).toBeUndefined();
    expect(asAssetsUsage({ textureMb: 3.5, budgetMb: 192, bundles: [7] })).toBeUndefined();
    expect(asAssetsUsage({ textureMb: 3.5, budgetMb: "192", bundles: [] })).toBeUndefined();
  });
});

describe("asEffectsStats", () => {
  it("accepts the game's example", () => {
    const example = { particles: 18, emitters: 1, filters: 24, renderPasses: 49 };

    expect(asEffectsStats(example)).toEqual(example);
    expect(asEffectsStats({ ...example, extra: 1 })).toEqual(example);
    expect(asEffectsStats({ particles: 0, emitters: 0, filters: 0, renderPasses: 0 })).toEqual({
      particles: 0,
      emitters: 0,
      filters: 0,
      renderPasses: 0
    });
  });

  it("rejects a missing field, a negative, NaN, a string and other shapes", () => {
    expect(asEffectsStats({ particles: 18, emitters: 1, filters: 24 })).toBeUndefined();
    expect(
      asEffectsStats({ particles: -1, emitters: 1, filters: 24, renderPasses: 49 })
    ).toBeUndefined();
    expect(
      asEffectsStats({ particles: 18, emitters: Number.NaN, filters: 24, renderPasses: 49 })
    ).toBeUndefined();
    expect(
      asEffectsStats({ particles: 18, emitters: 1, filters: "24", renderPasses: 49 })
    ).toBeUndefined();
    expect(asEffectsStats(null)).toBeUndefined();
    expect(asEffectsStats([18, 1, 24, 49])).toBeUndefined();
  });
});
