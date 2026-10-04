// @vitest-environment happy-dom
import { h } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { updateSidePanel } from "../../../panels/shared/side-panel/store";
import type { Insets } from "../../../workspace/types";
import { FlowWorkspace, type FlowWorkspaceProps } from "../../panel";
import { followPreviewZone } from "../../preview-zone";
import { mount, prepared, settle } from "../render";

/** The Inspector's side panel id. */
const INSPECTOR = "flow.inspector";

/** The Flow workspace and its canvas of the 480 px window: 436 × 856 px right of the rail. */
const BOX = new DOMRect(44, 44, 436, 856);

/** The canvas chrome insets of that canvas with the S float bottom-right (camera.previewZone). */
const CHROME = { top: 56, bottom: 186 };

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  updateSidePanel(INSPECTOR, {
    width: undefined,
    collapsed: false,
    closed: false,
    overlay: false,
    drawer: false
  });
});

/** A fake workspace previewZone: records every zone, returns one remover spy. */
function fakeWorkspace() {
  const remove = vi.fn();
  const previewZone = vi.fn(
    (_ws: string, _element: HTMLElement, _insets: () => Insets): (() => void) => remove
  );
  /** The insets the newest zone reads now. */
  const insets = (): Insets | undefined => previewZone.mock.lastCall?.[2]();
  return { remove, previewZone, insets };
}

/** A Flow workspace element with its canvas, both laid out as BOX. */
function zoneElements(): { root: HTMLElement; canvas: HTMLElement } {
  const root = document.createElement("div");
  const canvas = document.createElement("div");
  root.append(canvas);
  document.body.append(root);
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue(BOX);
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(BOX);
  return { root, canvas };
}

describe("followPreviewZone", () => {
  it("keeps the zone clear of the open Inspector drawer, at the drawer's width", async () => {
    const { ctx, actions } = await prepared();
    const fake = fakeWorkspace();
    const elements = zoneElements();
    const stop = followPreviewZone(ctx, actions, fake, elements);

    expect(fake.previewZone).toHaveBeenCalledWith("flow", elements.canvas, expect.any(Function));
    expect(fake.insets()).toEqual(CHROME);

    // Below 600 px the Inspector opens as a drawer over the canvas: 320 px by default.
    updateSidePanel(INSPECTOR, { overlay: true, drawer: true });
    expect(fake.insets()).toEqual({ ...CHROME, right: 320 });

    // The Code and Styles tabs open it at 400 px; a drawer is never wider than 92 % of the view.
    ctx.state.inspector.tab = "code";
    expect(fake.insets()).toEqual({ ...CHROME, right: 400 });
    updateSidePanel(INSPECTOR, { width: 560 });
    expect(fake.insets()?.right).toBeCloseTo(436 * 0.92);

    // A shut drawer, a docked panel and a closed panel leave the canvas to the preview.
    updateSidePanel(INSPECTOR, { drawer: false });
    expect(fake.insets()).toEqual(CHROME);
    updateSidePanel(INSPECTOR, { overlay: false });
    expect(fake.insets()).toEqual(CHROME);
    updateSidePanel(INSPECTOR, { overlay: true, drawer: true, closed: true });
    expect(fake.insets()).toEqual(CHROME);
    stop();
  });

  it("registers the zone again on every change of the Inspector panel, until stopped", async () => {
    const { ctx, actions } = await prepared();
    const fake = fakeWorkspace();
    const stop = followPreviewZone(ctx, actions, fake, zoneElements());
    expect(fake.previewZone).toHaveBeenCalledTimes(1);

    // Open, resize, collapse and close: the preview is placed again at once each time.
    updateSidePanel(INSPECTOR, { overlay: true, drawer: true });
    updateSidePanel(INSPECTOR, { width: 300 });
    updateSidePanel(INSPECTOR, { drawer: false });
    updateSidePanel(INSPECTOR, { closed: true });
    expect(fake.previewZone).toHaveBeenCalledTimes(5);

    stop();
    expect(fake.remove).toHaveBeenCalledTimes(1);
    updateSidePanel(INSPECTOR, { closed: false });
    expect(fake.previewZone).toHaveBeenCalledTimes(5);
  });

  it("registers the zone again when the canvas resizes (a docked Inspector moving its edge)", async () => {
    const { ctx, actions } = await prepared();
    const observed: { element: Element; callback: () => void }[] = [];
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        readonly callback: () => void;
        constructor(callback: () => void) {
          this.callback = callback;
        }
        observe(element: Element): void {
          observed.push({ element, callback: this.callback });
        }
        disconnect(): void {
          disconnect();
        }
      }
    );
    const fake = fakeWorkspace();
    const elements = zoneElements();
    const stop = followPreviewZone(ctx, actions, fake, elements);

    expect(observed.map(entry => entry.element)).toEqual([elements.canvas]);
    observed[0]?.callback();
    expect(fake.previewZone).toHaveBeenCalledTimes(2);

    stop();
    expect(disconnect).toHaveBeenCalled();
  });
});

describe("the Flow workspace's preview zone", () => {
  it("is its canvas, clear of the open Inspector drawer, and follows the panel at once", async () => {
    const { ctx } = await prepared();
    const fake = fakeWorkspace();
    const tools = { workspace: fake } as unknown as FlowWorkspaceProps["tools"];
    const { host, unmount } = mount(h(FlowWorkspace, { ctx, tools }));
    await settle();
    const root = host.querySelector<HTMLElement>('[data-flow="workspace"]');
    const canvas = host.querySelector<HTMLElement>('[data-flow="canvas"]');
    if (root === null || canvas === null) throw new Error("no workspace or canvas");
    vi.spyOn(root, "getBoundingClientRect").mockReturnValue(BOX);
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(BOX);

    expect(fake.previewZone).toHaveBeenLastCalledWith("flow", canvas, expect.any(Function));
    const before = fake.previewZone.mock.calls.length;
    await settle(() => updateSidePanel(INSPECTOR, { overlay: true, drawer: true }));
    expect(fake.previewZone.mock.calls.length).toBeGreaterThan(before);
    expect(fake.insets()).toEqual({ ...CHROME, right: 320 });

    unmount();
    expect(fake.remove).toHaveBeenCalled();
  });
});
