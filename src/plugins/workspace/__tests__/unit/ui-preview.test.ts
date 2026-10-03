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
// B3 pinned preview: placement, S/M/L, body click cycle, drag snap, Alt+arrows
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
  ctx = createCtx();
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

  it("a body click cycles S → M → L → S", () => {
    for (const size of ["M", "L", "S"]) {
      const body = float().querySelector("[data-preview-body]");
      if (body === null) throw new Error("no body");
      pointer(body, "pointerdown", 900, 700);
      pointer(body, "pointerup", 901, 701);
      expect(ctx.state.previews.flow.size).toBe(size);
    }
  });

  it("a drag moves the float and snaps it to the nearest corner on release", () => {
    const body = float().querySelector("[data-preview-body]");
    if (body === null) throw new Error("no body");
    pointer(body, "pointerdown", 900, 700);
    pointer(body, "pointermove", 600, 400);
    expect(float().dataset.dragging).toBeDefined();
    expect(float().style.transform).toBe("translate(-300px, -300px)");
    pointer(body, "pointermove", 100, 100);
    pointer(body, "pointerup", 100, 100);

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
