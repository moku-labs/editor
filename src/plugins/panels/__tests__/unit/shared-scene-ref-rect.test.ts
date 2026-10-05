import { readFileSync } from "node:fs";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { Json } from "../../../registry/protocol";
import type { PageRect, SceneInput, SceneNode, SceneSnapshot } from "../../shared/scene";
import { buildScene } from "../../shared/scene";

// ─────────────────────────────────────────────────────────────────────────────
// SceneNode.refRect (round 2 R2): the rect in reference units, taken in
// addUiNode before the calibration maps it to page px. The reference block of
// gameView prints it as `ref x,y w×h`, so an edit made from the block can use
// the game's own units.
// ─────────────────────────────────────────────────────────────────────────────

/** One capture of the three scene sources (merge-game, the board at board/awaitIntent). */
type Capture = { readonly ui: Json; readonly entities: Json; readonly projections: Json };

const BOARD: Capture = JSON.parse(
  readFileSync(new URL("../fixtures/scene-board.txt", import.meta.url), "utf8")
);

/**
 * The board scene with a calibration.
 *
 * @param calibration - Reference units to page px, undefined for none.
 * @returns The scene.
 */
function sceneOf(calibration: SceneInput["calibration"]): SceneSnapshot {
  const built = buildScene({ ...BOARD, frame: 1841, calibration });
  if ("error" in built) throw new Error(`scene error: ${built.source} ${built.path}`);
  return built;
}

/**
 * One node of a scene.
 *
 * @param scene - The scene.
 * @param id - The node id.
 * @returns The node.
 */
function nodeOf(scene: SceneSnapshot, id: string): SceneNode {
  const node = scene.nodes.get(id);
  if (node === undefined) throw new Error(`no node ${id}`);
  return node;
}

describe("SceneNode.refRect", () => {
  it("is the rect in reference units, the calibration not applied", () => {
    const calibrated = sceneOf({ scale: 0.5, x: 10, y: 20 });
    const coin = nodeOf(calibrated, "ui:boardScreen/hudRow/coinPill");

    expect(coin.refRect).toEqual({ x: 235, y: 74, w: 290, h: 76 });
    expect(coin.rect).toEqual({ x: 127.5, y: 57, w: 145, h: 38 });
  });

  it("equals the rect when no calibration is given", () => {
    const scene = sceneOf(undefined);
    const slot = nodeOf(scene, "ui:boardScreen/boardSlot");

    expect(slot.refRect).toEqual(slot.rect);
    expect(slot.refRect).toEqual({ x: 55, y: 801, w: 970, h: 970 });
  });

  it("is the root-units rect of a placed entity, undefined for an unplaced one", () => {
    const calibrated = sceneOf({ scale: 2, x: 0, y: 0 });
    const item = nodeOf(calibrated, "entity:1048628");
    const unplaced = nodeOf(calibrated, "entity:1048640");

    expect(item.refRect).toEqual({ x: 428.5, y: 880.5, w: 223, h: 223 });
    expect(item.rect).toEqual({ x: 857, y: 1761, w: 446, h: 446 });
    expect(unplaced.refRect).toBeUndefined();
  });

  it("is typed as a page rect or undefined", () => {
    expectTypeOf<SceneNode["refRect"]>().toEqualTypeOf<PageRect | undefined>();
  });
});
