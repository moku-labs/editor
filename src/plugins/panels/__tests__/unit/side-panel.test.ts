// @vitest-environment happy-dom
import type { ComponentChildren } from "preact";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SidePanelProps } from "../../shared/side-panel";
import { SidePanel, sidePanelState, toggleSidePanel, useSidePanel } from "../../shared/side-panel";

// ─────────────────────────────────────────────────────────────────────────────
// SidePanel (finding 2, D-29): resize handle (pointer, keys, double-click),
// collapse rail, close + reopen through useSidePanel, overlay below the
// threshold measured on the parent container, controlled open.
// ─────────────────────────────────────────────────────────────────────────────

/** The ResizeObserver callbacks of the mounted panels. */
let observers: (() => void)[] = [];

/** A ResizeObserver stub that the tests trigger by hand. */
class StubObserver {
  readonly callback: () => void;

  constructor(callback: () => void) {
    this.callback = callback;
    observers.push(callback);
  }

  observe(): void {}

  disconnect(): void {
    observers = observers.filter(entry => entry !== this.callback);
  }
}

let container: HTMLElement;
let containerWidth = 1200;
let nextId = 0;

/** A fresh panel id per test: the store is shared by the whole file. */
function freshId(): string {
  nextId += 1;
  return `test.panel${nextId}`;
}

beforeEach(() => {
  localStorage.clear();
  observers = [];
  containerWidth = 1200;
  vi.stubGlobal("ResizeObserver", StubObserver);
  container = document.createElement("div");
  container.getBoundingClientRect = () => ({ width: containerWidth }) as DOMRect;
  document.body.append(container);
});

afterEach(() => {
  act(() => {
    render(undefined, container);
  });
  container.remove();
  vi.unstubAllGlobals();
});

/** Props of a panel with the spec's numbers. */
function props(id: string, extra: Partial<SidePanelProps> = {}): SidePanelProps {
  return {
    id,
    side: "end",
    title: "Inspector",
    defaultWidth: 320,
    minWidth: 220,
    maxWidth: 560,
    ...extra
  };
}

/** Mounts a tree into the container. */
function mount(tree: ComponentChildren): void {
  act(() => {
    render(h("div", { "data-test": "tree" }, tree), container);
  });
}

/** Mounts one panel whose parent is the measured container. */
function mountPanel(panelProps: SidePanelProps): void {
  act(() => {
    render(h(SidePanel, panelProps, h("p", { "data-test": "content" }, "content")), container);
  });
}

function panel(): HTMLElement | null {
  return container.querySelector<HTMLElement>("[data-side-panel]");
}

function part(selector: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(selector);
  if (element === null) throw new Error(`no ${selector}`);
  return element;
}

function click(selector: string): void {
  act(() => {
    part(selector).click();
  });
}

function key(target: Element, name: string): void {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true })
    );
  });
}

function pointer(target: Element, type: string, x: number): void {
  act(() => {
    target.dispatchEvent(
      new PointerEvent(type, {
        clientX: x,
        button: 0,
        pointerId: 1,
        bubbles: true,
        cancelable: true
      })
    );
  });
}

/** Resizes the measured container and runs the observers. */
function resizeContainer(width: number): void {
  containerWidth = width;
  act(() => {
    for (const callback of observers) callback();
  });
}

const HANDLE = "[data-part='handle']";

describe("SidePanel: docked and expanded", () => {
  it("renders the panel at its default width with a vertical separator on the inner edge", () => {
    const id = freshId();
    mountPanel(props(id));

    expect(panel()?.dataset.sidePanel).toBe(id);
    expect(panel()?.dataset.side).toBe("end");
    expect(panel()?.dataset.state).toBe("expanded");
    expect(panel()?.hasAttribute("data-overlay")).toBe(false);
    expect(panel()?.getAttribute("aria-label")).toBe("Inspector");
    expect(panel()?.style.getPropertyValue("--side-panel-w")).toBe("320px");
    const handle = part(HANDLE);
    expect(handle.getAttribute("role")).toBe("separator");
    expect(handle.getAttribute("aria-orientation")).toBe("vertical");
    expect(handle.getAttribute("aria-valuenow")).toBe("320");
    expect(handle.getAttribute("aria-valuemin")).toBe("220");
    expect(handle.getAttribute("aria-valuemax")).toBe("560");
    expect(handle.tabIndex).toBe(0);
    expect(part("[data-test='content']").textContent).toBe("content");
  });

  it("uses the stored width, clamped to [min, max]", () => {
    const id = freshId();
    localStorage.setItem(`moku-editor:panel:${id}`, JSON.stringify({ width: 1000 }));
    mountPanel(props(id));

    expect(part(HANDLE).getAttribute("aria-valuenow")).toBe("560");
  });
});

describe("SidePanel: resize", () => {
  it("steps 16 px with the arrow keys: left widens an end panel, right narrows it", () => {
    const id = freshId();
    mountPanel(props(id));

    key(part(HANDLE), "ArrowLeft");
    expect(part(HANDLE).getAttribute("aria-valuenow")).toBe("336");
    key(part(HANDLE), "ArrowRight");
    key(part(HANDLE), "ArrowRight");
    expect(part(HANDLE).getAttribute("aria-valuenow")).toBe("304");
    expect(sidePanelState(id).width).toBe(304);
  });

  it("mirrors the keys for a start panel and clamps at min and max", () => {
    const id = freshId();
    mountPanel(props(id, { side: "start", defaultWidth: 550 }));

    key(part(HANDLE), "ArrowRight");
    expect(part(HANDLE).getAttribute("aria-valuenow")).toBe("560");
    for (let step = 0; step < 30; step += 1) key(part(HANDLE), "ArrowLeft");
    expect(part(HANDLE).getAttribute("aria-valuenow")).toBe("220");
  });

  it("ignores other keys on the handle", () => {
    const id = freshId();
    mountPanel(props(id));

    key(part(HANDLE), "Enter");

    expect(part(HANDLE).getAttribute("aria-valuenow")).toBe("320");
    expect(sidePanelState(id).width).toBeUndefined();
  });

  it("follows a pointer drag, clamped, and stores the width on release", () => {
    const id = freshId();
    mountPanel(props(id));
    const handle = part(HANDLE);

    pointer(handle, "pointerdown", 800);
    pointer(handle, "pointermove", 740);
    expect(part(HANDLE).getAttribute("aria-valuenow")).toBe("380");
    expect(panel()?.hasAttribute("data-dragging")).toBe(true);
    expect(sidePanelState(id).width).toBeUndefined();

    pointer(handle, "pointermove", 100);
    expect(part(HANDLE).getAttribute("aria-valuenow")).toBe("560");
    pointer(handle, "pointerup", 100);

    expect(sidePanelState(id).width).toBe(560);
    expect(panel()?.hasAttribute("data-dragging")).toBe(false);
  });

  it("drags a start panel wider to the right; a move without a press does nothing", () => {
    const id = freshId();
    mountPanel(props(id, { side: "start" }));
    const handle = part(HANDLE);

    pointer(handle, "pointermove", 900);
    expect(part(HANDLE).getAttribute("aria-valuenow")).toBe("320");

    pointer(handle, "pointerdown", 300);
    pointer(handle, "pointermove", 350);
    pointer(handle, "pointercancel", 350);

    expect(sidePanelState(id).width).toBe(370);
  });

  it("goes back to the default width on double-click", () => {
    const id = freshId();
    mountPanel(props(id));
    key(part(HANDLE), "ArrowLeft");

    act(() => {
      part(HANDLE).dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });

    expect(part(HANDLE).getAttribute("aria-valuenow")).toBe("320");
    expect(sidePanelState(id).width).toBeUndefined();
  });
});

describe("SidePanel: collapse", () => {
  it("collapses to the rail with the title and an expand button, keeping the content mounted", () => {
    const id = freshId();
    mountPanel(props(id));
    expect(part("[data-action='collapse']").textContent).toBe("›");
    expect(part("[data-action='collapse']").title).toBe(String.raw`Collapse (\)`);

    click("[data-action='collapse']");

    expect(panel()?.dataset.state).toBe("collapsed");
    expect(container.querySelector(HANDLE)).toBeNull();
    expect(part("[data-part='rail-title']").textContent).toBe("Inspector");
    expect(part("[data-action='expand']").textContent).toBe("‹");
    expect(part("[data-test='content']").closest("[hidden]")).not.toBeNull();
    expect(sidePanelState(id).collapsed).toBe(true);

    click("[data-action='expand']");

    expect(panel()?.dataset.state).toBe("expanded");
    expect(part("[data-test='content']").closest("[hidden]")).toBeNull();
  });

  it("points the arrows the other way for a start panel", () => {
    mountPanel(props(freshId(), { side: "start" }));

    expect(part("[data-action='collapse']").textContent).toBe("‹");
    click("[data-action='collapse']");
    expect(part("[data-action='expand']").textContent).toBe("›");
  });

  it(String.raw`follows toggleSidePanel from outside (the view's \ key)`, () => {
    const id = freshId();
    mountPanel(props(id));

    act(() => toggleSidePanel(id));

    expect(panel()?.dataset.state).toBe("collapsed");
  });
});

/** A view toolbar with the reopen button of a panel. */
function Toolbar({ id }: { id: string }) {
  const handle = useSidePanel(id);
  if (handle.closed) {
    return h(
      "button",
      { type: "button", "data-action": `reopen-${id}`, onClick: handle.show },
      "Show"
    );
  }
  return h("span", { "data-test": "open" }, handle.expanded ? "expanded" : "collapsed");
}

describe("SidePanel: close and reopen", () => {
  it("hides on close; the view's reopen button from useSidePanel brings it back", () => {
    const id = freshId();
    mount([h(Toolbar, { id }), h(SidePanel, props(id), "content")]);
    expect(part("[data-test='open']").textContent).toBe("expanded");

    click("[data-action='close']");

    expect(panel()).toBeNull();
    expect(sidePanelState(id).closed).toBe(true);
    expect(localStorage.getItem(`moku-editor:panel:${id}`)).toContain('"closed":true');

    click(`[data-action='reopen-${id}']`);

    expect(panel()?.dataset.state).toBe("expanded");
    expect(sidePanelState(id).closed).toBe(false);
  });

  it("stays closed after a remount when it was closed", () => {
    const id = freshId();
    localStorage.setItem(`moku-editor:panel:${id}`, JSON.stringify({ closed: true }));

    mountPanel(props(id));

    expect(panel()).toBeNull();
  });

  it("lets a controlled panel's owner decide: open false renders nothing, close asks onOpenChange", () => {
    const id = freshId();
    const onOpenChange = vi.fn();
    mountPanel(props(id, { open: false, onOpenChange }));
    expect(panel()).toBeNull();

    mountPanel(props(id, { open: true, onOpenChange }));
    click("[data-action='close']");

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(panel()).not.toBeNull();
    expect(sidePanelState(id).closed).toBe(false);
  });

  it("tells onOpenChange of an uncontrolled panel too", () => {
    const onOpenChange = vi.fn();
    mountPanel(props(freshId(), { onOpenChange }));

    click("[data-action='close']");

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(panel()).toBeNull();
  });
});

describe("SidePanel: overlay below the threshold", () => {
  it("floats over the content and starts collapsed when the container is narrower", () => {
    const id = freshId();
    containerWidth = 500;
    mountPanel(props(id, { overlayBelow: 600 }));

    expect(panel()?.hasAttribute("data-overlay")).toBe(true);
    expect(panel()?.dataset.state).toBe("collapsed");

    click("[data-action='expand']");

    expect(panel()?.dataset.state).toBe("expanded");
    expect(panel()?.hasAttribute("data-overlay")).toBe(true);
    expect(sidePanelState(id).collapsed).toBe(false);
  });

  it("docks again when the container grows, and floats collapsed when it shrinks", () => {
    const id = freshId();
    mountPanel(props(id, { overlayBelow: 600 }));
    expect(panel()?.hasAttribute("data-overlay")).toBe(false);

    resizeContainer(480);
    expect(panel()?.hasAttribute("data-overlay")).toBe(true);
    expect(panel()?.dataset.state).toBe("collapsed");

    resizeContainer(900);
    expect(panel()?.hasAttribute("data-overlay")).toBe(false);
    expect(panel()?.dataset.state).toBe("expanded");
  });

  it("keeps the mode while the container is not laid out (width 0: a hidden workspace)", () => {
    const id = freshId();
    containerWidth = 0;
    mountPanel(props(id, { overlayBelow: 600 }));
    expect(panel()?.hasAttribute("data-overlay")).toBe(false);

    resizeContainer(500);
    resizeContainer(0);

    expect(panel()?.hasAttribute("data-overlay")).toBe(true);
  });

  it("never floats without overlayBelow, and measures once without ResizeObserver", () => {
    containerWidth = 300;
    mountPanel(props(freshId()));
    expect(panel()?.hasAttribute("data-overlay")).toBe(false);

    vi.stubGlobal("ResizeObserver", undefined);
    act(() => {
      render(undefined, container);
    });
    mountPanel(props(freshId(), { overlayBelow: 600 }));
    expect(panel()?.hasAttribute("data-overlay")).toBe(true);
  });

  it("toggles the drawer, not the docked choice, from outside in overlay mode", () => {
    const id = freshId();
    containerWidth = 500;
    mountPanel(props(id, { overlayBelow: 600 }));

    act(() => toggleSidePanel(id));

    expect(panel()?.dataset.state).toBe("expanded");
    expect(sidePanelState(id)).toMatchObject({ collapsed: false, drawer: true });
  });
});
