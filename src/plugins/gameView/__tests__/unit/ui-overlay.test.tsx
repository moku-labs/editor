// @vitest-environment happy-dom
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { presetOf } from "../../../workspace/devices";
import { stopGameView } from "../../lifecycle";
import { notify } from "../../state";
import { ensureOverlayRoot } from "../../ui/OverlayRoot";
import { createCtx, flush, PNG, type TestCtx } from "../helpers";
import { boardScene, find, findAll, fire } from "../ui";

let ctx: TestCtx;
let root: HTMLElement;

/** Re-renders the overlay after a state change. */
function update(change: () => void): void {
  act(() => {
    change();
    notify(ctx.state);
  });
}

beforeEach(() => {
  ctx = createCtx();
  ctx.workspace.activeValue = "game";
  ctx.state.scene = boardScene();
  ctx.workspace.box = { left: 0, top: 0, width: 393, height: 852, scale: 1, docked: "stage" };
  act(() => {
    root = ensureOverlayRoot(ctx) ?? document.createElement("div");
  });
});

afterEach(() => {
  stopGameView(ctx);
  document.body.innerHTML = "";
});

describe("ensureOverlayRoot", () => {
  it("creates one root inside gameFrame().overlay(); the disposer removes it", () => {
    expect(root.dataset.game).toBe("overlay");
    expect(root.parentElement).toBe(ctx.workspace.overlayElement);
    expect(ensureOverlayRoot(ctx)).toBe(root);
    stopGameView(ctx);
    expect(root.isConnected).toBe(false);
    expect(ctx.state.overlayRoot).toBeUndefined();
  });
});

describe("OverlayRoot", () => {
  it("draws the selected box while Game is active and the tree box anywhere", () => {
    update(() => {
      ctx.state.selected = { kind: "entity", id: 1_048_628 };
      ctx.state.treeHover = { kind: "ui", path: "boardScreen/hudRow/coinPill" };
    });
    const selected = find(root, "[data-box='selected']");
    expect(selected.style.left).toBe("428.5px");
    expect(selected.style.width).toBe("223px");
    expect(find(root, "[data-box='tree']").style.top).toBe("74px");

    update(() => {
      ctx.workspace.activeValue = "flow";
    });
    expect(root.querySelector("[data-box='selected']")).toBeNull();
    expect(root.querySelector("[data-box='tree']")).not.toBeNull();
  });

  it("draws the hover box with its label while picking; the label flips at the bottom", () => {
    update(() => {
      ctx.state.picker = { on: true, hover: "ui:boardScreen/hudRow/coinPill" };
    });
    expect(find(root, "[data-box='hover']").style.left).toBe("235px");
    const label = find(root, "[data-part='label']");
    expect(label.textContent).toBe("coinPill · row · 290×76");
    expect(label.dataset.flipped).toBeUndefined();

    update(() => {
      ctx.state.picker = { on: true, hover: "ui:boardScreen/boardSlot" };
    });
    expect(find(root, "[data-part='label']").dataset.flipped).toBe("");
  });

  it("counter-scales the label by 1 / frame scale", () => {
    update(() => {
      ctx.workspace.box = {
        left: 0,
        top: 0,
        width: 196.5,
        height: 426,
        scale: 0.5,
        docked: "stage"
      };
      ctx.state.picker = { on: true, hover: "ui:boardScreen/hudRow/coinPill" };
    });
    expect(find(root, "[data-part='label']").style.transform).toBe("scale(2)");
  });

  it("the picker layer takes pointer events only while picking in Game", async () => {
    expect(root.querySelector("[data-part='picker']")).toBeNull();
    update(() => {
      ctx.state.picker.on = true;
    });
    const layer = find(root, "[data-part='picker']");
    expect(layer.getAttribute("aria-label")).toBe("Game element picker");

    fire(layer, new PointerEvent("pointermove", { clientX: 540, clientY: 990, bubbles: true }));
    expect(ctx.state.picker.hover).toBe("entity:1048628");
    expect(find(root, "[data-box='hover']").getAttribute("style")).toBe(
      "left: 428.5px; top: 880.5px; width: 223px; height: 223px;"
    );
    fire(layer, new PointerEvent("pointerleave", { bubbles: false }));
    expect(ctx.state.picker.hover).toBeUndefined();
    fire(layer, new PointerEvent("pointerup", { clientX: 540, clientY: 990, bubbles: true }));
    // The click reads the scene once more first; without a game it picks from the scene it has.
    await act(flush);
    expect(ctx.state.selected).toEqual({ kind: "entity", id: 1_048_628 });
    expect(root.querySelector("[data-part='picker']")).toBeNull();
  });

  it("draws the safe bands, the island and the home bar for the iPhone 15", () => {
    update(() => {});
    expect(findAll(root, "[data-part='band']").map(band => band.dataset.side)).toEqual([
      "top",
      "bottom"
    ]);
    expect(find(root, "[data-part='band'][data-side='top']").style.getPropertyValue("--band")).toBe(
      "59px"
    );
    expect(root.querySelector("[data-part='island']")).not.toBeNull();
    expect(root.querySelector("[data-part='home']")).not.toBeNull();
  });

  it("draws neither island nor home bar on a home-button phone, even with an island's insets", () => {
    const homeButton = {
      ...presetOf("iphone-15"),
      frame: "home-button" as const
    };
    update(() => {
      Object.assign(ctx.workspace.api, {
        device: () => ({ preset: homeButton, orientation: "portrait", folded: true })
      });
    });
    expect(root.querySelector("[data-part='guides']")).not.toBeNull();
    expect(root.querySelector("[data-part='island']")).toBeNull();
    expect(root.querySelector("[data-part='home']")).toBeNull();
  });

  it("draws no guides for the desktop, with the guides off, or outside Game", () => {
    update(() => {
      ctx.workspace.device = { preset: "desktop", orientation: "portrait" };
    });
    expect(root.querySelector("[data-part='guides']")).toBeNull();
    update(() => {
      ctx.workspace.device = { preset: "iphone-se", orientation: "portrait" };
    });
    expect(root.querySelector("[data-part='island']")).toBeNull();
    update(() => {
      ctx.state.safeArea = false;
    });
    expect(root.querySelector("[data-part='guides']")).toBeNull();
  });

  it("flashes once per new capture while Game is shown", () => {
    update(() => {
      ctx.state.card = { path: "a.png", frame: 1, device: "iPhone 15 portrait", image: PNG };
    });
    expect(root.querySelector("[data-part='flash']")).not.toBeNull();
  });
});
