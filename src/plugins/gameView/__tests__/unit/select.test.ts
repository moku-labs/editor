// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildScene, type SceneSnapshot } from "../../../panels/shared/scene";
import type { Json } from "../../../registry/protocol";
import { hideCard, showCard } from "../../capture/shot";
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
import { escapeClosers } from "../../keys";
import { recalibrate } from "../../scene/calibrate";
import { startSceneWatches } from "../../scene/watch";
import { createCtx, flush, PNG, sceneCapture, type TestCtx, useScene } from "../helpers";

const BOARD = sceneCapture("scene-board.txt");
const SETTINGS = sceneCapture("scene-settings.txt");
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

  it("on hides the capture card, so the first Esc leaves the picker (round 2b R17)", () => {
    showCard(ctx, { path: "a.png", frame: 1, device: "iPhone 15 portrait", image: PNG });
    expect(ctx.state.card).toBeDefined();
    setPicker(ctx, true);
    expect(ctx.state.card).toBeUndefined();
    expect(ctx.state.timers.card).toBeUndefined();
    expect(escapeClosers(ctx).map(closer => closer.close())).toEqual([false, false, false, true]);
    expect(ctx.state.picker.on).toBe(false);
  });

  it("off keeps the capture card", () => {
    setPicker(ctx, true);
    showCard(ctx, { path: "a.png", frame: 1, device: "iPhone 15 portrait", image: PNG });
    setPicker(ctx, false);
    expect(ctx.state.card?.path).toBe("a.png");
    hideCard(ctx);
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
    expect(ctx.log.warn).toHaveBeenCalledWith("gameView: highlight failed", {
      message: "no value for game.ui"
    });
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

  it("click selects the element, turns the picker off and opens the Element tab", async () => {
    ctx.state.tab = "device";
    await pickAt(ctx, { x: 370, y: 545 });
    expect(ctx.state.selected).toEqual(ITEM);
    expect(ctx.state.picker).toEqual({ on: false, hover: undefined });
    expect(ctx.state.tab).toBe("element");
  });

  it("a click on nothing keeps the picker on", async () => {
    await pickAt(ctx, { x: -500, y: -500 });
    expect(ctx.state.picker.on).toBe(true);
    expect(ctx.state.selected).toBeUndefined();
  });
});

/** Starts the watches and delivers the board, calibrated at scale 1. */
async function watchBoard(): Promise<void> {
  startSceneWatches(ctx);
  ctx.link.send("game.ui", BOARD.ui);
  ctx.link.send("game.entities", BOARD.entities);
  ctx.link.send("game.projections", BOARD.projections);
  await flush();
}

describe("a pick right after a screen change", () => {
  // The bridge sends a watched game.ui at most once per heartbeat (1 s, R6): after a screen
  // change the watched scene can still be the screen before when the click comes.
  const PANE = { kind: "ui", path: "settingsScreen/settingsBoard/settingsPane" } as const;

  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    ctx.workspace.box = { left: 0, top: 0, width: 1080, height: 1440, scale: 1, docked: "stage" };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("picks from the screen the game shows now, not from the last watched snapshot", async () => {
    await watchBoard();
    expect(ctx.state.scene?.nodes.has("ui:boardScreen/boardSlot")).toBe(true);

    // The game opened Settings; its game.ui has not come through the watch yet.
    useScene(ctx, SETTINGS);
    ctx.state.picker.on = true;
    await pickAt(ctx, { x: 137 + 806 / 2, y: 456 + 610 / 2 });

    expect(ctx.state.selected).toEqual(PANE);
    expect(ctx.state.picker.on).toBe(false);
    expect(ctx.state.scene?.nodes.has("ui:settingsScreen/settingsBoard")).toBe(true);
  });

  it("waits for the calibration in flight and picks with it", async () => {
    await watchBoard();
    const rect = Promise.withResolvers<Json>();
    const answer = ctx.link.read.getMockImplementation();
    ctx.link.read.mockImplementation((id, input) =>
      id === "game.rect" ? rect.promise : (answer?.(id, input) ?? Promise.reject(new Error(id)))
    );
    // A device change: the next snapshot reads game.rect again, the answer is on its way.
    recalibrate(ctx);
    ctx.link.send("game.ui", BOARD.ui);
    await flush();
    ctx.state.picker.on = true;

    // The board item at (540, 990) in reference units sits at (270, 495) at half scale.
    const picking = pickAt(ctx, { x: 270, y: 495 });
    await flush();
    expect(ctx.state.selected).toBeUndefined();

    rect.resolve({ x: 0, y: 0, w: 540, h: 720 });
    await picking;
    expect(ctx.state.calibration).toEqual({ scale: 0.5, x: 0, y: 0 });
    expect(ctx.state.selected).toEqual(ITEM);
  });

  it("drops the pick when the picker went off while it read", async () => {
    ctx.state.scene = boardScene();
    ctx.state.picker.on = true;
    const picking = pickAt(ctx, { x: 540, y: 990 });
    setPicker(ctx, false);
    await picking;
    expect(ctx.state.selected).toBeUndefined();
  });

  it("picks from the scene it has when the read fails", async () => {
    ctx.state.scene = boardScene();
    ctx.state.picker.on = true;
    ctx.link.values.delete("game.ui");
    await pickAt(ctx, { x: 540, y: 990 });
    expect(ctx.state.selected).toEqual(ITEM);
    expect(ctx.log.debug).toHaveBeenCalledWith("gameView: pick read failed", {
      message: "no value for game.ui"
    });
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
