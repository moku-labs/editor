// @vitest-environment happy-dom
import { h } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Minimap } from "../../camera/Minimap";
import { ZoomBar } from "../../camera/ZoomBar";
import { Breadcrumb } from "../../render/Breadcrumb";
import { CanvasToolbar } from "../../render/CanvasToolbar";
import { Offscreen, offscreenSpot } from "../../render/Offscreen";
import { YouAreHere, youAreHereTag } from "../../render/YouAreHere";
import { trailEdges, worldView } from "../../view-model";
import { entry, item } from "../helpers";
import { mount, pointer, prepared, settle } from "../render";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("Breadcrumb (B8, M1)", () => {
  it("every segment navigates up; the stack link selects the current node", async () => {
    const { ctx, actions } = await prepared();
    ctx.state.layout.enter.push({ flow: "board", via: "main/board" });
    const up = vi.spyOn(actions.flows, "up");
    const { host, unmount } = mount(h(Breadcrumb, { ctx, actions }));
    const segments = host.querySelectorAll<HTMLButtonElement>('[data-part="segment"]');
    expect([...segments].map(segment => segment.textContent)).toEqual(["main", "board"]);
    expect(segments[1]?.hasAttribute("data-current")).toBe(true);
    await settle(() => segments[0]?.click());
    expect(up).toHaveBeenCalledWith(0);
    await settle(() => segments[1]?.click());
    expect(up).toHaveBeenCalledWith(1);
    const stack = host.querySelector<HTMLElement>('[data-part="stack"]');
    expect(stack?.textContent).toContain("main/board › board/awaitIntent");
    await settle(() => stack?.click());
    expect(ctx.state.focus.selected).toBe("main/board>board/awaitIntent");
    unmount();
  });

  it("ends with the current node chip; a click shows where the game is (finding 16)", async () => {
    const { ctx, actions } = await prepared();
    const focusItem = vi.spyOn(actions.camera, "focusItem");
    const { host, unmount } = mount(h(Breadcrumb, { ctx, actions }));
    const chip = host.querySelector<HTMLElement>('[data-flow="breadcrumb"] > :last-child');
    expect(chip?.dataset.part).toBe("current");
    expect(chip?.dataset.action).toBe("find-current");
    expect(chip?.textContent).toBe("awaitIntent");
    await settle(() => chip?.click());
    expect(focusItem).toHaveBeenCalledWith(
      expect.objectContaining({ key: "main/board>board/awaitIntent" })
    );
    expect(ctx.state.focus.pulse).toBe("main/board>board/awaitIntent");
    expect(ctx.state.focus.selected).toBeUndefined();
    unmount();
  });
});

describe("CanvasToolbar (B5, M8, M9)", () => {
  it("Find current pulses the current node, Follow toggles with aria-pressed, Reset layout is disabled without pins", async () => {
    const { ctx, actions } = await prepared();
    const reset = vi.spyOn(actions.layout, "reset");
    const { host, unmount } = mount(h(CanvasToolbar, { ctx, actions }));
    const button = (name: string) =>
      host.querySelector<HTMLButtonElement>(`[data-action="${name}"]`);
    expect(button("note")).toBeNull();
    expect(button("reset")?.getAttribute("aria-disabled")).toBe("true");
    await settle(() => button("reset")?.click());
    expect(reset).not.toHaveBeenCalled();
    await settle(() => button("follow")?.click());
    expect(ctx.state.camera.follow).toBe(true);
    expect(button("follow")?.getAttribute("aria-pressed")).toBe("true");
    expect(button("find-current")?.title).toBe("Show where the game is (C)");
    await settle(() => button("find-current")?.click());
    expect(ctx.state.focus.pulse).toBe("main/board>board/awaitIntent");
    ctx.state.layout.pins.nodes["main/home"] = { x: 0, y: 0 };
    await settle(() => actions.focus.history(false));
    expect(button("reset")?.getAttribute("aria-disabled")).toBe("false");
    unmount();
  });

  it("offers Inspector while the Inspector panel is closed; a click shows it", async () => {
    const { ctx, actions } = await prepared();
    const { sidePanelState, updateSidePanel } = await import(
      "../../../panels/shared/side-panel/store"
    );
    updateSidePanel("flow.inspector", { closed: false });
    const { host, unmount } = mount(h(CanvasToolbar, { ctx, actions }));
    const reopen = () => host.querySelector<HTMLElement>('[data-action="reopen-flow.inspector"]');
    expect(reopen()).toBeNull();
    await settle(() => updateSidePanel("flow.inspector", { closed: true }));
    expect(reopen()?.textContent).toBe("Inspector");
    await settle(() => reopen()?.click());
    expect(sidePanelState("flow.inspector").closed).toBe(false);
    expect(reopen()).toBeNull();
    unmount();
  });
});

describe("ZoomBar (B6) and Minimap (B7)", () => {
  it("zoom bar: −/+ zoom, readout click = 100 %, fits; stays put with a selection", async () => {
    const { ctx, actions } = await prepared();
    ctx.state.camera.cam = { x: 0, y: 0, z: 1 };
    const { host, unmount } = mount(h(ZoomBar, { ctx, actions }));
    const button = (name: string) =>
      host.querySelector<HTMLButtonElement>(`[data-action="${name}"]`);
    await settle(() => button("zoom-in")?.click());
    expect(actions.camera.get().z).toBeCloseTo(1.25, 6);
    expect(button("readout")?.textContent).toBe("125 %");
    await settle(() => button("readout")?.click());
    expect(actions.camera.get().z).toBeCloseTo(1, 6);
    await settle(() => button("zoom-out")?.click());
    expect(actions.camera.get().z).toBeCloseTo(0.8, 6);
    await settle(() => button("fit-all")?.click());
    await settle(() => button("fit-selection")?.click());
    await settle(() => actions.focus.select("main/home"));
    expect(host.querySelector('[data-flow="zoom-bar"]')?.hasAttribute("data-lift")).toBe(false);
    unmount();
  });

  it("minimap: one rect per item, the current in accent, a click centres the camera there", async () => {
    const { ctx, actions } = await prepared();
    const { host, unmount } = mount(h(Minimap, { ctx, actions, trail: [] }));
    const map = host.querySelector<SVGSVGElement>('[data-flow="minimap"] svg');
    expect(host.querySelectorAll("[data-minimap-item]").length).toBeGreaterThan(20);
    expect(host.querySelector("[data-minimap-item][data-current]")).not.toBeNull();
    expect(host.querySelector("[data-part='viewport']")).not.toBeNull();
    expect(host.textContent).toContain("main");
    const centre = vi.spyOn(actions.camera, "centreOn");
    if (map === null) throw new Error("no minimap");
    pointer(map, "pointerdown", 0, 0);
    pointer(map, "pointerup", 0, 0);
    expect(centre).toHaveBeenCalledWith(0, -231.712, true);
    pointer(map, "pointerdown", 0, 0);
    pointer(map, "pointermove", 10, 10);
    expect(centre).toHaveBeenLastCalledWith(144.82, -86.892, false);
    pointer(map, "pointerup", 10, 10);
    unmount();
  });
});

describe("minimap marks (finding 16)", () => {
  it("draws a filled dot on the current node and the trail as accent lines", async () => {
    const { ctx, actions } = await prepared();
    ctx.state.data.history = [
      entry(1, "board/awaitIntent", "merge", { next: "board/merge" }),
      entry(2, "board/merge", "done", { next: "board/awaitIntent" })
    ];
    const trail = trailEdges(worldView(ctx, actions));
    expect(trail.map(edge => edge.key)).toEqual([
      "main/board>board/merge:done",
      "main/board>board/awaitIntent:merge"
    ]);
    const { host, unmount } = mount(h(Minimap, { ctx, actions, trail }));
    expect(host.querySelectorAll('[data-part="trail"]')).toHaveLength(2);
    const dot = host.querySelector<SVGCircleElement>('circle[data-part="current"]');
    const hub = host.querySelector<SVGRectElement>("[data-minimap-item][data-current]");
    const centre = (rect: SVGRectElement | null, name: "x" | "y", size: "width" | "height") =>
      Number(rect?.getAttribute(name)) + Number(rect?.getAttribute(size)) / 2;
    expect(Number(dot?.getAttribute("cx"))).toBeCloseTo(centre(hub, "x", "width"), 6);
    expect(Number(dot?.getAttribute("cy"))).toBeCloseTo(centre(hub, "y", "height"), 6);
    unmount();
    expect(trailEdges(undefined)).toEqual([]);
  });
});

describe("off-screen chevron (finding 16)", () => {
  const view = { w: 1200, h: 800 };
  const insets = { top: 0, right: 0, bottom: 0, left: 0 };
  const node = { x: 5000, y: 300, w: 172, h: 44 };

  it("sits on the edge towards an off-screen item and turns to point at it; none while any part shows", () => {
    const right = offscreenSpot(node, { x: 0, y: 0, z: 1 }, view, insets);
    expect(right?.x).toBeCloseTo(1178, 6);
    expect(right?.angle).toBeCloseTo((Math.atan2(-78, 4486) * 180) / Math.PI, 6);
    const above = offscreenSpot(node, { x: -4500, y: -2000, z: 1 }, view, insets);
    expect(above?.y).toBeCloseTo(22, 6);
    expect(above?.angle).toBeLessThan(-45);
    expect(offscreenSpot(node, { x: -4900, y: 0, z: 1 }, view, insets)).toBeUndefined();
    expect(offscreenSpot(node, { x: 0, y: 0, z: 1 }, { w: 30, h: 800 }, insets)).toBeUndefined();
    const inset = offscreenSpot(node, { x: 0, y: 0, z: 1 }, view, { ...insets, right: 224 });
    expect(inset?.x).toBeCloseTo(1200 - 224 - 22, 6);
  });

  it("renders the chevron while the current node is off-screen; a click shows where the game is", async () => {
    const { ctx, actions } = await prepared();
    const spot = actions.focus.locateCurrent();
    if (spot === undefined) throw new Error("no current node");
    actions.camera.focusItem(spot.item);
    const { host, unmount } = mount(h(Offscreen, { ctx, actions }));
    expect(host.querySelector('[data-flow="offscreen"]')).toBeNull();
    await settle(() => actions.camera.panBy(-20_000, 0));
    const chevron = host.querySelector<HTMLElement>('[data-flow="offscreen"]');
    expect(chevron?.title).toBe("Show where the game is (C)");
    expect(chevron?.style.getPropertyValue("--flow-offscreen-angle")).toMatch(/deg$/);
    const focusItem = vi.spyOn(actions.camera, "focusItem");
    await settle(() => chevron?.click());
    expect(focusItem).toHaveBeenCalled();
    expect(ctx.state.focus.pulse).toBe("main/board>board/awaitIntent");
    unmount();
  });
});

describe("You are here (F7)", () => {
  const view = { w: 1000, h: 800 };
  const insets = { top: 0, right: 0, bottom: 0, left: 0 };

  it("shows the tag when the current item is off-screen, at the edge, under 55 % or inside a collapsed parent", () => {
    const current = item({ key: "c", id: "board/awaitIntent", x: 100, y: 100 });
    expect(youAreHereTag(current, undefined, { x: 0, y: 0, z: 1 }, view, insets).show).toBe(false);
    expect(youAreHereTag(current, undefined, { x: -2000, y: 0, z: 1 }, view, insets).show).toBe(
      true
    );
    expect(youAreHereTag(current, undefined, { x: -95, y: 0, z: 1 }, view, insets).show).toBe(true);
    expect(youAreHereTag(current, undefined, { x: 0, y: 0, z: 0.5 }, view, insets).show).toBe(true);
    const inside = youAreHereTag(current, "main/board", { x: 0, y: 0, z: 1 }, view, insets);
    expect(inside.show).toBe(true);
    expect(inside.label).toBe("board/awaitIntent (inside main/board)");
    const far = youAreHereTag(current, undefined, { x: -5000, y: -5000, z: 1 }, view, insets);
    expect(far.x).toBeGreaterThanOrEqual(0);
    expect(far.y).toBeGreaterThanOrEqual(0);
  });

  it("a click on the tag selects the current node", async () => {
    const { ctx, actions } = await prepared();
    ctx.state.camera.cam = { x: 0, y: 0, z: 0.3 };
    const { host, unmount } = mount(h(YouAreHere, { ctx, actions }));
    const tag = host.querySelector<HTMLElement>('[data-flow="you-are-here"]');
    expect(tag?.textContent).toContain("board/awaitIntent");
    await settle(() => tag?.click());
    expect(ctx.state.focus.selected).toBe("main/board>board/awaitIntent");
    unmount();
  });
});
