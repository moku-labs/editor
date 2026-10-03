import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearToasts,
  dismissToast,
  MAX_TOASTS,
  pauseToast,
  resumeToast,
  showToast
} from "../../toasts";
import { createCtx } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// F1 toasts: max 3 (oldest drops), toastMs, paused on hover or focus
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * The visible messages.
 *
 * @param ctx - The ctx.
 * @returns The messages.
 */
function messages(ctx: ReturnType<typeof createCtx>): string[] {
  return ctx.state.toasts.map(toast => toast.message);
}

describe("showToast", () => {
  it("shows a toast with its file, bumps the UI and hides it after toastMs", () => {
    const ctx = createCtx();
    showToast(ctx, "Layout saved", ".moku/editor/layout.json");
    expect(ctx.state.toasts[0]).toMatchObject({
      id: 1,
      message: "Layout saved",
      file: ".moku/editor/layout.json"
    });
    expect(ctx.state.ui.version).toBe(1);

    vi.advanceTimersByTime(2599);
    expect(messages(ctx)).toEqual(["Layout saved"]);
    vi.advanceTimersByTime(1);
    expect(messages(ctx)).toEqual([]);
    expect(ctx.state.ui.version).toBe(2);
  });

  it("keeps at most 3; the oldest drops and its timer is cleared", () => {
    const ctx = createCtx();
    for (const text of ["a", "b", "c", "d"]) showToast(ctx, text);
    expect(MAX_TOASTS).toBe(3);
    expect(messages(ctx)).toEqual(["b", "c", "d"]);
    expect(vi.getTimerCount()).toBe(3);
  });

  it("does nothing after stop", () => {
    const ctx = createCtx();
    ctx.state.stopped = true;
    showToast(ctx, "late");
    expect(ctx.state.toasts).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("pause / resume / dismiss / clear", () => {
  it("a paused toast stays; resume restarts its full time", () => {
    const ctx = createCtx();
    showToast(ctx, "hover me");
    vi.advanceTimersByTime(2000);
    pauseToast(ctx, 1);
    vi.advanceTimersByTime(10_000);
    expect(messages(ctx)).toEqual(["hover me"]);

    resumeToast(ctx, 1);
    vi.advanceTimersByTime(2599);
    expect(messages(ctx)).toEqual(["hover me"]);
    vi.advanceTimersByTime(1);
    expect(messages(ctx)).toEqual([]);
  });

  it("pause, resume and dismiss ignore unknown ids", () => {
    const ctx = createCtx();
    pauseToast(ctx, 9);
    resumeToast(ctx, 9);
    dismissToast(ctx.state, 9);
    expect(ctx.state.toasts).toEqual([]);
  });

  it("dismiss removes one toast; clear removes all and their timers", () => {
    const ctx = createCtx();
    showToast(ctx, "a");
    showToast(ctx, "b");
    dismissToast(ctx.state, 1);
    expect(messages(ctx)).toEqual(["b"]);
    clearToasts(ctx.state);
    expect(ctx.state.toasts).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
