// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableIframePageLoading":true}}
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFrameLayer, removeFrameLayer } from "../../frame/frame";
import { hostOf } from "../../hosts";
import { cornerAfter, Preview } from "../../ui/Preview";
import { createCtx, rectOf, stubRect, type TestCtx } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// B3 pinned preview: placement, S/M/L, the body plays the game, header drag snap, Alt+arrows
// ─────────────────────────────────────────────────────────────────────────────

let ctx: TestCtx;
let root: HTMLElement;

/**
 * The float.
 *
 * @returns The section.
 */
function float(): HTMLElement {
  const element = root.querySelector<HTMLElement>("[data-ui='preview']");
  if (element === null) throw new Error("no preview");
  return element;
}

/**
 * Dispatches a pointer event.
 *
 * @param target - Where.
 * @param type - pointerdown, pointermove or pointerup.
 * @param x - clientX.
 * @param y - clientY.
 */
function pointer(target: Element, type: string, x: number, y: number): void {
  act(() => {
    target.dispatchEvent(
      new PointerEvent(type, { clientX: x, clientY: y, button: 0, pointerId: 1, bubbles: true })
    );
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  ctx = createCtx({ defaultWorkspace: "flow" });
  // The sizes below are the iPhone 15's (393×852), not the default device's.
  ctx.state.device = { preset: "iphone-15", orientation: "portrait" };
  root = document.createElement("div");
  document.body.append(root);
  stubRect(hostOf(ctx.state, "flow"), rectOf(0, 0, 1000, 800));
  createFrameLayer(ctx);
  act(() => {
    render(h(Preview, { ctx }), root);
  });
});

afterEach(() => {
  act(() => {
    render(undefined, root);
  });
  removeFrameLayer(ctx.state);
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("Preview", () => {
  it("floats S in the bottom-right corner of the zone, 12 px in, and docks the frame", () => {
    const element = float();
    expect(element.dataset.size).toBe("S");
    expect(element.style.left).toBe(`${1000 - 12 - 150}px`);
    expect(element.style.top).toBe(`${800 - 12 - 280}px`);
    expect(element.style.width).toBe("150px");
    expect(ctx.state.frame.previewBody).toBe(element.querySelector("[data-preview-body]"));
    expect(ctx.state.frame.box?.docked).toBe("preview");
    expect(element.textContent).not.toContain("iPhone 15");
  });

  it("uses a registered zone with its insets", () => {
    const zone = document.createElement("div");
    stubRect(zone, rectOf(100, 50, 600, 400));
    ctx.state.frame.zones.set("flow", { element: zone, insets: () => ({ bottom: 40 }) });
    act(() => ctx.state.ui.bump());
    expect(float().style.top).toBe(`${50 + 400 - 12 - 40 - 280}px`);
  });

  it("hides the body and the frame below 96 px of fitted width; the header stays", () => {
    const zone = document.createElement("div");
    stubRect(zone, rectOf(0, 0, 480, 800));
    // A wide drawer leaves 11 px of room: 480 - 12 - 445 - 12.
    ctx.state.frame.zones.set("flow", { element: zone, insets: () => ({ right: 445 }) });
    act(() => ctx.state.ui.bump());

    const element = float();
    expect(element.dataset.collapsed).toBe("");
    expect(element.style.width).toBe("");
    expect(element.style.height).toBe("");
    expect(element.style.left).toBe("12px");
    expect(element.querySelector<HTMLElement>("[data-preview-body]")?.hidden).toBe(true);
    expect(ctx.state.frame.previewBody).toBeUndefined();
    expect(ctx.state.frame.box?.docked).not.toBe("preview");
    expect(element.querySelector("[data-preview-head] [data-title]")?.textContent).toBe("Game");
    expect(element.querySelectorAll("[role='radio']")).toHaveLength(3);
    expect(element.querySelector("[aria-label='Open in Game']")).not.toBeNull();

    // Room again (the drawer narrowed): the body and the frame come back.
    ctx.state.frame.zones.set("flow", { element: zone, insets: () => ({ right: 300 }) });
    act(() => ctx.state.ui.bump());
    expect(float().dataset.collapsed).toBeUndefined();
    expect(float().style.width).toBe("150px");
    expect(float().querySelector<HTMLElement>("[data-preview-body]")?.hidden).toBe(false);
    expect(ctx.state.frame.previewBody).toBe(float().querySelector("[data-preview-body]"));
    expect(ctx.state.frame.box?.docked).toBe("preview");
  });

  it("keeps the body at exactly 96 px of fitted width", () => {
    const zone = document.createElement("div");
    stubRect(zone, rectOf(0, 0, 800, 600));
    ctx.state.frame.zones.set("flow", { element: zone, insets: () => ({ right: 680 }) });
    act(() => ctx.state.ui.bump());

    expect(float().dataset.collapsed).toBeUndefined();
    expect(float().style.width).toBe("96px");
    expect(ctx.state.frame.box?.docked).toBe("preview");
  });

  it("S/M/L is a radiogroup; M shows the device", () => {
    const radios = float().querySelectorAll<HTMLButtonElement>("[role='radio']");
    expect(float().querySelector("[role='radiogroup']")?.getAttribute("aria-label")).toBe(
      "Preview size"
    );
    expect(radios[0]?.getAttribute("aria-checked")).toBe("true");
    act(() => radios[1]?.click());
    expect(ctx.state.previews.flow.size).toBe("M");
    expect(float().textContent).toContain("iPhone 15 · 393×852");
    expect(float().style.width).toBe("280px");
  });

  it("a press on the body is the game's: no size change, no drag, no tooltip", () => {
    const body = float().querySelector<HTMLElement>("[data-preview-body]");
    if (body === null) throw new Error("no body");
    expect(body.title).toBe("");
    pointer(body, "pointerdown", 900, 700);
    pointer(body, "pointerup", 901, 701);
    expect(ctx.state.previews.flow.size).toBe("S");

    pointer(body, "pointerdown", 900, 700);
    pointer(body, "pointermove", 100, 100);
    pointer(body, "pointerup", 100, 100);
    expect(float().dataset.dragging).toBeUndefined();
    expect(ctx.state.previews.flow.corner).toBe("bottom-right");
  });

  it("a header drag moves the float and snaps it to the nearest corner on release", () => {
    const head = float().querySelector("[data-preview-head] [data-title]");
    if (head === null) throw new Error("no head");
    pointer(head, "pointerdown", 900, 700);
    pointer(head, "pointermove", 600, 400);
    expect(float().dataset.dragging).toBe("");
    expect(float().style.transform).toBe("translate(-300px, -300px)");
    pointer(head, "pointermove", 100, 100);
    pointer(head, "pointerup", 100, 100);

    expect(ctx.state.previews.flow.corner).toBe("top-left");
    expect(ctx.state.previews.flow.size).toBe("S");
    expect(float().style.transform).toBe("");
    expect(float().style.left).toBe("12px");
    expect(JSON.parse(localStorage.getItem("moku-editor-test") ?? "{}").previews.flow.corner).toBe(
      "top-left"
    );
  });

  it("a press on a header button does not start a drag", () => {
    const hide = float().querySelector<HTMLButtonElement>("[aria-label='Hide the game preview']");
    if (hide === null) throw new Error("no hide");
    pointer(hide, "pointerdown", 900, 700);
    pointer(hide, "pointermove", 100, 100);
    expect(float().dataset.dragging).toBeUndefined();
  });

  it("Alt+arrows on the focused header move it a corner", () => {
    const head = float().querySelector<HTMLElement>("[data-preview-head]");
    act(() => {
      head?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowUp", altKey: true, bubbles: true })
      );
    });
    expect(ctx.state.previews.flow.corner).toBe("top-right");
    act(() => {
      head?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    });
    expect(ctx.state.previews.flow.corner).toBe("top-right");
  });

  it("Open in Game names ⌘1 in its tooltip", () => {
    const open = float().querySelector<HTMLButtonElement>("[aria-label='Open in Game']");
    expect(open?.title).toBe("Open in Game (⌘1)");
  });

  it("Open in Game shows Game; Hide hides it with the workspace toast; hidden in Game", () => {
    act(() =>
      float().querySelector<HTMLButtonElement>("[aria-label='Hide the game preview']")?.click()
    );
    expect(ctx.state.previews.flow.visible).toBe(false);
    expect(float().hidden).toBe(true);
    expect(ctx.state.frame.previewBody).toBeUndefined();
    expect(ctx.state.toasts.at(-1)?.message).toBe(
      "Game preview hidden in Flow · remembered for this workspace"
    );

    ctx.state.previews.flow.visible = true;
    act(() => ctx.state.ui.bump());
    act(() => float().querySelector<HTMLButtonElement>("[aria-label='Open in Game']")?.click());
    expect(ctx.state.active).toBe("game");
    expect(float().hidden).toBe(true);
  });
});

describe("cornerAfter", () => {
  it("moves along the arrow and ignores other keys", () => {
    expect(cornerAfter("bottom-right", "ArrowLeft")).toBe("bottom-left");
    expect(cornerAfter("top-left", "ArrowRight")).toBe("top-right");
    expect(cornerAfter("top-left", "ArrowDown")).toBe("bottom-left");
    expect(cornerAfter("top-left", "Enter")).toBeUndefined();
  });
});
