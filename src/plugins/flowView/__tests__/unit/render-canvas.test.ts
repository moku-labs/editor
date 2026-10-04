// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHandlers } from "../../handlers";
import { createTestCtx, jumpCamera } from "../ctx";
import { mountWorkspace, pointer, prepared, settle } from "../render";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

/** The element of an item key in a host. */
function card(host: HTMLElement, key: string): HTMLElement {
  const element = host.querySelector<HTMLElement>(`[data-key="${key}"]`);
  if (element === null) throw new Error(`no element for ${key}`);
  return element;
}

describe("Canvas (A1)", () => {
  it("renders before the first flow values: the canvas and its chrome, no cards (the panel has no sources)", async () => {
    jumpCamera();
    vi.stubGlobal("ResizeObserver", undefined);
    const { ctx } = createTestCtx();
    const { host, unmount } = await mountWorkspace(ctx);
    expect(host.querySelector('[data-flow="canvas"]')).not.toBeNull();
    expect(host.querySelector('[data-flow="breadcrumb"]')).not.toBeNull();
    expect(host.querySelectorAll('[data-flow="node-card"]')).toHaveLength(0);
    expect(ctx.log.error).not.toHaveBeenCalled();
    unmount();
  });

  it("draws the world: frames, hub, lanes, cards, stubs, edges and the canvas chrome", async () => {
    const { ctx } = await prepared();
    const { host, unmount } = await mountWorkspace(ctx);
    const canvas = host.querySelector('[data-flow="canvas"]');
    expect(canvas?.getAttribute("role")).toBe("group");
    expect(canvas?.getAttribute("aria-label")).toBe("Flow graph");
    expect(host.querySelector('[data-flow="world"]')).not.toBeNull();
    expect(host.querySelectorAll('[data-flow="lane"]')).toHaveLength(8);
    expect(host.querySelector<HTMLElement>('[data-flow="hub"]')?.dataset.key).toBe(
      "main/board>board/awaitIntent"
    );
    expect(host.querySelectorAll('[data-flow="node-card"]').length).toBeGreaterThan(10);
    expect(host.querySelectorAll('[data-flow="stub"]').length).toBeGreaterThan(14);
    expect(host.querySelectorAll('[data-flow="frame"]')).toHaveLength(2);
    expect(host.querySelectorAll('[data-flow="edges"] path').length).toBeGreaterThan(10);
    for (const part of ["breadcrumb", "canvas-toolbar", "zoom-bar", "minimap", "history-strip"]) {
      expect(host.querySelector(`[data-flow="${part}"]`)).not.toBeNull();
    }
    expect(card(host, "main/board>board/awaitIntent").dataset.current).toBe("");
    unmount();
  });

  it("paints the edges and their labels before the items, so cards cover the edges (finding 12)", async () => {
    const { ctx } = await prepared();
    const { host, unmount } = await mountWorkspace(ctx);
    const children = [...host.querySelectorAll<HTMLElement>('[data-flow="world"] > *')];
    const order = (flow: string) => children.findIndex(child => child.dataset.flow === flow);
    const lastLabel = children.findLastIndex(child => child.dataset.flow === "edge-label");
    expect(order("edges")).toBeGreaterThan(order("frame"));
    expect(order("edges")).toBeGreaterThan(order("lane"));
    expect(lastLabel).toBeGreaterThan(order("edges"));
    for (const item of ["node", "hub", "stub", "port"]) {
      expect(order(item), item).toBeGreaterThan(lastLabel);
    }
    unmount();
  });

  it("the current node never fades; edges into and out of it stay; unrelated items dim (finding 12)", async () => {
    const { ctx, actions } = await prepared();
    const { host, unmount } = await mountWorkspace(ctx);
    await settle(() => actions.focus.select("main/home"));
    const hub = card(host, "main/board>board/awaitIntent");
    expect(hub.dataset.dimmed).toBeUndefined();
    expect(card(host, "main/boot").dataset.dimmed).toBe("");
    const { worldView } = await import("../../view-model");
    const world = worldView(ctx, actions);
    const tap = world?.edges.get("main/board>board/awaitIntent|tap|edge");
    expect(tap?.dimmed).toBe(false);
    const unrelated = world?.edges.get("main/board>board/merge|done|edge");
    expect(unrelated?.dimmed).toBe(true);
    unmount();
  });

  it("renders no world, minimap, You are here tag or history dots when the link is empty (M4)", async () => {
    const { ctx } = await prepared();
    const { host, unmount } = await mountWorkspace(ctx);
    await settle(() => createHandlers(ctx)["link:status"]({ status: { kind: "empty" } }));
    for (const part of ["world", "minimap", "you-are-here", "history-dot"]) {
      expect(host.querySelector(`[data-flow="${part}"]`)).toBeNull();
    }
    unmount();
  });

  it("a click on a card selects it; on a frame, a lane or empty canvas clears the selection (M2)", async () => {
    const { ctx } = await prepared();
    const { host, unmount } = await mountWorkspace(ctx);
    const merge = card(host, "main/board>board/merge");
    pointer(merge, "pointerdown", 10, 10);
    pointer(merge, "pointerup", 11, 10);
    expect(ctx.state.focus.selected).toBe("main/board>board/merge");
    await settle();
    expect(card(host, "main/board>board/merge").dataset.selected).toBe("");
    expect(card(host, "main/home").dataset.dimmed).toBe("");

    for (const target of [
      card(host, "main/board"),
      host.querySelector('[data-flow="lane"]'),
      host.querySelector('[data-flow="canvas"]')
    ]) {
      ctx.state.focus.selected = "main/board>board/merge";
      if (target === null) throw new Error("no target");
      pointer(target, "pointerdown", 100, 100);
      pointer(target, "pointerup", 101, 101);
      expect(ctx.state.focus.selected).toBeUndefined();
    }
    unmount();
  });

  it("a drag on empty canvas pans, a drag on a card drops it (snapped), Esc cancels a drag", async () => {
    const { ctx, actions } = await prepared();
    const drop = vi.spyOn(actions.layout, "drop");
    const { host, unmount } = await mountWorkspace(ctx);
    const canvas = host.querySelector('[data-flow="canvas"]');
    if (canvas === null) throw new Error("no canvas");
    const before = actions.camera.get();
    pointer(canvas, "pointerdown", 100, 100);
    pointer(canvas, "pointermove", 140, 90);
    pointer(canvas, "pointerup", 140, 90);
    expect(actions.camera.get().x).toBeCloseTo(before.x + 40, 6);
    expect(actions.camera.get().y).toBeCloseTo(before.y - 10, 6);

    const home = card(host, "main/home");
    const item = ctx.state.layout.result?.byKey["main/home"];
    const z = actions.camera.get().z;
    pointer(home, "pointerdown", 10, 10);
    pointer(home, "pointermove", 10 + 60 * z, 10 + 30 * z);
    await settle();
    expect(card(host, "main/home").parentElement?.style.left).toBe(`${(item?.x ?? 0) + 60}px`);
    pointer(home, "pointerup", 10 + 60 * z, 10 + 30 * z);
    expect(drop).toHaveBeenCalledWith("main/home", (item?.x ?? 0) + 60, (item?.y ?? 0) + 30);

    drop.mockClear();
    pointer(home, "pointerdown", 10, 10);
    pointer(home, "pointermove", 80, 80);
    await settle(() => {
      globalThis.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    pointer(home, "pointerup", 80, 80);
    expect(drop).not.toHaveBeenCalled();
    unmount();
  });

  it("double-click on a sub-flow card enters it; right-click opens a context menu", async () => {
    const { ctx, actions } = await prepared();
    const enter = vi.spyOn(actions.flows, "enter").mockImplementation(() => {});
    const { host, unmount } = await mountWorkspace(ctx);
    await settle(() => {
      card(host, "main/settings").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(enter).toHaveBeenCalledWith("main/settings");
    await settle(() => {
      card(host, "main/home").dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 30, clientY: 40 })
      );
    });
    expect(ctx.state.focus.menu).toMatchObject({ target: "node", key: "main/home" });
    await settle(() => {
      host
        .querySelector('[data-flow="canvas"]')
        ?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    });
    expect(ctx.state.focus.menu?.target).toBe("canvas");
    unmount();
  });

  it("does not re-render node cards on camera moves (100 ops, 0 card mutations)", async () => {
    const { ctx, actions } = await prepared();
    const { host, unmount } = await mountWorkspace(ctx);
    const world = host.querySelector('[data-flow="world"]');
    if (world === null) throw new Error("no world");
    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver(records => mutations.push(...records));
    observer.observe(world, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true
    });
    await settle(() => {
      for (let index = 0; index < 100; index += 1) actions.camera.panBy(1, 0);
    });
    observer.disconnect();
    expect(mutations.filter(record => record.target !== world)).toEqual([]);
    expect((world as HTMLElement).style.transform).toContain("translate(");
    unmount();
  });

  it("Tab onto a card outside the clipped canvas pans onto it; the selection stays", async () => {
    const { ctx, actions } = await prepared();
    const centreOn = vi.spyOn(actions.camera, "centreOn");
    const { host, unmount } = await mountWorkspace(ctx);
    const canvas = host.querySelector<HTMLElement>('[data-flow="canvas"]');
    if (canvas === null) throw new Error("no canvas");
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 400, 300));
    ctx.state.camera.cam = { x: -100, y: 20, z: 2 };
    const selected = ctx.state.focus.selected;

    /** Places an element at a client rect and focuses it from the keyboard. */
    const focusAt = async (element: HTMLElement, rect: DOMRect): Promise<void> => {
      vi.spyOn(element, "getBoundingClientRect").mockReturnValue(rect);
      await settle(() => {
        globalThis.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", code: "Tab" }));
        element.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      });
    };

    // Off the right edge: the camera centres the card, the selection is untouched.
    await focusAt(card(host, "main/home"), new DOMRect(500, 100, 172, 46));
    expect(centreOn).toHaveBeenCalledTimes(1);
    expect(centreOn).toHaveBeenCalledWith((586 + 100) / 2, (123 - 20) / 2, true);
    expect(ctx.state.focus.selected).toBe(selected);

    // The hub counts too; a card fully inside does not move the camera.
    await focusAt(card(host, "main/board>board/awaitIntent"), new DOMRect(-300, 40, 200, 200));
    expect(centreOn).toHaveBeenCalledTimes(2);
    await focusAt(card(host, "main/settings"), new DOMRect(20, 20, 172, 46));
    expect(centreOn).toHaveBeenCalledTimes(2);
    unmount();
  });

  it("a focus that comes from a press in the canvas never moves the camera", async () => {
    const { ctx, actions } = await prepared();
    const centreOn = vi.spyOn(actions.camera, "centreOn");
    const { host, unmount } = await mountWorkspace(ctx);
    const canvas = host.querySelector<HTMLElement>('[data-flow="canvas"]');
    if (canvas === null) throw new Error("no canvas");
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 400, 300));
    const home = card(host, "main/home");
    vi.spyOn(home, "getBoundingClientRect").mockReturnValue(new DOMRect(350, 100, 172, 46));
    pointer(home, "pointerdown", 360, 110);
    await settle(() => {
      home.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
    pointer(home, "pointerup", 360, 110);
    expect(centreOn).not.toHaveBeenCalled();
    unmount();
  });

  it("marks the data areas stale with the link silent (M13)", async () => {
    const { ctx } = await prepared();
    const { host, unmount } = await mountWorkspace(ctx);
    await settle(() =>
      createHandlers(ctx)["link:status"]({ status: { kind: "silent", since: 1, lastFrame: 1840 } })
    );
    expect(host.querySelector('[data-flow="world"]')?.hasAttribute("data-stale")).toBe(true);
    expect(host.querySelector('[data-flow="inspector"]')?.hasAttribute("data-stale")).toBe(true);
    unmount();
  });
});
