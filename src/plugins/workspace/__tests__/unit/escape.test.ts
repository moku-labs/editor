import { describe, expect, it, vi } from "vitest";
import { addEscapeLayer, ESC_RANK, unwind } from "../../keys/escape";
import { createCtx } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// Esc unwinding: rank order, one close per press, latest registration first
// ─────────────────────────────────────────────────────────────────────────────

describe("ESC_RANK", () => {
  it("puts the modals first and the selection last (design §4)", () => {
    expect(ESC_RANK[0]).toBe("palette");
    expect(ESC_RANK[1]).toBe("contactSheet");
    expect(ESC_RANK.at(-1)).toBe("selection");
    expect(ESC_RANK).toHaveLength(12);
  });
});

describe("unwind", () => {
  it("asks layers in rank order and stops at the first close that returns true", () => {
    const ctx = createCtx();
    const calls: string[] = [];
    addEscapeLayer(ctx, "selection", () => {
      calls.push("selection");
      return true;
    });
    addEscapeLayer(ctx, "stepPopover", () => {
      calls.push("stepPopover");
      return false;
    });
    addEscapeLayer(ctx, "contextMenu", () => {
      calls.push("contextMenu");
      return true;
    });

    expect(unwind(ctx)).toBe(true);
    expect(calls).toEqual(["contextMenu"]);
  });

  it("one press closes one thing: the next press reaches the next layer", () => {
    const ctx = createCtx();
    let menuOpen = true;
    const selection = vi.fn(() => true);
    addEscapeLayer(ctx, "contextMenu", () => {
      if (!menuOpen) return false;
      menuOpen = false;
      return true;
    });
    addEscapeLayer(ctx, "selection", selection);

    expect(unwind(ctx)).toBe(true);
    expect(selection).not.toHaveBeenCalled();
    expect(unwind(ctx)).toBe(true);
    expect(selection).toHaveBeenCalledTimes(1);
  });

  it("within a layer the latest registration is asked first", () => {
    const ctx = createCtx();
    const order: string[] = [];
    addEscapeLayer(ctx, "picker", () => {
      order.push("first");
      return true;
    });
    addEscapeLayer(ctx, "picker", () => {
      order.push("second");
      return false;
    });

    unwind(ctx);
    expect(order).toEqual(["second", "first"]);
  });

  it("returns false when nothing closes, and a remover takes a layer out", () => {
    const ctx = createCtx();
    const close = vi.fn(() => true);
    const remove = addEscapeLayer(ctx, "registry", close);
    remove();
    remove();

    expect(unwind(ctx)).toBe(false);
    expect(close).not.toHaveBeenCalled();
  });
});
