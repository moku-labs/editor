import { describe, expect, it, vi } from "vitest";
import type { Tap } from "../../../registry/protocol";
import { addTapListener, notifyTap } from "../../subscriptions/taps";
import { createCtx } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The tap listeners of link
// ─────────────────────────────────────────────────────────────────────────────

describe("tap listeners", () => {
  it("gives every listener the same frozen tap, in subscription order", () => {
    const ctx = createCtx();
    const calls: [string, Tap][] = [];
    addTapListener(ctx, tap => calls.push(["first", tap]));
    addTapListener(ctx, tap => calls.push(["second", tap]));

    notifyTap(ctx, { x: 206, y: 640, at: 15_234.5 });

    expect(calls.map(([name]) => name)).toEqual(["first", "second"]);
    expect(calls[0]?.[1]).toEqual({ x: 206, y: 640, at: 15_234.5 });
    expect(calls[0]?.[1]).toBe(calls[1]?.[1]);
    expect(Object.isFrozen(calls[0]?.[1])).toBe(true);
  });

  it("keeps two entries for the same function; each remover removes one, once", () => {
    const ctx = createCtx();
    const seen = vi.fn();
    const first = addTapListener(ctx, seen);
    addTapListener(ctx, seen);

    first();
    first();
    notifyTap(ctx, { x: 1, y: 2, at: 3 });

    expect(seen).toHaveBeenCalledTimes(1);
    expect(ctx.state.tapListeners.size).toBe(1);
  });

  it("logs a throwing listener and still calls the others", () => {
    const ctx = createCtx();
    const seen = vi.fn();
    addTapListener(ctx, () => {
      throw new Error("ripple broke");
    });
    addTapListener(ctx, () => {
      throw "plain text";
    });
    addTapListener(ctx, seen);

    notifyTap(ctx, { x: 1, y: 2, at: 3 });

    expect(seen).toHaveBeenCalledOnce();
    expect(ctx.log.error).toHaveBeenCalledWith(
      "link:tap-listener-failed",
      {},
      new Error("ripple broke")
    );
    expect(ctx.log.error).toHaveBeenCalledWith("link:tap-listener-failed", {}, undefined);
  });
});
