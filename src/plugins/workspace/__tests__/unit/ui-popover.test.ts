// @vitest-environment happy-dom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePopover } from "../../ui/popover";
import { useElement } from "../../ui/store";
import { createCtx, rectOf, stubRect, type TestCtx } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// usePopover: top layer show/hide and placement under the anchor (the Popover
// API is stubbed: happy-dom has none)
// ─────────────────────────────────────────────────────────────────────────────

let ctx: TestCtx;
let root: HTMLElement;
let open: Set<HTMLElement>;

beforeEach(() => {
  ctx = createCtx();
  root = document.createElement("div");
  document.body.append(root);
  ctx.state.dom.root = root;
  open = new Set();
  const prototype = HTMLElement.prototype;
  vi.spyOn(prototype, "matches").mockImplementation(function (this: HTMLElement, selector) {
    if (selector === ":popover-open") return open.has(this);
    return false;
  });
  Object.assign(prototype, {
    showPopover(this: HTMLElement) {
      open.add(this);
    },
    hidePopover(this: HTMLElement) {
      open.delete(this);
    }
  });
});

afterEach(() => {
  act(() => {
    render(undefined, root);
  });
  root.remove();
  vi.restoreAllMocks();
  Reflect.deleteProperty(HTMLElement.prototype, "showPopover");
  Reflect.deleteProperty(HTMLElement.prototype, "hidePopover");
});

/**
 * A component with an anchor and a popover driven by `show`.
 *
 * @param props - Whether the popover shows and its anchor.
 * @param props.show - Open flag.
 * @param props.anchor - Anchor name.
 * @returns The vnode.
 */
function Probe(props: { readonly show: boolean; readonly anchor?: string }) {
  const holder = useElement<HTMLElement>();
  usePopover(holder, props.show, ctx.state, props.anchor);
  return h("div", {}, [
    h("button", { "data-popover-anchor": "step", key: "a" }, "Step"),
    h("section", { popover: "manual", ref: holder.ref, key: "p", "data-probe": "" })
  ]);
}

/**
 * The probed popover.
 *
 * @returns The element.
 */
function popover(): HTMLElement {
  const element = root.querySelector<HTMLElement>("[data-probe]");
  if (element === null) throw new Error("no popover");
  return element;
}

describe("usePopover", () => {
  it("shows the popover in the top layer below its anchor and hides it again", () => {
    act(() => {
      render(h(Probe, { show: false, anchor: "step" }), root);
    });
    stubRect(root.querySelector("button") ?? root, rectOf(100, 8, 80, 28));
    expect(open.has(popover())).toBe(false);

    act(() => {
      render(h(Probe, { show: true, anchor: "step" }), root);
    });
    expect(open.has(popover())).toBe(true);
    expect(popover().style.top).toBe("42px");
    expect(popover().style.left).toBe("100px");

    act(() => {
      render(h(Probe, { show: true, anchor: "step" }), root);
    });
    expect(open.has(popover())).toBe(true);

    act(() => {
      render(h(Probe, { show: false, anchor: "step" }), root);
    });
    expect(open.has(popover())).toBe(false);
  });

  it("moves a popover left so it never runs off the window", () => {
    act(() => {
      render(h(Probe, { show: false, anchor: "step" }), root);
    });
    stubRect(root.querySelector("button") ?? root, rectOf(globalThis.innerWidth - 100, 8, 80, 28));
    stubRect(popover(), rectOf(0, 0, 400, 300));

    act(() => {
      render(h(Probe, { show: true, anchor: "step" }), root);
    });
    expect(popover().style.left).toBe(`${globalThis.innerWidth - 400 - 8}px`);
  });

  it("without an anchor keeps the CSS position", () => {
    act(() => {
      render(h(Probe, { show: true }), root);
    });
    expect(open.has(popover())).toBe(true);
    expect(popover().style.top).toBe("");
  });

  it("an unknown :popover-open reads as closed", () => {
    vi.mocked(HTMLElement.prototype.matches).mockImplementation(() => {
      throw new SyntaxError("unknown pseudo-class");
    });
    act(() => {
      render(h(Probe, { show: true, anchor: "missing" }), root);
    });
    expect(open.has(popover())).toBe(true);
  });
});
