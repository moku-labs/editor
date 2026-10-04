// @vitest-environment happy-dom
import { h } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { actionsOf } from "../../actions";
import { Minimap } from "../../camera/Minimap";
import { nodeKinds, outgoing, parentsOf, resolveStack } from "../../focus/graph";
import { InfoTab } from "../../inspector/InfoTab";
import { Inspector } from "../../inspector/Inspector";
import { Breadcrumb } from "../../render/Breadcrumb";
import { CanvasToolbar } from "../../render/CanvasToolbar";
import { ContextMenu } from "../../render/ContextMenu";
import { HistoryLabels } from "../../render/HistoryStrip";
import { YouAreHere } from "../../render/YouAreHere";
import type { GraphJson } from "../../types";
import { infoView } from "../../view-model";
import { createTestCtx } from "../ctx";
import { cloneGraph, entry, mergeGraph } from "../helpers";
import { mount, prepared, settle } from "../render";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("Inspector variants", () => {
  it("shows a hint when nothing is shown while live; ←/→ cycle the three tabs", async () => {
    const { ctx, actions } = await prepared();
    const empty = mount(h(Inspector, { ctx, actions, shown: undefined, info: undefined }));
    expect(empty.host.textContent).toContain("Select a node to inspect it.");
    empty.unmount();
    const info = infoView(ctx, actions, "main/settings");
    actions.focus.select("main/settings");
    const tabs = mount(h(Inspector, { ctx, actions, shown: "main/settings", info }));
    await settle(() =>
      tabs.host
        .querySelector<HTMLElement>('[role="tab"]')
        ?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }))
    );
    expect(ctx.state.inspector.tab).toBe("styles");
    await settle(() =>
      tabs.host
        .querySelector<HTMLElement>('[role="tab"]')
        ?.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true }))
    );
    await settle(() => tabs.host.querySelector<HTMLElement>('[role="tab"]')?.click());
    expect(ctx.state.inspector.tab).toBe("info");
    tabs.unmount();
  });
});

describe("Info tab variants", () => {
  it("shows waiting rows and frames of the current hub, resolved exits and the highlighted row", async () => {
    const { ctx, actions } = await prepared();
    ctx.state.data.history = [
      entry(1, "board/awaitIntent", "tap", { next: "board/tapGenerator", frame: 5 })
    ];
    actions.focus.select("board/awaitIntent");
    const hub = mount(
      h(InfoTab, { ctx, actions, info: infoView(ctx, actions, "board/awaitIntent") ?? never() })
    );
    expect(hub.host.querySelector('[data-part="outcomes"] [data-waiting]')).not.toBeNull();
    expect(hub.host.textContent).toContain("f5");
    hub.unmount();

    actions.focus.select("board/giveToOrder");
    actions.focus.highlight("from", 0);
    const give = mount(
      h(InfoTab, { ctx, actions, info: infoView(ctx, actions, "board/giveToOrder") ?? never() })
    );
    const exit = give.host.querySelector('[data-part="outcomes"] [data-outcome="orderComplete"]');
    expect(exit?.textContent).toContain("main/afterOrder");
    expect(give.host.querySelector('[data-part="comes-from"] li[data-highlight]')).not.toBeNull();
    give.unmount();
  });
});

/**
 * Fails the test: the value was expected to exist.
 *
 * @throws {Error} Always.
 */
function never(): never {
  throw new Error("expected a value");
}

describe("chrome variants", () => {
  it("hides You are here, the stack link and the minimap without data; Reset layout runs with pins", async () => {
    const { ctx } = createTestCtx();
    const bare = actionsOf(ctx);
    const yah = mount(h(YouAreHere, { ctx, actions: bare }));
    expect(yah.host.querySelector('[data-flow="you-are-here"]')).toBeNull();
    yah.unmount();
    const crumbs = mount(h(Breadcrumb, { ctx, actions: bare }));
    expect(crumbs.host.querySelector('[data-part="stack"]')).toBeNull();
    crumbs.unmount();
    const map = mount(h(Minimap, { ctx, actions: bare, trail: [] }));
    expect(map.host.querySelector("svg")).toBeNull();
    map.unmount();
    const flow = await prepared();
    flow.ctx.state.layout.pins.nodes["main/home"] = { x: 0, y: 0 };
    const reset = vi
      .spyOn(flow.actions.layout, "reset")
      .mockRejectedValueOnce(new Error("[moku-editor] x"));
    const bar = mount(h(CanvasToolbar, { ctx: flow.ctx, actions: flow.actions }));
    await settle(() => bar.host.querySelector<HTMLElement>('[data-action="reset"]')?.click());
    expect(reset).toHaveBeenCalled();
    expect(flow.ctx.log.warn).toHaveBeenCalled();
    bar.unmount();
  });

  it("labels the selected dot; the menu flips inside the canvas near its edges", async () => {
    const { ctx, actions } = await prepared();
    ctx.state.data.history = [entry(1, "home", "play"), entry(2, "board/merge", "done")];
    actions.focus.selectHistory(1);
    const rows = [
      {
        index: 2,
        label: "#2",
        path: "board/merge",
        outcome: "done",
        next: "x",
        payload: "null",
        trail: true,
        rejected: false
      },
      {
        index: 1,
        label: "#1",
        path: "home",
        outcome: "play",
        next: "y",
        payload: "null",
        trail: true,
        rejected: false
      }
    ];
    const labels = mount(h(HistoryLabels, { ctx, actions, rows }));
    expect(labels.host.querySelectorAll("[data-label]")).toHaveLength(2);
    labels.unmount();
    ctx.state.camera.viewport = { w: 400, h: 200 };
    actions.focus.openMenu({
      target: "canvas",
      key: undefined,
      outcome: undefined,
      x: 390,
      y: 190
    });
    const menu = mount(h(ContextMenu, { ctx, actions }));
    const element = menu.host.querySelector<HTMLElement>('[data-flow="context-menu"]');
    expect(element?.style.left).toBe(`${390 - 220}px`);
    expect(element?.style.top).toBe(`${190 - 60}px`);
    menu.unmount();
  });
});

describe("graph queries on other shapes", () => {
  it("handles barriers, slots without contributions, unknown flows and paths through slots", () => {
    const graph: GraphJson = cloneGraph();
    const toast = graph.flows.board?.nodes.toast;
    if (toast !== undefined) toast.barrier = true;
    expect(nodeKinds(graph, "board/toast")).toEqual(["transit", "barrier"]);
    graph.slots = {};
    expect(resolveStack(graph, "afterOrder/show").map(item => item.id)).toEqual([
      "main/afterOrder"
    ]);
    expect(parentsOf(mergeGraph, "nope")).toEqual([]);
    expect(outgoing(mergeGraph, "nope/x")).toEqual([]);
    expect(outgoing(mergeGraph, "board/giveToOrder", "main/home")[1]?.to).toBeUndefined();
  });
});
