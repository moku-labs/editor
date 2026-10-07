// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"navigation":{"disableChildFrameNavigation":true}}}
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFrameLayer, removeFrameLayer } from "../../frame/frame";
import { closeReference, setReference, toggleReference } from "../../reference";
import { createCtx, type TestCtx } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// Reference mode: a flag (never persisted), workspace:reference on a change,
// the frame box marked so its overlay takes the pointer, Esc turns it off
// ─────────────────────────────────────────────────────────────────────────────

let ctx: TestCtx;

/**
 * The frame box element.
 *
 * @returns The element.
 */
function boxElement(): HTMLElement {
  const element = document.querySelector<HTMLElement>("[data-frame-box]");
  if (element === null) throw new Error("no frame box");
  return element;
}

beforeEach(() => {
  localStorage.clear();
  ctx = createCtx();
  createFrameLayer(ctx);
});

afterEach(() => {
  removeFrameLayer(ctx.state);
  document.body.innerHTML = "";
});

describe("setReference", () => {
  it("turns it on: emits once, marks the frame box, bumps the UI, stores nothing", () => {
    const version = ctx.state.ui.version;
    setReference(ctx, true);
    setReference(ctx, true);

    expect(ctx.state.reference).toBe(true);
    expect(ctx.emit).toHaveBeenCalledTimes(1);
    expect(ctx.emit).toHaveBeenCalledWith("workspace:reference", { on: true });
    expect(boxElement().dataset.reference).toBe("");
    expect(ctx.state.ui.version).toBeGreaterThan(version);
    expect(localStorage.getItem("moku-editor-test")).toBeNull();
  });

  it("turns it off and unmarks the frame box", () => {
    setReference(ctx, true);
    setReference(ctx, false);
    expect(ctx.state.reference).toBe(false);
    expect(ctx.emit).toHaveBeenLastCalledWith("workspace:reference", { on: false });
    expect(boxElement().dataset.reference).toBeUndefined();
  });

  it("works before the frame layer exists", () => {
    removeFrameLayer(ctx.state);
    setReference(ctx, true);
    expect(ctx.state.reference).toBe(true);
    createFrameLayer(ctx);
    expect(boxElement().dataset.reference).toBe("");
  });
});

describe("toggleReference / closeReference", () => {
  it("toggle flips the flag; close turns it off once and reports whether it did", () => {
    toggleReference(ctx);
    expect(ctx.state.reference).toBe(true);
    expect(closeReference(ctx)).toBe(true);
    expect(ctx.state.reference).toBe(false);
    expect(closeReference(ctx)).toBe(false);
    toggleReference(ctx);
    toggleReference(ctx);
    expect(ctx.state.reference).toBe(false);
  });
});
