// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { act } from "preact/test-utils";
import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sidePanelState } from "../../../panels/shared/side-panel";
import { updateSidePanel } from "../../../panels/shared/side-panel/store";
import { setPicker } from "../../element/select";
import { escapeClosers } from "../../keys";
import { stopGameView } from "../../lifecycle";
import { isDrag, rectBetween } from "../../reference/gesture";
import { SIDE_PANEL } from "../../side";
import { stubCanvas } from "../canvas";
import { createCtx, DAY, JPEG, manifestOf, type TestCtx, TODAY, useScene } from "../helpers";
import { boardScene, find, fire, settle } from "../ui";

// ─────────────────────────────────────────────────────────────────────────────
// The area gesture of the Select picker (U9, A16, captures-by-day U4): a press
// on the picker layer that moves under 4 client px is a click (the picker picks
// the element at the point); 4 px or more makes the layer take the pointer,
// freezes the hover and draws the marquee in state.reference.area (device px
// through the frame box); the release picks the area and turns the picker off.
// Esc during the drag cancels it. A crosshair over the layer.
// ─────────────────────────────────────────────────────────────────────────────

let ctx: TestCtx;
let capture: Mock<(pointerId: number) => void>;

/**
 * The picker layer in the overlay.
 *
 * @returns The layer element.
 */
function layer(): HTMLElement {
  return find(ctx.workspace.overlayElement ?? document.body, "[data-part='picker']");
}

/**
 * Fires a bubbling pointer event of pointer 1 at a client point.
 *
 * @param target - Where it happens.
 * @param type - "pointerdown", "pointermove", "pointerup" or "pointercancel".
 * @param x - Client x.
 * @param y - Client y.
 * @param init - More fields (button, buttons).
 */
function pointer(
  target: Element,
  type: string,
  x: number,
  y: number,
  init: PointerEventInit = {}
): void {
  fire(
    target,
    new PointerEvent(type, { bubbles: true, pointerId: 1, clientX: x, clientY: y, ...init })
  );
}

/**
 * The marquee in the overlay, undefined when none is drawn.
 *
 * @returns The element.
 */
function marquee(): HTMLElement | undefined {
  return ctx.workspace.overlayElement?.querySelector<HTMLElement>("[data-box='area']") ?? undefined;
}

/**
 * The client point at the middle of a scene node.
 *
 * @param id - The node id.
 * @returns Client x and y (the frame box is at 100,50, scale 1).
 */
function middleOf(id: string): { readonly x: number; readonly y: number } {
  const rect = ctx.state.scene?.nodes.get(id)?.rect;
  if (rect === undefined) throw new Error(`fixture: no rect for ${id}`);
  return { x: 100 + rect.x + rect.w / 2, y: 50 + rect.y + rect.h / 2 };
}

beforeEach(() => {
  vi.setSystemTime(TODAY);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(() => Promise.resolve()) } });
  stubCanvas({ width: 1179, height: 2556 });
  ctx = createCtx();
  useScene(ctx);
  ctx.state.scene = boardScene();
  ctx.state.calibration = { scale: 1, x: 0, y: 0 };
  ctx.link.manifestValue = manifestOf([["editor.capture", "read"]]);
  ctx.panels.answers.set("editor.capture", {
    image: JPEG,
    frame: 1842,
    device: { w: 393, h: 852, orientation: "portrait" }
  });
  ctx.workspace.box = { left: 100, top: 50, width: 393, height: 852, scale: 1, docked: "stage" };
  act(() => setPicker(ctx, true));
  capture = vi.fn<(pointerId: number) => void>();
  layer().setPointerCapture = capture;
});

afterEach(() => {
  vi.useRealTimers();
  stopGameView(ctx);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("the drag threshold", () => {
  it("is 4 client px from the press", () => {
    expect(isDrag({ x: 0, y: 0 }, { x: 3, y: 2 })).toBe(false);
    expect(isDrag({ x: 0, y: 0 }, { x: 0, y: -4 })).toBe(true);
  });

  it("rectBetween spans two corners in any order", () => {
    expect(rectBetween({ x: 10, y: 20 }, { x: 4, y: 5 })).toEqual({ x: 4, y: 5, w: 6, h: 15 });
  });
});

describe("a press on the picker layer", () => {
  it("a browser that refuses the capture leaves the drag going without it", () => {
    capture.mockImplementation(() => {
      throw new Error("InvalidPointerId");
    });
    pointer(layer(), "pointerdown", 130, 95);
    pointer(layer(), "pointermove", 650, 230, { buttons: 1 });
    expect(ctx.state.reference.area).toEqual({ x: 30, y: 45, w: 520, h: 135 });
    expect(ctx.log.debug).toHaveBeenCalledWith("gameView: pointer capture refused", {
      message: "InvalidPointerId"
    });
  });

  it("maps client px to device px through the frame box", () => {
    ctx.workspace.box = {
      left: 100,
      top: 50,
      width: 196,
      height: 426,
      scale: 0.5,
      docked: "stage"
    };
    pointer(layer(), "pointerdown", 110, 60);
    pointer(layer(), "pointermove", 130, 90, { buttons: 1 });
    expect(ctx.state.reference.area).toEqual({ x: 20, y: 20, w: 40, h: 60 });
  });

  it("reads the frame box once per press: a later box does not move the marquee", () => {
    pointer(layer(), "pointerdown", 110, 60);
    ctx.workspace.box = {
      left: 0,
      top: 0,
      width: 196,
      height: 426,
      scale: 0.5,
      docked: "stage"
    };
    pointer(layer(), "pointermove", 130, 90, { buttons: 1 });
    expect(ctx.state.reference.press?.box?.scale).toBe(1);
    expect(ctx.state.reference.area).toEqual({ x: 10, y: 10, w: 20, h: 30 });
  });

  it("a cancelled drag keeps its marquee away: later moves draw nothing, the release picks nothing", async () => {
    pointer(layer(), "pointerdown", 130, 95);
    pointer(layer(), "pointermove", 650, 230, { buttons: 1 });
    const closer = escapeClosers(ctx).find(entry => entry.layer === "picker");
    act(() => {
      expect(closer?.close()).toBe(true);
    });
    expect(marquee()).toBeUndefined();

    pointer(layer(), "pointermove", 700, 300, { buttons: 1 });
    expect(ctx.state.reference.area).toBeUndefined();
    pointer(layer(), "pointerup", 700, 300);
    await settle();
    expect(ctx.panels.run).not.toHaveBeenCalled();
    expect(ctx.state.reference.press).toBeUndefined();
  });

  it("a move with no button down drops a press whose release the layer never saw", () => {
    pointer(layer(), "pointerdown", 130, 95);
    pointer(layer(), "pointermove", 650, 230, { buttons: 0 });
    expect(ctx.state.reference.press).toBeUndefined();
    expect(capture).not.toHaveBeenCalled();
  });

  it("pointercancel drops the press and the marquee; a right press is no area press", () => {
    pointer(layer(), "pointerdown", 130, 95);
    pointer(layer(), "pointermove", 650, 230, { buttons: 1 });
    pointer(layer(), "pointercancel", 650, 230);
    expect(ctx.state.reference.press).toBeUndefined();
    expect(marquee()).toBeUndefined();

    pointer(layer(), "pointerdown", 130, 95, { button: 2 });
    expect(ctx.state.reference.press).toBeUndefined();
  });

  it("another pointer and a move before any press change nothing", () => {
    pointer(layer(), "pointermove", 650, 230, { buttons: 1 });
    pointer(layer(), "pointerdown", 130, 95);
    fire(
      layer(),
      new PointerEvent("pointermove", {
        bubbles: true,
        pointerId: 2,
        clientX: 650,
        clientY: 230,
        buttons: 1
      })
    );
    expect(ctx.state.reference.area).toBeUndefined();
    expect(ctx.state.reference.press?.dragging).toBe(false);
  });
});

describe("an area drag in Select (the picker layer, captures-by-day U4)", () => {
  it("a click without a drag still picks one element: Element tab, picker off", async () => {
    const coin = middleOf("ui:boardScreen/hudRow/coinPill");
    pointer(layer(), "pointerdown", coin.x, coin.y);
    pointer(layer(), "pointermove", coin.x + 2, coin.y + 1, { buttons: 1 });
    pointer(layer(), "pointerup", coin.x + 2, coin.y + 1);
    await settle();
    await settle();

    expect(capture).not.toHaveBeenCalled();
    expect(marquee()).toBeUndefined();
    expect(ctx.state.selected).toEqual({ kind: "ui", path: "boardScreen/hudRow/coinPill" });
    expect(ctx.state.picker.on).toBe(false);
    expect(ctx.state.tab).toBe("element");
    expect(ctx.link.files.paths()).toContain(`${DAY}/coinPill-f1842.md`);
    expect(ctx.link.files.paths()).not.toContain(`${DAY}/area-f1842.md`);
  });

  it("a drag takes the pointer, draws the marquee, writes the area card and turns the picker off", async () => {
    pointer(layer(), "pointerdown", 130, 95);
    pointer(layer(), "pointermove", 140, 100, { buttons: 1 });
    expect(capture).toHaveBeenCalledWith(1);

    pointer(layer(), "pointermove", 650, 230, { buttons: 1 });
    expect(ctx.state.reference.area).toEqual({ x: 30, y: 45, w: 520, h: 135 });
    expect(marquee()?.style.left).toBe("30px");
    expect(marquee()?.style.width).toBe("520px");

    pointer(layer(), "pointerup", 650, 230);
    expect(marquee()).toBeUndefined();
    expect(ctx.state.reference.press).toBeUndefined();
    expect(ctx.state.picker.on).toBe(false);
    await settle();
    await settle();

    expect(ctx.state.selected).toBeUndefined();
    const card = ctx.link.files.text(`${DAY}/area-f1842.md`);
    expect(card).toContain("- home button · key home");
    expect(card).toContain("- coinPill row · key coinPill");
  });

  it("the hover box stays where it was while the drag runs", () => {
    const coin = middleOf("ui:boardScreen/hudRow/coinPill");
    pointer(layer(), "pointermove", coin.x, coin.y);
    const hover = ctx.state.picker.hover;
    expect(hover).toBeDefined();

    pointer(layer(), "pointerdown", coin.x, coin.y);
    pointer(layer(), "pointermove", 140, 100, { buttons: 1 });
    expect(ctx.state.picker.hover).toBe(hover);
  });

  it("Esc during the drag cancels only the drag; the next Esc turns the picker off", async () => {
    pointer(layer(), "pointerdown", 130, 95);
    pointer(layer(), "pointermove", 650, 230, { buttons: 1 });
    const closer = escapeClosers(ctx).find(entry => entry.layer === "picker");

    act(() => {
      expect(closer?.close()).toBe(true);
    });
    expect(marquee()).toBeUndefined();
    expect(ctx.state.picker.on).toBe(true);

    pointer(layer(), "pointerup", 650, 230);
    await settle();
    expect(ctx.panels.run).not.toHaveBeenCalled();
    expect(ctx.state.picker.on).toBe(true);
    act(() => {
      expect(closer?.close()).toBe(true);
    });
    expect(ctx.state.picker.on).toBe(false);
    expect(closer?.close()).toBe(false);
  });
});

describe("Select with Copy on select off: inspect only (D-70)", () => {
  beforeEach(() => {
    ctx.workspace.copyOnSelectValue = false;
  });

  it("a drag picks nothing: the marquee goes, no command, no file, the selection and the picker stay", async () => {
    const before = { kind: "ui", path: "boardScreen/hudRow/coinPill" } as const;
    ctx.state.selected = before;
    const published = ctx.link.notify.mock.calls.length;

    pointer(layer(), "pointerdown", 130, 95);
    pointer(layer(), "pointermove", 650, 230, { buttons: 1 });
    expect(marquee()?.style.width).toBe("520px");

    pointer(layer(), "pointerup", 650, 230);
    expect(marquee()).toBeUndefined();
    expect(ctx.state.reference.press).toBeUndefined();
    await settle();
    await settle();

    expect(ctx.panels.run).not.toHaveBeenCalled();
    expect(ctx.link.files.paths()).toEqual([]);
    expect(ctx.state.card).toBeUndefined();
    expect(ctx.state.bookmarks).toEqual([]);
    expect(ctx.workspace.toast).not.toHaveBeenCalled();
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    expect(ctx.state.selected).toEqual(before);
    expect(ctx.link.notify.mock.calls).toHaveLength(published);
    // Like a click on nothing: Select stays on, so the next click can pick an element.
    expect(ctx.state.picker.on).toBe(true);
  });

  it("a click only selects the element: Element tab, picker off, nothing written", async () => {
    const coin = middleOf("ui:boardScreen/hudRow/coinPill");
    pointer(layer(), "pointerdown", coin.x, coin.y);
    pointer(layer(), "pointerup", coin.x, coin.y);
    await settle();
    await settle();

    expect(ctx.state.selected).toEqual({ kind: "ui", path: "boardScreen/hudRow/coinPill" });
    expect(ctx.state.picker.on).toBe(false);
    expect(ctx.state.tab).toBe("element");
    expect(ctx.panels.run).not.toHaveBeenCalled();
    expect(ctx.link.files.paths()).toEqual([]);
    expect(ctx.state.card).toBeUndefined();
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });

  it("a click opens the Element panel when it is collapsed or closed", async () => {
    updateSidePanel(SIDE_PANEL, { collapsed: true, closed: true });
    const coin = middleOf("ui:boardScreen/hudRow/coinPill");
    pointer(layer(), "pointerdown", coin.x, coin.y);
    pointer(layer(), "pointerup", coin.x, coin.y);
    await settle();
    await settle();

    expect(sidePanelState(SIDE_PANEL)).toMatchObject({ collapsed: false, closed: false });
  });
});

describe("Select with Copy on select on: the Element panel is left as it is", () => {
  it("a click does not open a collapsed Element panel", async () => {
    updateSidePanel(SIDE_PANEL, { collapsed: true });
    const coin = middleOf("ui:boardScreen/hudRow/coinPill");
    pointer(layer(), "pointerdown", coin.x, coin.y);
    pointer(layer(), "pointerup", coin.x, coin.y);
    await settle();
    await settle();

    expect(sidePanelState(SIDE_PANEL).collapsed).toBe(true);
  });
});

describe("picker.css (U9)", () => {
  const css = readFileSync(`${process.cwd()}/src/plugins/gameView/ui/styles/picker.css`, "utf8");

  it("shows a crosshair over the picker layer; the layer takes the pointer, no proxy does", () => {
    expect(css).toMatch(
      /\[data-part="picker"\] \{[^}]*cursor: crosshair;[^}]*pointer-events: auto;/
    );
    expect(css).not.toContain("data-moku-prox");
  });

  it("draws the marquee dashed, in the selected box's family", () => {
    expect(css).toMatch(/\[data-box="area"\] \{[^}]*border-style: dashed;/);
  });
});
