// @vitest-environment happy-dom
import { h } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Minimap } from "../../camera/Minimap";
import { ZoomBar } from "../../camera/ZoomBar";
import { Breadcrumb } from "../../render/Breadcrumb";
import { CanvasToolbar } from "../../render/CanvasToolbar";
import { YouAreHere, youAreHereTag } from "../../render/YouAreHere";
import { item } from "../helpers";
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
    expect(ctx.state.focus.selected).toBeDefined();
    unmount();
  });
});

describe("CanvasToolbar (B5, M8, M9)", () => {
  it("Note opens the editor, Follow toggles with aria-pressed, Reset layout is disabled without pins", async () => {
    const { ctx, actions } = await prepared();
    const reset = vi.spyOn(actions.layout, "reset");
    const { host, unmount } = mount(h(CanvasToolbar, { ctx, actions }));
    const button = (name: string) =>
      host.querySelector<HTMLButtonElement>(`[data-action="${name}"]`);
    expect(button("reset")?.getAttribute("aria-disabled")).toBe("true");
    await settle(() => button("reset")?.click());
    expect(reset).not.toHaveBeenCalled();
    await settle(() => button("follow")?.click());
    expect(ctx.state.camera.follow).toBe(true);
    expect(button("follow")?.getAttribute("aria-pressed")).toBe("true");
    await settle(() => button("note")?.click());
    expect(ctx.state.notes.editor?.anchor).toBeDefined();
    ctx.state.layout.pins.nodes["main/home"] = { x: 0, y: 0 };
    await settle(() => actions.focus.history(false));
    expect(button("reset")?.getAttribute("aria-disabled")).toBe("false");
    unmount();
  });
});

describe("ZoomBar (B6) and Minimap (B7)", () => {
  it("zoom bar: −/+ zoom, readout click = 100 %, fits; lifts with the strip", async () => {
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
    expect(host.querySelector('[data-flow="zoom-bar"]')?.hasAttribute("data-lift")).toBe(false);
    await settle(() => actions.focus.select("main/home"));
    expect(host.querySelector('[data-flow="zoom-bar"]')?.hasAttribute("data-lift")).toBe(true);
    unmount();
  });

  it("minimap: one rect per item, the current in accent, a click centres the camera there", async () => {
    const { ctx, actions } = await prepared();
    const { host, unmount } = mount(h(Minimap, { ctx, actions }));
    const map = host.querySelector<SVGSVGElement>('[data-flow="minimap"] svg');
    expect(host.querySelectorAll("[data-minimap-item]").length).toBeGreaterThan(20);
    expect(host.querySelector("[data-minimap-item][data-current]")).not.toBeNull();
    expect(host.querySelector("[data-part='viewport']")).not.toBeNull();
    expect(host.textContent).toContain("main");
    const centre = vi.spyOn(actions.camera, "centreOn");
    if (map === null) throw new Error("no minimap");
    pointer(map, "pointerdown", 0, 0);
    pointer(map, "pointerup", 0, 0);
    expect(centre).toHaveBeenCalledWith(expect.any(Number), expect.any(Number), true);
    pointer(map, "pointerdown", 0, 0);
    pointer(map, "pointermove", 10, 10);
    expect(centre).toHaveBeenLastCalledWith(expect.any(Number), expect.any(Number), false);
    pointer(map, "pointerup", 10, 10);
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
