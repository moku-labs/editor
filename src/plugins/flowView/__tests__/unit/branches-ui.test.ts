// @vitest-environment happy-dom
import { h } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { actionsOf } from "../../actions";
import { Minimap } from "../../camera/Minimap";
import { nodeKinds, outgoing, parentsOf, resolveStack } from "../../focus/graph";
import { NeighboursStrip } from "../../focus/NeighboursStrip";
import { Inspector } from "../../inspector/Inspector";
import { Breadcrumb } from "../../render/Breadcrumb";
import { CanvasToolbar } from "../../render/CanvasToolbar";
import { ContextMenu } from "../../render/ContextMenu";
import { HistoryLabels } from "../../render/HistoryStrip";
import { YouAreHere } from "../../render/YouAreHere";
import type { GraphJson } from "../../types";
import { infoView } from "../../view-model";
import { createTestCtx, flush } from "../ctx";
import { cloneGraph, entry, mergeGraph } from "../helpers";
import { mount, prepared, settle } from "../render";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("Inspector variants", () => {
  it("shows a selected note, and a hint when nothing is shown while live", async () => {
    const { ctx, actions, fakes } = await prepared();
    fakes.files.store.set(".moku/notes/a.md", {
      text: "---\ntitle: The note\n---\nBody\n",
      version: "v1"
    });
    await actions.notes.load();
    await flush(10);
    actions.focus.select("note:.moku/notes/a.md");
    const note = mount(h(Inspector, { ctx, actions, shown: undefined, info: undefined }));
    expect(note.host.textContent).toContain("Note · idea for the agent");
    expect(note.host.textContent).toContain("The note");
    await settle(() => note.host.querySelector<HTMLElement>('[data-action="clear"]')?.click());
    expect(ctx.state.focus.selected).toBeUndefined();
    note.unmount();
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
    expect(ctx.state.inspector.tab).toBe("notes");
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

describe("NeighboursStrip variants", () => {
  it("shows waiting rows and frames of the current hub; exit rows walk nowhere; closes for a stub", async () => {
    const { ctx, actions } = await prepared();
    ctx.state.data.history = [
      entry(1, "board/awaitIntent", "tap", { next: "board/tapGenerator", frame: 5 })
    ];
    actions.focus.select("board/awaitIntent");
    const { host, unmount } = mount(h(NeighboursStrip, { ctx, actions }));
    expect(host.textContent).toContain("You are here");
    expect(host.querySelector('[data-column="to"] [data-waiting]')).not.toBeNull();
    expect(host.textContent).toContain("f5");
    const leave = host.querySelector<HTMLElement>('[data-column="to"] [data-outcome="leave"]');
    await settle(() => leave?.click());
    await settle(() => actions.focus.select("board/giveToOrder"));
    const exit = host.querySelector<HTMLElement>(
      '[data-column="to"] [data-outcome="orderComplete"]'
    );
    expect(exit?.textContent).toContain("main/afterOrder");
    await settle(() => actions.focus.highlight("from", 0));
    expect(host.querySelector('[data-column="from"] [data-highlight]')).not.toBeNull();
    await settle(() => actions.focus.select("main/board>stub:board/merge:done"));
    expect(host.querySelector('[data-flow="neighbours-strip"]')).toBeNull();
    unmount();
  });
});

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
    const map = mount(h(Minimap, { ctx, actions: bare }));
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
    expect(element?.style.top).toBe(`${190 - 90}px`);
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

describe("note node variants", () => {
  it("says '1 capture', shows the pinned mark and the selected state", async () => {
    const { NoteNode } = await import("../../render/NoteNode");
    const note = {
      key: "note:a.md",
      id: ".moku/notes/a.md",
      kind: "note" as const,
      x: 0,
      y: 0,
      w: 236,
      h: 112,
      flow: "main",
      pinned: true
    };
    const { host, unmount } = mount(
      h(NoteNode, {
        item: note,
        view: { title: "A", lines: [], captures: 1, status: "todo" },
        selected: true
      })
    );
    const element = host.querySelector<HTMLElement>('[data-flow="note-node"]');
    expect(element?.textContent).toContain("1 capture");
    expect(element?.dataset.pinned).toBe("");
    expect(element?.dataset.selected).toBe("");
    expect(element?.querySelector('[data-part="pin"]')).not.toBeNull();
    unmount();
  });
});
