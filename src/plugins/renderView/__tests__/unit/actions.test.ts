// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hoverTexture, moveInTree, setOpen } from "../../actions";
import { treeRowsOf } from "../../derive";
import { startScene } from "../../watch";
import { createCtx, deliverBoard, type FrameQueue, stubFrames, type TestCtx } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// actions.ts: the tree keys that the component tests do not reach, and the
// texture hover without a scene.
// ─────────────────────────────────────────────────────────────────────────────

let ctx: TestCtx;
let frames: FrameQueue;

function rows() {
  return treeRowsOf(ctx.state.scene, ctx.state.tree.open);
}

beforeEach(async () => {
  ctx = createCtx();
  frames = stubFrames();
  startScene(ctx);
  await deliverBoard(ctx, frames);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("moveInTree", () => {
  it("End selects the last row; an unknown key is not handled", () => {
    expect(moveInTree(ctx, rows(), "End")).toBe(true);
    expect(ctx.state.tree.selected).toBe("entity:1048640");
    expect(moveInTree(ctx, rows(), "x")).toBe(false);
  });

  it("→ on an open row steps into its first child; on a leaf it does nothing", () => {
    ctx.state.tree.selected = "ui:boardScreen";
    moveInTree(ctx, rows(), "ArrowRight");
    expect(ctx.state.tree.selected).toBe("ui:boardScreen/boardBackground");

    moveInTree(ctx, rows(), "ArrowRight");
    expect(ctx.state.tree.selected).toBe("ui:boardScreen/boardBackground");
  });

  it("← on a closed row steps to its parent; without a selection it does nothing", () => {
    expect(moveInTree(ctx, rows(), "ArrowLeft")).toBe(true);
    expect(ctx.state.tree.selected).toBeUndefined();

    setOpen(ctx, "ui:boardScreen/boardSlot", true);
    ctx.state.tree.selected = "entity:3145728";
    moveInTree(ctx, rows(), "ArrowLeft");
    expect(ctx.state.tree.selected).toBe("ui:boardScreen/boardSlot");

    // A root has no parent: the selection stays.
    ctx.state.tree.open.clear();
    ctx.state.tree.selected = "ui:boardScreen";
    moveInTree(ctx, rows(), "ArrowLeft");
    expect(ctx.state.tree.selected).toBe("ui:boardScreen");
  });

  it("↓ on the last row stays; ↓ without a selection picks the first row", () => {
    ctx.state.tree.selected = "entity:1048640";
    moveInTree(ctx, rows(), "ArrowDown");
    expect(ctx.state.tree.selected).toBe("entity:1048640");

    ctx.state.tree.selected = undefined;
    moveInTree(ctx, rows(), "ArrowDown");
    expect(ctx.state.tree.selected).toBe("ui:boardScreen");
  });
});

describe("hoverTexture", () => {
  it("records the hovered key and draws nothing without a scene", () => {
    ctx.state.scene = undefined;
    hoverTexture(ctx, "board.cell");

    expect(ctx.state.table.hover).toBe("board.cell");
    expect(ctx.state.box).toBeUndefined();
    hoverTexture(ctx);
    expect(ctx.state.table.hover).toBeUndefined();
  });
});
