// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildScene, type SceneSnapshot } from "../../../panels/shared/scene";
import {
  highlightElement,
  hoverAt,
  inspectElement,
  openInFiles,
  pickAt,
  revealElement,
  selectElement,
  selectedElement,
  setPicker
} from "../../element/select";
import { createCtx, flush, sceneCapture, type TestCtx, useScene } from "../helpers";

const BOARD = sceneCapture("scene-board.txt");
const ITEM = { kind: "entity", id: 1_048_628 } as const;
const COIN = { kind: "ui", path: "boardScreen/hudRow/coinPill" } as const;

/**
 * The board scene, calibrated (identity).
 *
 * @returns The snapshot.
 */
function boardScene(): SceneSnapshot {
  const scene = buildScene({ ...BOARD, frame: 1841, calibration: { scale: 1, x: 0, y: 0 } });
  if ("error" in scene) throw new Error("fixture");
  return scene;
}

let ctx: TestCtx;

beforeEach(() => {
  ctx = createCtx();
  useScene(ctx);
});

afterEach(() => {
  for (const dispose of ctx.state.disposers.splice(0).toReversed()) dispose();
  document.body.innerHTML = "";
});

describe("setPicker", () => {
  it("on shows Game and the Element tab; no argument toggles; off clears the hover", () => {
    ctx.state.tab = "device";
    setPicker(ctx, true);
    expect(ctx.workspace.show).toHaveBeenCalledWith("game");
    expect(ctx.state.tab).toBe("element");
    expect(ctx.state.picker.on).toBe(true);

    ctx.state.picker.hover = "entity:1048628";
    setPicker(ctx);
    expect(ctx.state.picker).toEqual({ on: false, hover: undefined });
    setPicker(ctx);
    expect(ctx.state.picker.on).toBe(true);
  });

  it("creates gameView's overlay root inside gameFrame().overlay() when it turns on", () => {
    setPicker(ctx, true);
    expect(ctx.state.overlayRoot?.parentElement).toBe(ctx.workspace.overlayElement);
    expect(ctx.state.overlayRoot?.dataset.game).toBe("overlay");
  });
});

describe("select, selected and inspect", () => {
  it("select sets the element and clears the style card and the lookup", () => {
    ctx.state.lookup = { key: "coinPill", status: "missing" };
    selectElement(ctx, COIN);
    expect(selectedElement(ctx)).toEqual(COIN);
    expect(ctx.state.lookup).toBeUndefined();
    expect(ctx.state.styles).toBeUndefined();
    selectElement(ctx, undefined);
    expect(selectedElement(ctx)).toBeUndefined();
  });

  it("inspect selects, opens the Element tab and shows Game", () => {
    ctx.state.tab = "device";
    inspectElement(ctx, ITEM);
    expect(ctx.state.selected).toEqual(ITEM);
    expect(ctx.state.tab).toBe("element");
    expect(ctx.workspace.show).toHaveBeenCalledWith("game");
  });
});

describe("highlightElement", () => {
  it("draws from the built scene at once; undefined clears it", () => {
    ctx.state.scene = boardScene();
    highlightElement(ctx, COIN);
    expect(ctx.state.treeHover).toEqual(COIN);
    expect(ctx.state.overlayRoot?.dataset.game).toBe("overlay");
    highlightElement(ctx, undefined);
    expect(ctx.state.treeHover).toBeUndefined();
  });

  it("reads the scene when none is built and drops a request a newer one replaced", async () => {
    highlightElement(ctx, COIN);
    highlightElement(ctx, ITEM);
    await flush();
    expect(ctx.state.treeHover).toEqual(ITEM);

    ctx.state.scene = undefined;
    highlightElement(ctx, COIN);
    highlightElement(ctx, undefined);
    await flush();
    expect(ctx.state.treeHover).toBeUndefined();
  });

  it("logs when the scene cannot be read", async () => {
    ctx.link.values.delete("game.ui");
    highlightElement(ctx, COIN);
    await flush();
    expect(ctx.state.treeHover).toBeUndefined();
    expect(ctx.log.warn).toHaveBeenCalledWith("gameView: highlight failed", expect.anything());
  });
});

describe("hoverAt and pickAt", () => {
  beforeEach(() => {
    ctx.state.scene = boardScene();
    ctx.workspace.box = {
      left: 100,
      top: 50,
      width: 196.5,
      height: 426,
      scale: 0.5,
      docked: "stage"
    };
    ctx.state.picker.on = true;
  });

  it("maps client px through the frame box to the element under the pointer", () => {
    hoverAt(ctx, { x: 100 + 540 * 0.5, y: 50 + 990 * 0.5 });
    expect(ctx.state.picker.hover).toBe("entity:1048628");
    hoverAt(ctx, { x: 100 + 980 * 0.5, y: 50 + 110 * 0.5 });
    expect(ctx.state.picker.hover).toBe("ui:boardScreen/hudRow/settings/settingsIcon");
  });

  it("finds nothing without a calibrated scene or a frame box", () => {
    ctx.workspace.box = undefined;
    hoverAt(ctx, { x: 370, y: 545 });
    expect(ctx.state.picker.hover).toBeUndefined();

    ctx.workspace.box = { left: 0, top: 0, width: 1, height: 1, scale: 1, docked: "stage" };
    const uncalibrated = buildScene({ ...BOARD, frame: 1, calibration: undefined });
    if ("error" in uncalibrated) throw new Error("fixture");
    ctx.state.scene = uncalibrated;
    hoverAt(ctx, { x: 540, y: 990 });
    expect(ctx.state.picker.hover).toBeUndefined();
  });

  it("click selects the element, turns the picker off and opens the Element tab", () => {
    ctx.state.tab = "device";
    pickAt(ctx, { x: 370, y: 545 });
    expect(ctx.state.selected).toEqual(ITEM);
    expect(ctx.state.picker).toEqual({ on: false, hover: undefined });
    expect(ctx.state.tab).toBe("element");
  });

  it("a click on nothing keeps the picker on", () => {
    pickAt(ctx, { x: -500, y: -500 });
    expect(ctx.state.picker.on).toBe(true);
    expect(ctx.state.selected).toBeUndefined();
  });
});

describe("cross-view intents", () => {
  it("revealElement emits workspace:reveal; openInFiles emits workspace:open-file", () => {
    revealElement(ctx, COIN);
    openInFiles(ctx, "src/hud/styles.ts", 3);
    expect(ctx.emit).toHaveBeenNthCalledWith(1, "workspace:reveal", { ref: COIN });
    expect(ctx.emit).toHaveBeenNthCalledWith(2, "workspace:open-file", {
      path: "src/hud/styles.ts",
      line: 3
    });
  });
});

describe("without a DOM", () => {
  it("setPicker still works when document is missing", () => {
    vi.stubGlobal("document", undefined);
    setPicker(ctx, true);
    vi.unstubAllGlobals();
    expect(ctx.state.picker.on).toBe(true);
    expect(ctx.state.overlayRoot).toBeUndefined();
  });
});
