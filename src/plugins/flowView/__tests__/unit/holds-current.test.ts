// @vitest-environment happy-dom
import { h } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Frame } from "../../render/Frame";
import { Hub } from "../../render/Hub";
import { NodeCard } from "../../render/NodeCard";
import type { CardView } from "../../render/types";
import type { FlowActions, FlowCtx, ItemKey } from "../../types";
import { worldView } from "../../view-model";
import { flush } from "../ctx";
import { entry, item } from "../helpers";
import { mount, prepared, settle } from "../render";

// ─────────────────────────────────────────────────────────────────────────────
// Finding 7 (round 2, R5): an item holding the current node — the current node
// itself, a collapsed sub-flow, hub or frame with it inside, or an item on the
// position stack — is never dimmed, wears the accent ring and a "here" marker,
// and the trail edge into it is highlighted.
// ─────────────────────────────────────────────────────────────────────────────

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

/** The world view, failing the test without one. */
function world(ctx: FlowCtx, actions: FlowActions) {
  const view = worldView(ctx, actions);
  if (view === undefined) throw new Error("no world");
  return view;
}

/**
 * The actions with the current spot and the stack replaced: the canvas draws the current node as
 * `key` (or nowhere) and the stack names `stack`.
 */
function currentAt(
  actions: FlowActions,
  key: ItemKey | undefined,
  stack: readonly string[] = []
): FlowActions {
  const spot = key === undefined ? undefined : { item: item({ key }), inside: undefined };
  const entries = stack.map(id => ({
    flow: id.slice(0, id.indexOf("/")),
    node: id.slice(id.indexOf("/") + 1),
    id
  }));
  return {
    ...actions,
    focus: { ...actions.focus, locateCurrent: () => spot, stack: () => entries }
  };
}

/** The merge graph with board collapsed, a trail home → board and boot selected. */
async function collapsedBoard() {
  const test = await prepared();
  test.ctx.state.data.history = [entry(1, "home", "play", { next: "board/awaitIntent" })];
  test.actions.flows.collapse("main/board");
  await flush(10);
  test.ctx.state.focus.selected = "main/boot";
  return test;
}

describe("view data: items holding the current node (finding 7)", () => {
  it("a collapsed sub-flow on the position stack is never dimmed and holds the current node", async () => {
    const { ctx, actions } = await collapsedBoard();
    const view = world(ctx, currentAt(actions, undefined, ["main/board", "board/awaitIntent"]));
    expect(view.cards.get("main/board")).toMatchObject({
      holdsCurrent: true,
      current: false,
      dimmed: false
    });
  });

  it("a collapsed sub-flow whose key prefixes the current key holds it; a node outside is not exempted", async () => {
    const { ctx, actions } = await collapsedBoard();
    const view = world(ctx, currentAt(actions, "main/board>board/awaitIntent"));
    expect(view.cards.get("main/board")).toMatchObject({ holdsCurrent: true, dimmed: false });
    expect(view.cards.get("main/home")).toMatchObject({ holdsCurrent: false, dimmed: true });
    expect(view.cards.get("main/settings")).toMatchObject({ holdsCurrent: false, dimmed: true });
  });

  it("highlights the trail edge into the holding item and keeps it from fading", async () => {
    const { ctx, actions } = await collapsedBoard();
    const view = world(ctx, currentAt(actions, "main/board>board/awaitIntent"));
    const play = view.edges.get("main/home|play|edge");
    expect(play).toMatchObject({ rank: 0, here: true, dimmed: false });
    const other = view.edges.get("main/home|gift|edge");
    expect(other).toMatchObject({ here: false, dimmed: true });
  });

  it("a hub with the current node inside holds it without being current", async () => {
    const { ctx, actions } = await prepared();
    ctx.state.focus.selected = "main/boot";
    const view = world(ctx, currentAt(actions, "main/board>board/awaitIntent>x/y"));
    expect(view.hubs.get("main/board>board/awaitIntent")).toMatchObject({
      holdsCurrent: true,
      current: false,
      dimmed: false
    });
  });

  it("an expanded frame holding the current node holds it; the root frame does not", async () => {
    const { ctx, actions } = await prepared();
    const view = world(ctx, actions);
    expect(view.frames.get("main/board")?.holdsCurrent).toBe(true);
    expect(view.frames.get("#main")?.holdsCurrent).toBe(false);
    expect(view.hubs.get("main/board>board/awaitIntent")).toMatchObject({
      current: true,
      holdsCurrent: true
    });
  });
});

/** A card view. */
const card: CardView = {
  name: "board",
  glyph: "sub-flow",
  kinds: ["sub-flow"],
  kindLine: "sub-flow · board",
  selected: false,
  current: false,
  holdsCurrent: true,
  dimmed: false,
  pulse: false,
  trail: true,
  onStack: true,
  expandable: true,
  expanded: false
};

describe("rendering an item holding the current node (finding 7)", () => {
  it("a card holding the current node rings and says here instead of on stack", async () => {
    const { ctx, actions } = await prepared();
    const node = item({ key: "main/board" });
    const { host, unmount } = mount(h(NodeCard, { ctx, actions, item: node, view: card }));
    const element = host.querySelector<HTMLElement>('[data-flow="node-card"]');
    expect(element?.dataset.holdsCurrent).toBe("");
    expect(element?.dataset.current).toBeUndefined();
    expect(element?.querySelector('[data-tag="here"]')?.textContent).toBe("here");
    expect(element?.querySelector('[data-tag="on-stack"]')).toBeNull();
    unmount();
  });

  it("the current card keeps its own ring and the on stack tag", async () => {
    const { ctx, actions } = await prepared();
    const node = item({ key: "main/home" });
    const view = { ...card, current: true };
    const { host, unmount } = mount(h(NodeCard, { ctx, actions, item: node, view }));
    const element = host.querySelector<HTMLElement>('[data-flow="node-card"]');
    expect(element?.dataset.current).toBe("");
    expect(element?.dataset.holdsCurrent).toBeUndefined();
    expect(element?.querySelector('[data-tag="here"]')).toBeNull();
    expect(element?.querySelector('[data-tag="on-stack"]')?.textContent).toBe("on stack");
    unmount();
  });

  it("a hub holding the current node rings and says here", async () => {
    const { ctx, actions } = await prepared();
    const hub = item({ key: "main/board>board/awaitIntent", kind: "hub", w: 200, h: 120 });
    const view = { ...card, outcomes: ["tap"], waiting: [], scene: undefined };
    const { host, unmount } = mount(h(Hub, { ctx, actions, item: hub, view }));
    const element = host.querySelector<HTMLElement>('[data-flow="hub"]');
    expect(element?.dataset.holdsCurrent).toBe("");
    expect(element?.querySelector('[data-tag="here"]')?.textContent).toBe("here");
    expect(element?.querySelector('[data-tag="current"]')).toBeNull();
    unmount();
  });

  it("a frame holding the current node rings and says here", async () => {
    const { ctx, actions } = await prepared();
    const frame = item({ key: "main/board", kind: "frame", w: 800, h: 600 });
    const view = { head: "# board", onStack: true, root: false, dimmed: false, holdsCurrent: true };
    const { host, unmount } = mount(h(Frame, { ctx, actions, item: frame, view }));
    const element = host.querySelector<HTMLElement>('[data-flow="frame"]');
    expect(element?.dataset.holdsCurrent).toBe("");
    expect(element?.querySelector('[data-tag="here"]')?.textContent).toBe("here");
    await settle();
    unmount();
  });
});
