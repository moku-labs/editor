// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openOverlay } from "../../modes";
import { STORE_KEY } from "../../types";
import { changes, createOctx, part, started, stopped, type TestOctx } from "../helpers";

let octx: TestOctx;

beforeEach(() => {
  localStorage.clear();
  octx = started(createOctx());
  openOverlay(octx);
});

afterEach(() => {
  stopped(octx);
  vi.restoreAllMocks();
  localStorage.clear();
});

/**
 * Dispatches a pointer event on the grip.
 *
 * @param type - The event type.
 * @param x - clientX.
 * @param y - clientY.
 */
function pointer(type: string, x: number, y: number): void {
  part(octx, '[data-part="grip"]').dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      pointerId: 1,
      button: 0,
      clientX: x,
      clientY: y,
      isPrimary: true
    })
  );
}

/**
 * Presses a key on the grip.
 *
 * @param key - The key.
 */
function key(key: string): void {
  part(octx, '[data-part="grip"]').dispatchEvent(
    new KeyboardEvent("keydown", { bubbles: true, key })
  );
}

/**
 * The host's top as laid out.
 *
 * @returns CSS px.
 */
function top(): string | undefined {
  return octx.state.host?.style.getPropertyValue("--overlay-top");
}

describe("drag the grip", () => {
  it("a tap on the grip moves the card (a press without travel does nothing)", () => {
    const setItem = vi.spyOn(localStorage, "setItem");
    pointer("pointerdown", 900, 500);
    pointer("pointermove", 902, 501);
    expect(octx.state.host?.style.transform).toBe("");
    pointer("pointerup", 902, 501);
    expect(octx.state.place).toEqual({ dock: "right", y: 1 });
    expect(setItem).not.toHaveBeenCalled();
  });

  it("the drag writes the store on every move (only on release); a drop left of centre docks left", () => {
    const setItem = vi.spyOn(localStorage, "setItem");
    pointer("pointerdown", 900, 500);
    pointer("pointermove", 600, 400);
    pointer("pointermove", 300, 300);
    expect(octx.state.host?.style.transform).toBe("translate(-600px, -200px)");
    expect(setItem).not.toHaveBeenCalled();
    pointer("pointerup", 300, 300);
    expect(octx.state.place.dock).toBe("left");
    // perf's display insets (top 32, bottom 24): the range is 40…390 on the 1024 × 768 page.
    expect(octx.state.place.y).toBeCloseTo(150 / 350);
    expect(octx.state.host?.style.transform).toBe("");
    expect(octx.state.host?.dataset.dock).toBe("left");
    expect(top()).toBe("190px");
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}").place.dock).toBe("left");
  });

  it("a place change emits overlay:changed (it emits nothing)", () => {
    const before = changes(octx).length;
    pointer("pointerdown", 900, 500);
    pointer("pointermove", 300, 300);
    pointer("pointerup", 300, 300);
    expect(changes(octx)).toHaveLength(before);
  });

  it("pointercancel leaves the transform on (it snaps and clears it)", () => {
    pointer("pointerdown", 900, 500);
    pointer("pointermove", 880, 300);
    pointer("pointercancel", 880, 300);
    expect(octx.state.host?.style.transform).toBe("");
    expect(octx.state.place.dock).toBe("right");
    expect(octx.state.drag).toBeUndefined();
  });

  it("ignores a secondary button and another pointer", () => {
    part(octx, '[data-part="grip"]').dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        pointerId: 1,
        button: 2,
        clientX: 900,
        clientY: 500
      })
    );
    expect(octx.state.drag).toBeUndefined();
    pointer("pointerdown", 900, 500);
    part(octx, '[data-part="grip"]').dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        pointerId: 2,
        button: 0,
        clientX: 100,
        clientY: 100
      })
    );
    expect(octx.state.host?.style.transform).toBe("");
  });
});

describe("move the grip by keyboard", () => {
  it("ArrowLeft does not change the dock (it docks left; ArrowRight docks right)", () => {
    key("ArrowLeft");
    expect(octx.state.place.dock).toBe("left");
    expect(octx.state.host?.dataset.dock).toBe("left");
    key("ArrowRight");
    expect(octx.state.place.dock).toBe("right");
  });

  it("ArrowUp and ArrowDown move by 16 px inside the range", () => {
    expect(top()).toBe("390px");
    key("ArrowUp");
    expect(top()).toBe("374px");
    key("ArrowDown");
    key("ArrowDown");
    expect(top()).toBe("390px");
    key("Enter");
    expect(top()).toBe("390px");
  });

  it("names its keys", () => {
    expect(part(octx, '[data-part="grip"]').getAttribute("aria-label")).toBe(
      "Move the overlay. Up and down move it, left and right pick the edge."
    );
  });
});
