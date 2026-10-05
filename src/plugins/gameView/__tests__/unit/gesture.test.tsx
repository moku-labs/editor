// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { act } from "preact/test-utils";
import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { escapeClosers } from "../../keys";
import { stopGameView } from "../../lifecycle";
import { isDrag, rectBetween } from "../../reference/gesture";
import { setReferenceMode } from "../../reference/mode";
import { stubCanvas } from "../canvas";
import { createCtx, JPEG, manifestOf, type TestCtx, useScene } from "../helpers";
import { boardScene, find, fire, settle } from "../ui";

// ─────────────────────────────────────────────────────────────────────────────
// Reference mode area gesture (U9, A16): a press on the proxy layer that moves
// under 4 client px is a click (the proxy picks, as before); 4 px or more makes
// the layer take the pointer, freezes the hover and draws the marquee in
// state.reference.area (device px through the frame box); the release picks
// the area. Esc during the drag cancels it. A crosshair over the layer.
// ─────────────────────────────────────────────────────────────────────────────

let ctx: TestCtx;
let capture: Mock<(pointerId: number) => void>;

/**
 * The proxy layer in the overlay.
 *
 * @returns The layer element.
 */
function layer(): HTMLElement {
  return find(ctx.workspace.overlayElement ?? document.body, "[data-moku-proxies]");
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

beforeEach(() => {
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
  act(() => setReferenceMode(ctx, true));
  capture = vi.fn<(pointerId: number) => void>();
  layer().setPointerCapture = capture;
});

afterEach(() => {
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

describe("a press on the proxy layer", () => {
  it("that moves under 4 px is a click: the proxy picks as before, the layer takes nothing", async () => {
    const coin = find(layer(), "[data-moku-key='coinPill']");
    pointer(coin, "pointerdown", 400, 120);
    pointer(coin, "pointermove", 402, 121, { buttons: 1 });
    pointer(coin, "pointerup", 402, 121);
    await settle();

    expect(capture).not.toHaveBeenCalled();
    expect(ctx.state.selected).toEqual({ kind: "ui", path: "boardScreen/hudRow/coinPill" });
    expect(ctx.state.reference.press).toBeUndefined();
    expect(marquee()).toBeUndefined();
  });

  it("that moves 4 px or more takes the pointer, freezes the hover and draws the marquee", async () => {
    const coin = find(layer(), "[data-moku-key='coinPill']");
    pointer(coin, "pointerdown", 130, 95);
    pointer(coin, "pointermove", 140, 100, { buttons: 1 });
    expect(capture).toHaveBeenCalledWith(1);

    pointer(layer(), "pointermove", 650, 230, { buttons: 1 });
    expect(ctx.state.reference.area).toEqual({ x: 30, y: 45, w: 520, h: 135 });
    expect(marquee()?.style.left).toBe("30px");
    expect(marquee()?.style.width).toBe("520px");

    fire(find(layer(), "[data-moku-key='settings']"), new PointerEvent("pointerenter"));
    expect(ctx.state.reference.hover).toBeUndefined();

    pointer(layer(), "pointerup", 650, 230);
    expect(marquee()).toBeUndefined();
    expect(ctx.state.reference.press).toBeUndefined();
    await settle();
    await settle();

    expect(ctx.state.selected).toBeUndefined();
    const card = ctx.link.files.text(".moku/captures/area-f1842.md");
    expect(card).toContain("- home button · key home");
    expect(card).toContain("- coinPill row · key coinPill");
  });

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

  it("Esc during the drag cancels it: the marquee goes, the release picks nothing", async () => {
    pointer(layer(), "pointerdown", 130, 95);
    pointer(layer(), "pointermove", 650, 230, { buttons: 1 });
    const picker = escapeClosers(ctx).find(closer => closer.layer === "picker");

    act(() => {
      expect(picker?.close()).toBe(true);
    });
    expect(marquee()).toBeUndefined();
    expect(picker?.close()).toBe(false);

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

describe("picker.css (U9)", () => {
  const css = readFileSync(`${process.cwd()}/src/plugins/gameView/ui/styles/picker.css`, "utf8");

  it("shows a crosshair over the proxy layer and every proxy; the layer takes the pointer", () => {
    expect(css).toMatch(
      /\[data-moku-proxies\] \{[^}]*cursor: crosshair;[^}]*pointer-events: auto;/
    );
    expect(css).toMatch(/\[data-moku-proxy\] \{[^}]*cursor: crosshair;/);
  });

  it("draws the marquee dashed, in the selected box's family", () => {
    expect(css).toMatch(/\[data-box="area"\] \{[^}]*border-style: dashed;/);
  });
});
