// @vitest-environment happy-dom
import { h } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Edges } from "../../render/Edges";
import { Frame } from "../../render/Frame";
import { Hub } from "../../render/Hub";
import { Lane } from "../../render/Lane";
import { NodeCard } from "../../render/NodeCard";
import { NoteNode } from "../../render/NoteNode";
import { Stub } from "../../render/Stub";
import type { CardView } from "../../render/types";
import { item } from "../helpers";
import { mount, prepared, settle } from "../render";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

const view: CardView = {
  name: "settings",
  glyph: "sub-flow",
  kinds: ["sub-flow"],
  kindLine: "sub-flow · settingsPopup",
  selected: true,
  current: false,
  dimmed: false,
  trail: true,
  onStack: true,
  expandable: true,
  expanded: false
};

describe("NodeCard (G)", () => {
  it("renders name, glyph, kind line, tags and the state attributes", async () => {
    const { ctx, actions } = await prepared();
    const expand = vi.spyOn(actions.flows, "expand");
    const node = item({ key: "main/settings", id: "main/settings", x: 10, y: 20, pinned: true });
    const { host, unmount } = mount(h(NodeCard, { ctx, actions, item: node, view }));
    const card = host.querySelector<HTMLElement>('[data-flow="node-card"]');
    expect(card?.dataset.kind).toBe("sub-flow");
    expect(card?.dataset.key).toBe("main/settings");
    expect(card?.dataset.hit).toBe("card");
    expect(card?.hasAttribute("data-selected")).toBe(true);
    expect(card?.hasAttribute("data-pinned")).toBe(true);
    expect(card?.hasAttribute("data-trail")).toBe(true);
    expect(card?.hasAttribute("data-current")).toBe(false);
    expect(card?.getAttribute("role")).toBe("button");
    expect(card?.getAttribute("aria-pressed")).toBe("true");
    expect(card?.style.left).toBe("10px");
    expect(card?.style.width).toBe("172px");
    expect(card?.textContent).toContain("settings");
    expect(card?.textContent).toContain("sub-flow · settingsPopup");
    expect(card?.textContent).toContain("on stack");
    expect(card?.querySelector<HTMLElement>('[data-part="glyph"]')?.dataset.glyph).toBe("sub-flow");
    expect(card?.querySelector('[data-part="pin"]')).not.toBeNull();
    await settle(() => card?.querySelector<HTMLElement>('[data-part="expand"]')?.click());
    expect(expand).toHaveBeenCalledWith("main/settings");
    unmount();
  });

  it("marks the current card with aria-current and dims unrelated cards", async () => {
    const { ctx, actions } = await prepared();
    const node = item({ key: "main/home" });
    const current = { ...view, selected: false, current: true, dimmed: true, expandable: false };
    const { host, unmount } = mount(h(NodeCard, { ctx, actions, item: node, view: current }));
    const card = host.querySelector<HTMLElement>('[data-flow="node-card"]');
    expect(card?.getAttribute("aria-current")).toBe("location");
    expect(card?.hasAttribute("data-dimmed")).toBe(true);
    expect(card?.querySelector('[data-part="expand"]')).toBeNull();
    unmount();
  });
});

describe("Hub, Lane, Frame, Stub, NoteNode, Edges (G, F8)", () => {
  it("hub: head with You are here and waiting count, one port row per outcome", async () => {
    const { ctx, actions } = await prepared();
    const hub = item({
      key: "h",
      id: "board/awaitIntent",
      kind: "hub",
      w: 200,
      h: 300,
      ports: { tap: 100, leave: 150 }
    });
    const hubView = {
      ...view,
      name: "awaitIntent",
      glyph: "rest" as const,
      current: true,
      outcomes: ["tap", "leave"],
      waiting: ["tap"],
      scene: "board"
    };
    const { host, unmount } = mount(h(Hub, { ctx, actions, item: hub, view: hubView }));
    const element = host.querySelector<HTMLElement>('[data-flow="hub"]');
    expect(element?.textContent).toContain("You are here");
    expect(element?.textContent).toContain("waiting for 1 outcome");
    const ports = element?.querySelectorAll<HTMLElement>('[data-part="port"]') ?? [];
    expect([...ports].map(port => port.dataset.outcome)).toEqual(["tap", "leave"]);
    expect(ports[0]?.hasAttribute("data-waiting")).toBe(true);
    expect(ports[1]?.hasAttribute("data-waiting")).toBe(false);
    unmount();
  });

  it("lane band, frame head, stub and note node", async () => {
    const { ctx, actions } = await prepared();
    const lane = { index: 1, outcome: "select", x: 0, y: 0, w: 500, h: 56, trail: false };
    const laneMount = mount(h(Lane, { lane, trail: true }));
    const band = laneMount.host.querySelector<HTMLElement>('[data-flow="lane"]');
    expect(band?.dataset.hit).toBe("lane");
    expect(band?.hasAttribute("data-trail")).toBe(true);
    expect(band?.dataset.index).toBe("1");
    laneMount.unmount();

    const frame = item({ key: "main/board", kind: "frame", w: 800, h: 600 });
    const frameMount = mount(
      h(Frame, {
        ctx,
        actions,
        item: frame,
        view: {
          head: "# board · sub-flow of main/board · 10 nodes · on the stack",
          onStack: true,
          root: false,
          dimmed: false
        }
      })
    );
    expect(frameMount.host.textContent).toContain("# board · sub-flow of main/board");
    expect(
      frameMount.host.querySelector('[data-flow="frame"]')?.hasAttribute("data-on-stack")
    ).toBe(true);
    const collapse = vi.spyOn(actions.flows, "collapse");
    await settle(() =>
      frameMount.host.querySelector<HTMLElement>('[data-action="collapse"]')?.click()
    );
    expect(collapse).toHaveBeenCalledWith("main/board");
    frameMount.unmount();

    const stub = item({ key: "s", kind: "stub", w: 120, h: 24, label: "↩ awaitIntent" });
    const stubMount = mount(
      h(Stub, {
        item: stub,
        view: {
          trail: false,
          rejected: "✕ rejected · frame 1778 · empty",
          selected: false,
          dimmed: false
        }
      })
    );
    const pill = stubMount.host.querySelector<HTMLElement>('[data-flow="stub"]');
    expect(pill?.hasAttribute("data-rejected")).toBe(true);
    expect(pill?.textContent).toContain("✕ rejected · frame 1778 · empty");
    stubMount.unmount();

    const note = item({ key: "note:a.md", id: "a.md", kind: "note", w: 236, h: 112, label: "A" });
    const noteMount = mount(
      h(NoteNode, {
        item: note,
        view: { title: "First wood 4", lines: ["a", "b", "c"], captures: 2, status: "idea" }
      })
    );
    const noteElement = noteMount.host.querySelector<HTMLElement>('[data-flow="note-node"]');
    expect(noteElement?.dataset.status).toBe("idea");
    expect(noteElement?.dataset.hit).toBe("note");
    expect(noteElement?.textContent).toContain("2 captures");
    noteMount.unmount();
  });

  it("edges: rounded paths, trail rank opacity, rejected dash, label chips", async () => {
    const edges = [
      {
        key: "board/merge:rejected",
        from: "m",
        to: "s",
        outcome: "rejected",
        kind: "edge" as const,
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 50 }
        ],
        label: "rejected"
      }
    ];
    const views = new Map([
      [
        "m|rejected|edge",
        { rank: 2, rejected: true, related: false, dimmed: false, selected: false }
      ]
    ]);
    const { host, unmount } = mount(
      h(Edges, {
        edges,
        bounds: { x: 0, y: 0, w: 500, h: 500 },
        views,
        showReturns: new Set<string>()
      })
    );
    const path = host.querySelector<SVGPathElement>("path");
    expect(path?.getAttribute("d")).toBe("M 0 0 L 92 0 Q 100 0 100 8 L 100 50");
    expect(path?.dataset.rejected).toBe("");
    expect(path?.dataset.rank).toBe("2");
    expect(path?.style.opacity).toBe(String(1 - 0.13 * 2));
    const label = host.querySelector<HTMLElement>('[data-flow="edge-label"]');
    expect(label?.textContent).toBe("rejected");
    expect(label?.dataset.hit).toBe("outcome");
    expect(label?.dataset.outcome).toBe("rejected");
    unmount();
  });
});
