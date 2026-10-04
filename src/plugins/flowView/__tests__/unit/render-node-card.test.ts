// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { h } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Edges, labelPoint } from "../../render/Edges";
import { Frame } from "../../render/Frame";
import { Hub } from "../../render/Hub";
import { Lane } from "../../render/Lane";
import { NodeCard } from "../../render/NodeCard";
import { Stub } from "../../render/Stub";
import type { CardView } from "../../render/types";
import { item, PLUGIN_DIR } from "../helpers";
import { mount, prepared, settle } from "../render";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

/** A straight labelled edge from a source. */
function straightEdge(from: string, outcome: string) {
  return {
    key: `${from}:${outcome}`,
    from,
    to: "t",
    outcome,
    kind: "edge" as const,
    points: [
      { x: 0, y: 0 },
      { x: 40, y: 0 }
    ],
    label: outcome
  };
}

const view: CardView = {
  name: "settings",
  glyph: "sub-flow",
  kinds: ["sub-flow"],
  kindLine: "sub-flow · settingsPopup",
  selected: true,
  current: false,
  dimmed: false,
  pulse: false,
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
    const box = card?.parentElement;
    expect(box?.dataset.flow).toBe("node");
    expect(box?.style.left).toBe("10px");
    expect(box?.style.width).toBe("172px");
    expect(card?.hasAttribute("data-expandable")).toBe(true);
    expect(card?.textContent).toContain("settings");
    expect(card?.textContent).toContain("sub-flow · settingsPopup");
    expect(card?.textContent).toContain("on stack");
    expect(card?.querySelector<HTMLElement>('[data-part="glyph"]')?.dataset.glyph).toBe("sub-flow");
    expect(card?.querySelector('[data-part="pin"]')).not.toBeNull();
    // The expand button is a sibling of the focusable card, not a descendant (axe nested-interactive).
    expect(card?.querySelector('[data-part="expand"], button')).toBeNull();
    const toggle = box?.querySelector<HTMLElement>(':scope > [data-part="expand"]');
    expect(toggle?.getAttribute("aria-label")).toBe("Expand main/settings");
    expect(toggle?.dataset.hit).toBe("card");
    expect(toggle?.dataset.key).toBe("main/settings");
    await settle(() => toggle?.click());
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
    expect(card?.parentElement?.querySelector('[data-part="expand"]')).toBeNull();
    expect(card?.hasAttribute("data-expandable")).toBe(false);
    unmount();
  });
});

describe("Hub, Lane, Frame, Stub, Edges (G, F8)", () => {
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

  it("lane band, frame head and stub", async () => {
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
        { rank: 4, recent: false, rejected: true, related: false, dimmed: false, selected: false }
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
    expect(path?.dataset.rank).toBe("4");
    expect(path?.style.opacity).toBe("0.48");
    expect(path?.hasAttribute("data-recent")).toBe(false);
    const label = host.querySelector<HTMLElement>('[data-flow="edge-label"]');
    expect(label?.textContent).toBe("rejected");
    expect(label?.dataset.hit).toBe("outcome");
    expect(label?.dataset.outcome).toBe("rejected");
    unmount();
  });

  it("edges: the last three trail edges are recent (2 px, no fade); a dimmed edge never gets the trail opacity", async () => {
    const views = new Map([
      [
        "a|x|edge",
        { rank: 0, recent: true, rejected: false, related: false, dimmed: false, selected: false }
      ],
      [
        "b|y|edge",
        { rank: 3, recent: false, rejected: false, related: false, dimmed: true, selected: false }
      ]
    ]);
    const { host, unmount } = mount(
      h(Edges, {
        edges: [straightEdge("a", "x"), straightEdge("b", "y")],
        bounds: { x: 0, y: 0, w: 100, h: 100 },
        views,
        showReturns: new Set<string>()
      })
    );
    const [recent, dimmed] = host.querySelectorAll<SVGPathElement>("path");
    expect(recent?.hasAttribute("data-recent")).toBe(true);
    expect(recent?.style.opacity).toBe("");
    expect(dimmed?.hasAttribute("data-dimmed")).toBe(true);
    expect(dimmed?.style.opacity).toBe("");
    const labels = host.querySelectorAll<HTMLElement>('[data-flow="edge-label"]');
    expect(labels[1]?.hasAttribute("data-dimmed")).toBe(true);
    unmount();
  });

  it("edges: a label sits where the layout placed it, else at the first segment's midpoint", async () => {
    const plain = straightEdge("a", "x");
    const placed = { ...plain, labelAt: { x: 300, y: 120 } };
    expect(labelPoint(placed)).toEqual({ x: 300, y: 120 });
    expect(labelPoint(plain)).toEqual({ x: 20, y: 0 });
    expect(labelPoint({ ...plain, points: [] })).toBeUndefined();
    const { host, unmount } = mount(
      h(Edges, {
        edges: [placed],
        bounds: { x: 0, y: 0, w: 400, h: 400 },
        views: new Map(),
        showReturns: new Set<string>()
      })
    );
    const label = host.querySelector<HTMLElement>('[data-flow="edge-label"]');
    expect(label?.style.left).toBe("300px");
    expect(label?.style.top).toBe("120px");
    unmount();
  });
});

describe("dimmed and pulsing items keep their card (finding 12, 14)", () => {
  it("a dimmed card, hub and stub keep an opaque background: the sheets fade their content, not the box", () => {
    const sheets = [
      "render/node-card.css",
      "render/hub.css",
      "render/stub.css",
      "render/edges.css"
    ];
    for (const sheet of sheets) {
      const code = readFileSync(`${PLUGIN_DIR}${sheet}`, "utf8").replaceAll(
        /\/\*[\s\S]*?\*\//g,
        ""
      );
      const dimmed = /:scope\[data-dimmed\]\s*\{([^}]*)\}/.exec(code)?.[1] ?? "";
      expect(dimmed, sheet).not.toMatch(/opacity/);
    }
  });

  it("a pulsing card carries data-pulse", async () => {
    const { ctx, actions } = await prepared();
    const node = item({ key: "main/home" });
    const { host, unmount } = mount(
      h(NodeCard, { ctx, actions, item: node, view: { ...view, pulse: true } })
    );
    expect(host.querySelector('[data-flow="node-card"]')?.hasAttribute("data-pulse")).toBe(true);
    unmount();
  });
});
