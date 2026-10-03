// @vitest-environment happy-dom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { showToast } from "../../toasts";
import { Toasts } from "../../ui/Toasts";
import { createCtx, type TestCtx } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// F1 toasts: the region, max 3, the file in mono, pause on hover and focus
// ─────────────────────────────────────────────────────────────────────────────

let ctx: TestCtx;
let root: HTMLElement;

beforeEach(() => {
  vi.useFakeTimers();
  ctx = createCtx();
  root = document.createElement("div");
  document.body.append(root);
  act(() => {
    render(h(Toasts, { ctx }), root);
  });
});

afterEach(() => {
  act(() => {
    render(undefined, root);
  });
  root.remove();
  vi.useRealTimers();
});

/**
 * The toast elements.
 *
 * @returns The rows.
 */
function rows(): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("[data-toast]")];
}

describe("Toasts", () => {
  it("is a polite live region in the top layer", () => {
    const region = root.querySelector("[data-ui='toasts']");
    expect(region?.tagName).toBe("OUTPUT");
    expect(region?.getAttribute("aria-live")).toBe("polite");
    expect(region?.getAttribute("popover")).toBe("manual");
  });

  it("shows at most 3 toasts, the file in mono after a middle dot", () => {
    act(() => {
      for (const text of ["one", "two", "three", "four"]) showToast(ctx, text);
      showToast(ctx, "✓ Note saved", ".moku/notes/a.md");
    });
    expect(rows().map(row => row.textContent)).toEqual([
      "three",
      "four",
      "✓ Note saved · .moku/notes/a.md"
    ]);
    expect(rows()[2]?.querySelector("code")?.textContent).toBe(".moku/notes/a.md");
  });

  it("hover pauses a toast; leaving restarts its time", () => {
    act(() => showToast(ctx, "hover"));
    const row = rows()[0];
    act(() => {
      row?.dispatchEvent(new PointerEvent("pointerenter"));
    });
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(rows()).toHaveLength(1);
    act(() => {
      row?.dispatchEvent(new PointerEvent("pointerleave"));
    });
    act(() => {
      vi.advanceTimersByTime(2600);
    });
    expect(rows()).toHaveLength(0);
  });

  it("focus pauses a toast; blur restarts its time", () => {
    act(() => showToast(ctx, "focus"));
    const row = rows()[0];
    act(() => {
      row?.dispatchEvent(new FocusEvent("focus"));
    });
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(rows()).toHaveLength(1);
    act(() => {
      row?.dispatchEvent(new FocusEvent("blur"));
      vi.advanceTimersByTime(2600);
    });
    expect(rows()).toHaveLength(0);
  });
});
