// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { actionsOf } from "../../actions";
import { createHandlers } from "../../handlers";
import type { FlowCtx, Item } from "../../types";
import { createTestCtx, jumpCamera, prepare } from "../ctx";

// ─────────────────────────────────────────────────────────────────────────────
// intents.ts and the first canvas measure: a workspace:select-node that shows
// Flow for the first time selects before the canvas has a size. The first
// measure frames that selection, not the current node (the default camera).
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jumpCamera();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The canvas size of the first measure. */
const VIEW = { w: 1200, h: 800 };

/**
 * A ctx with the graph laid out, Flow never shown and the canvas never measured.
 *
 * @returns The ctx and its hooks.
 */
async function unmeasured(): Promise<{
  readonly ctx: FlowCtx;
  readonly hooks: ReturnType<typeof createHandlers>;
}> {
  const { ctx } = createTestCtx();
  await prepare(ctx);
  ctx.state.camera.viewport = { w: 0, h: 0 };
  ctx.state.camera.initialised = false;
  return { ctx, hooks: createHandlers(ctx) };
}

/**
 * The selected item on screen.
 *
 * @param ctx - The ctx.
 * @returns The item; throws without one.
 */
function selectedItem(ctx: FlowCtx): Item {
  const key = ctx.state.focus.selected;
  const item = key === undefined ? undefined : ctx.state.layout.result?.byKey[key];
  if (item === undefined) throw new Error("no selected item");
  return item;
}

/**
 * The screen centre of an item under the current camera.
 *
 * @param ctx - The ctx.
 * @param item - The item.
 * @returns Its centre in canvas px.
 */
function screenCentre(ctx: FlowCtx, item: Item): { x: number; y: number } {
  const cam = actionsOf(ctx).camera.get();
  return { x: (item.x + item.w / 2) * cam.z + cam.x, y: (item.y + item.h / 2) * cam.z + cam.y };
}

describe("a select-node that shows Flow for the first time", () => {
  it("frames the selection at the first canvas measure, not the current node", async () => {
    const { ctx, hooks } = await unmeasured();

    // workspace.show("flow") emits workspace:changed first, then the intent runs.
    hooks["workspace:changed"]({ ws: "flow" });
    hooks["workspace:select-node"]({ id: "board/merge" });
    expect(ctx.state.camera.initialised).toBe(false);

    actionsOf(ctx).camera.setView(VIEW);

    const insets = actionsOf(ctx).camera.insets();
    const centre = screenCentre(ctx, selectedItem(ctx));
    expect(ctx.state.camera.initialised).toBe(true);
    expect(centre.x).toBeCloseTo((insets.left + VIEW.w - insets.right) / 2, 6);
    expect(centre.y).toBeCloseTo(VIEW.h / 2, 6);
    expect(ctx.state.camera.frameSelection).toBe(false);
  });

  it("keeps the default camera when no selection waited for the measure", async () => {
    const { ctx, hooks } = await unmeasured();
    const reference = await unmeasured();
    reference.hooks["workspace:changed"]({ ws: "flow" });
    actionsOf(reference.ctx).camera.setView(VIEW);

    hooks["workspace:changed"]({ ws: "flow" });
    actionsOf(ctx).camera.setView(VIEW);

    expect(ctx.state.focus.selected).toBeUndefined();
    expect(actionsOf(ctx).camera.get()).toEqual(actionsOf(reference.ctx).camera.get());
  });

  it("a selection made once the canvas is measured moves the camera as before", async () => {
    const { ctx, hooks } = await unmeasured();
    hooks["workspace:changed"]({ ws: "flow" });
    actionsOf(ctx).camera.setView(VIEW);

    hooks["workspace:select-node"]({ id: "board/merge" });

    expect(ctx.state.camera.frameSelection).toBe(false);
    const insets = actionsOf(ctx).camera.insets();
    expect(screenCentre(ctx, selectedItem(ctx)).x).toBeCloseTo(
      (insets.left + VIEW.w - insets.right) / 2,
      6
    );
  });
});
