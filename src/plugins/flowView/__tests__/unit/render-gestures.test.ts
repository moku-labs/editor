// @vitest-environment happy-dom
/* eslint-disable unicorn/no-null -- null is a JSON value */
import { h } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Minimap } from "../../camera/Minimap";
import { ContextMenu, menuItems } from "../../render/ContextMenu";
import { Frame } from "../../render/Frame";
import { HistoryStrip } from "../../render/HistoryStrip";
import { item } from "../helpers";
import { mount, mountWorkspace, pointer, prepared, settle } from "../render";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("context menu items run", () => {
  it("node items focus, open code and styles, expand, enter, step, pause and resume", async () => {
    const { ctx, actions, fakes } = await prepared();
    const enter = vi.spyOn(actions.flows, "enter").mockImplementation(() => {});
    const expand = vi.spyOn(actions.flows, "expand").mockImplementation(() => {});
    const run = (key: string, label: string) =>
      menuItems(ctx, actions, { target: "node", key, outcome: undefined, x: 0, y: 0 })
        .find(entry => entry.label === label)
        ?.run();
    run("main/settings", "Focus");
    expect(ctx.state.focus.selected).toBe("main/settings");
    run("main/settings", "Open code");
    expect(ctx.state.inspector.tab).toBe("code");
    run("main/settings", "Open styles");
    expect(ctx.state.inspector.tab).toBe("styles");
    run("main/settings", "Expand");
    expect(expand).toHaveBeenCalledWith("main/settings");
    run("main/settings", "Enter settingsPopup");
    expect(enter).toHaveBeenCalledWith("main/settings");
    const collapse = menuItems(ctx, actions, {
      target: "node",
      key: "main/board",
      outcome: undefined,
      x: 0,
      y: 0
    });
    expect(collapse.map(entry => entry.label)).toContain("Collapse");
    run("main/board>board/awaitIntent", "Pause game");
    fakes.status = { kind: "paused", frame: 1 };
    run("main/board>board/awaitIntent", "Step 1 frame");
    run("main/board>board/awaitIntent", "Resume game");
    await settle();
    expect(fakes.run.mock.calls.map(call => call[0])).toEqual([
      "game.pause",
      "game.step",
      "game.resume"
    ]);
  });

  it("outcome and canvas items: focus the target, fit, reset", async () => {
    const { ctx, actions } = await prepared();
    menuItems(ctx, actions, {
      target: "outcome",
      key: "main/board>board/merge",
      outcome: "done",
      x: 0,
      y: 0
    })
      .find(entry => entry.label === "Focus awaitIntent")
      ?.run();
    expect(ctx.state.focus.selected).toBe("main/board>board/awaitIntent");
    const exit = menuItems(ctx, actions, {
      target: "outcome",
      key: "main/board>board/awaitIntent",
      outcome: "leave",
      x: 0,
      y: 0
    });
    exit.find(entry => entry.label === "Focus exit:left")?.run();
    const canvas = menuItems(ctx, actions, {
      target: "canvas",
      key: undefined,
      outcome: undefined,
      x: 50,
      y: 60
    });
    expect(canvas.map(entry => entry.label)).toEqual(["Fit all", "Reset layout"]);
    const fit = vi.spyOn(actions.camera, "fitAll");
    canvas.find(entry => entry.label === "Fit all")?.run();
    expect(fit).toHaveBeenCalled();
    ctx.state.layout.pins.nodes["main/home"] = { x: 0, y: 0 };
    const reset = vi
      .spyOn(actions.layout, "reset")
      .mockRejectedValueOnce(new Error("[moku-editor] x"));
    menuItems(ctx, actions, { target: "canvas", key: undefined, outcome: undefined, x: 0, y: 0 })
      .find(entry => entry.label === "Reset layout")
      ?.run();
    await settle();
    expect(reset).toHaveBeenCalled();
  });

  it("↑ wraps to the last item; a click runs an item; a disabled click does nothing", async () => {
    const { ctx, actions } = await prepared();
    actions.focus.openMenu({
      target: "canvas",
      key: undefined,
      outcome: undefined,
      x: 5000,
      y: 5000
    });
    const { host, unmount } = mount(h(ContextMenu, { ctx, actions }));
    const items = host.querySelectorAll<HTMLElement>('[role="menuitem"]');
    await settle(() =>
      items[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }))
    );
    expect(document.activeElement).toBe(items[1]);
    await settle(() => items[1]?.click());
    expect(ctx.state.focus.menu).toEqual({
      target: "canvas",
      key: undefined,
      outcome: undefined,
      x: 5000,
      y: 5000
    });
    await settle(() => items[0]?.click());
    expect(ctx.state.focus.menu).toBeUndefined();
    unmount();
  });
});

describe("canvas gestures", () => {
  it("opens outcome menus on stubs and edge labels, pans on wheel, pans with the middle button", async () => {
    const { ctx, actions } = await prepared();
    const { host, unmount } = await mountWorkspace(ctx);
    const stub = host.querySelector<HTMLElement>(
      '[data-flow="stub"][data-key="main/board>stub:board/merge:done"]'
    );
    await settle(() =>
      stub?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }))
    );
    expect(ctx.state.focus.menu).toMatchObject({
      target: "outcome",
      key: "main/board>board/merge",
      outcome: "done"
    });
    const label = host.querySelector<HTMLElement>('[data-flow="edge-label"]');
    await settle(() =>
      label?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }))
    );
    expect(ctx.state.focus.menu?.target).toBe("outcome");
    await settle(() => stub?.dispatchEvent(new PointerEvent("pointerover", { bubbles: true })));
    expect(host.querySelector('[data-flow="edges"] path[data-kind="return"]')).not.toBeNull();

    const canvas = host.querySelector<HTMLElement>('[data-flow="canvas"]');
    if (canvas === null) throw new Error("no canvas");
    const before = actions.camera.get();
    await settle(() =>
      canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: 30, bubbles: true, cancelable: true }))
    );
    expect(actions.camera.get().y).toBeCloseTo(before.y - 30, 6);
    const home = host.querySelector<HTMLElement>('[data-key="main/home"]');
    if (home === null) throw new Error("no card");
    const at = actions.camera.get();
    pointer(home, "pointerdown", 0, 0, { button: 1 });
    pointer(home, "pointermove", 20, 0);
    pointer(home, "pointerup", 20, 0);
    expect(actions.camera.get().x).toBeCloseTo(at.x + 20, 6);
    await settle(() => globalThis.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" })));
    pointer(home, "pointerdown", 0, 0);
    pointer(home, "pointermove", 0, 15);
    pointer(home, "pointerup", 0, 15);
    await settle(() => globalThis.dispatchEvent(new KeyboardEvent("keyup", { code: "Space" })));
    expect(actions.camera.get().y).toBeCloseTo(at.y + 15 - 0, 6);
    pointer(home, "pointerdown", 0, 0, { button: 2 });
    unmount();
  });

  it("drops a dragged card; ignores clicks inside the canvas chrome", async () => {
    const { ctx, actions } = await prepared();
    const drop = vi.spyOn(actions.layout, "drop").mockImplementation(() => {});
    const { host, unmount } = await mountWorkspace(ctx);
    const card = host.querySelector<HTMLElement>('[data-flow="node-card"][data-key="main/home"]');
    if (card === null) throw new Error("no card");
    pointer(card, "pointerdown", 0, 0);
    pointer(card, "pointermove", 30, 30);
    pointer(card, "pointerup", 30, 30);
    expect(drop).toHaveBeenCalledWith("main/home", expect.any(Number), expect.any(Number));
    ctx.state.focus.selected = "main/home";
    const zoom = host.querySelector<HTMLElement>('[data-action="zoom-in"]');
    if (zoom === null) throw new Error("no zoom bar");
    pointer(zoom, "pointerdown", 0, 0);
    pointer(zoom, "pointerup", 0, 0);
    await settle(() => zoom.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    await settle(() =>
      zoom.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }))
    );
    expect(ctx.state.focus.selected).toBe("main/home");
    unmount();
  });
});

describe("chrome pieces", () => {
  it("frame Enter, history row keyboard and dot hover, minimap drag", async () => {
    const { ctx, actions, fakes } = await prepared();
    ctx.state.view.files = fakes.files;
    const enter = vi.spyOn(actions.flows, "enter").mockImplementation(() => {});
    const frame = mount(
      h(Frame, {
        ctx,
        actions,
        item: item({ key: "main/board", kind: "frame" }),
        view: { head: "# board", onStack: false, root: false, dimmed: false, holdsCurrent: false }
      })
    );
    await settle(() => frame.host.querySelector<HTMLElement>('[data-action="enter"]')?.click());
    expect(enter).toHaveBeenCalledWith("main/board");
    frame.unmount();

    const rows = [
      {
        index: 4,
        label: "#4",
        path: "home",
        outcome: "play",
        next: "board/awaitIntent",
        payload: "null",
        trail: true,
        rejected: false
      }
    ];
    ctx.state.data.history = [
      {
        index: 4,
        path: "home",
        outcome: "play",
        payload: null,
        next: "board/awaitIntent",
        now: 1,
        hash: "a"
      }
    ];
    const strip = mount(h(HistoryStrip, { ctx, actions, rows }));
    const dot = strip.host.querySelector<HTMLElement>('[data-flow="history-dot"]');
    await settle(() => dot?.dispatchEvent(new PointerEvent("pointerenter")));
    expect(ctx.state.focus.historyHover).toBe(4);
    await settle(() => dot?.dispatchEvent(new PointerEvent("pointerleave")));
    expect(ctx.state.focus.historyHover).toBeUndefined();
    await settle(() => dot?.click());
    expect(ctx.state.focus.historySelected).toBe(4);
    await settle(() => actions.focus.history(true));
    const row = strip.host.querySelector<HTMLElement>('[data-flow="history-row"]');
    await settle(() =>
      row?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    );
    await settle(() =>
      row?.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true }))
    );
    expect(ctx.state.focus.edge).toBe("main/home:play");
    strip.unmount();

    const minimap = mount(h(Minimap, { ctx, actions, trail: [] }));
    const map = minimap.host.querySelector("svg");
    const centre = vi.spyOn(actions.camera, "centreOn");
    if (map === null) throw new Error("no map");
    pointer(map, "pointermove", 5, 5);
    expect(centre).not.toHaveBeenCalled();
    minimap.unmount();
  });
});
