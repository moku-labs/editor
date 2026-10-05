import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RESTORED_TOAST, takeRestore, watchRestores } from "../../frame/restored";
import { createCtx, manifestOf, type TestCtx } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// manifest.restored (round 2 R6): the bridge restored its checkpoint across
// Bun's full reload; workspace toasts it once and never restores again
// ─────────────────────────────────────────────────────────────────────────────

let ctx: TestCtx;

/** A restore the bridge reports in its hello. */
const RESTORE = { bookmark: '{"checkpoint":"home"}', frame: 1203 };

/**
 * The texts of the visible toasts.
 *
 * @returns The messages.
 */
function toasts(): string[] {
  return ctx.state.toasts.map(toast => toast.message);
}

beforeEach(() => {
  vi.useFakeTimers();
  ctx = createCtx();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("takeRestore", () => {
  it("is true once per restore and false without one", () => {
    expect(takeRestore(ctx.state, manifestOf())).toBe(false);
    expect(takeRestore(ctx.state, undefined)).toBe(false);
    expect(takeRestore(ctx.state, { ...manifestOf(), restored: RESTORE })).toBe(true);
    expect(takeRestore(ctx.state, { ...manifestOf(), restored: { ...RESTORE } })).toBe(false);
    expect(takeRestore(ctx.state, { ...manifestOf(), restored: { ...RESTORE, frame: 9 } })).toBe(
      true
    );
  });
});

describe("watchRestores", () => {
  it("toasts a new session that restored its state, once", () => {
    const stop = watchRestores(ctx);
    ctx.link.attach({ ...manifestOf(), restored: RESTORE });
    ctx.link.attach({ ...manifestOf(), restored: RESTORE });
    ctx.link.attach(manifestOf());
    expect(toasts()).toEqual([RESTORED_TOAST]);
    expect(RESTORED_TOAST).toBe("Game reloaded · state restored");

    stop();
    ctx.link.attach({ ...manifestOf(), restored: { ...RESTORE, frame: 2 } });
    expect(toasts()).toEqual([RESTORED_TOAST]);
  });

  it("skips the manifest that is already there when it subscribes", () => {
    ctx.link.manifestValue = { ...manifestOf(), restored: RESTORE };
    watchRestores(ctx);
    expect(toasts()).toEqual([]);
  });

  it("leaves the toast to a reload that is waiting for this session", () => {
    ctx.state.frame.reload = {
      promise: Promise.resolve({ restored: true }),
      again: false,
      since: undefined
    };
    watchRestores(ctx);
    ctx.link.attach({ ...manifestOf(), restored: RESTORE });
    expect(toasts()).toEqual([]);
  });

  it("does nothing after stop", () => {
    watchRestores(ctx);
    ctx.state.stopped = true;
    ctx.link.attach({ ...manifestOf(), restored: RESTORE });
    expect(toasts()).toEqual([]);
  });
});
