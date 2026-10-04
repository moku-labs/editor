import { describe, expect, it } from "vitest";
import type { Manifest } from "../../../registry/protocol";
import { RECT_SOURCE_IDS, rectSourceOf } from "../../shared/scene";

// ─────────────────────────────────────────────────────────────────────────────
// Where a view reads element rects (U11): game 0.4 replaced game.rect with
// game.locate. The id comes from the manifest: game.locate when listed, else
// game.rect; neither listed means the game reports no element rects.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A manifest listing the given source ids.
 *
 * @param ids - Source ids.
 * @returns The manifest.
 */
function listing(...ids: readonly string[]): Manifest {
  return {
    game: "tiny-game 0.0.0",
    page: "http://127.0.0.1:3000/",
    embedded: true,
    sources: ids.map(id => ({ id, title: id, input: {}, changes: "frame" as const })),
    commands: []
  };
}

describe("rectSourceOf", () => {
  it("picks game.locate on a game 0.4 manifest", () => {
    expect(rectSourceOf(listing("game.ui", "game.locate"))).toBe("game.locate");
  });

  it("picks game.rect on a game 0.1 manifest", () => {
    expect(rectSourceOf(listing("game.ui", "game.rect"))).toBe("game.rect");
  });

  it("prefers game.locate when both are listed", () => {
    expect(rectSourceOf(listing("game.rect", "game.locate"))).toBe("game.locate");
  });

  it("is undefined when neither is listed or there is no manifest", () => {
    expect(rectSourceOf(listing("game.ui", "game.position"))).toBeUndefined();
    expect(rectSourceOf(undefined)).toBeUndefined();
  });

  it("lists the ids newest first", () => {
    expect(RECT_SOURCE_IDS).toEqual(["game.locate", "game.rect"]);
  });
});
