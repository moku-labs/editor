// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHandlers } from "../../handlers";
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
    expect(card(host, "main/home").style.left).toBe(`${(item?.x ?? 0) + 60}px`);
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
