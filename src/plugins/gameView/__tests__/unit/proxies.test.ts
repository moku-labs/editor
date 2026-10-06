import { describe, expect, it } from "vitest";
import { buildScene } from "../../../panels/shared/scene";
import { proxyList } from "../../reference/proxies";
import type { StyleSource } from "../../types";
import { sceneCapture } from "../helpers";
import { boardScene } from "../ui";

// ─────────────────────────────────────────────────────────────────────────────
// Reference mode proxies (finding 17, D-27): one per placed visible scene node,
// layout-only nodes under the drawing ones, paint order kept; round 2 adds the
// frame, the reference bounds and the place of the style block.
// ─────────────────────────────────────────────────────────────────────────────

const COIN_SOURCE: StyleSource = {
  kind: "ident",
  path: "src/hud/Hud.tsx",
  line: 2,
  range: [2, 1, 2, 42],
  ref: { kind: "const", name: "coinPill" },
  files: ["src/hud/Hud.tsx"]
};

describe("proxyList", () => {
  it("has one proxy per placed visible node, layout-only nodes first, each group in paint order", () => {
    const scene = boardScene();
    const proxies = proxyList(scene, { node: undefined, found: new Map(), blocks: new Map() });
    const ids = proxies.map(proxy => proxy.id);
    const placed = scene.paintOrder.filter(id => {
      const node = scene.nodes.get(id);
      return node?.rect !== undefined && node.visible;
    });

    expect(ids.toSorted()).toEqual(placed.toSorted());
    expect(ids.slice(0, 3)).toEqual([
      "ui:boardScreen",
      "ui:boardScreen/hudRow",
      "ui:boardScreen/orders"
    ]);
    const firstDrawing = ids.indexOf("ui:boardScreen/boardBackground");
    expect(ids.indexOf("ui:boardScreen/hudRow/coinPill")).toBeGreaterThan(firstDrawing);
    expect(ids.indexOf("ui:boardScreen/hudRow/coinPill")).toBeLessThan(
      ids.indexOf("ui:boardScreen/hudRow/coinPill/coinPillIcon")
    );
    expect(ids).not.toContain("entity:1048641");
  });

  it("gives a ui proxy its name, type, key, path, flow node, source, style and bounds", () => {
    const proxies = proxyList(boardScene(), {
      node: "board/awaitIntent",
      found: new Map([["coinPill", COIN_SOURCE]]),
      blocks: new Map([["coinPill", { path: "src/hud/styles.ts", line: 3 }]])
    });
    const coin = proxies.find(proxy => proxy.id === "ui:boardScreen/hudRow/coinPill");

    expect(coin?.rect).toEqual({ x: 235, y: 74, w: 290, h: 76 });
    expect(coin?.attributes).toEqual({
      "aria-label": "coinPill",
      title: "coinPill · row",
      "data-moku-key": "coinPill",
      "data-moku-name": "coinPill",
      "data-moku-type": "row",
      "data-moku-path": "boardScreen/hudRow/coinPill",
      "data-moku-node": "board/awaitIntent",
      "data-moku-source": "src/hud/Hud.tsx:2",
      "data-moku-style": "coinPill",
      "data-moku-style-source": "src/hud/styles.ts:3",
      "data-moku-bounds": "235 74 290 76",
      "data-moku-ref-bounds": "235 74 290 76",
      "data-moku-frame": "1841"
    });
  });

  it("falls back to the nine-slice texture as the style, a call shows as written", () => {
    const energy = proxyList(boardScene(), {
      node: undefined,
      found: new Map(),
      blocks: new Map()
    }).find(proxy => proxy.id === "ui:boardScreen/hudRow/energyPill");
    expect(energy?.attributes["data-moku-style"]).toBe("ui.hud-pill");
    expect(energy?.attributes["data-moku-source"]).toBeUndefined();

    const call: StyleSource = {
      kind: "call",
      path: "kit.tsx",
      line: 9,
      range: [8, 5, 12, 7],
      call: "pillOf(2)",
      callLine: 10
    };
    const withCall = proxyList(boardScene(), {
      node: undefined,
      found: new Map([["energyPill", call]]),
      blocks: new Map()
    }).find(proxy => proxy.id === "ui:boardScreen/hudRow/energyPill");
    expect(withCall?.attributes["data-moku-style"]).toBe("pillOf(2)");
    expect(withCall?.attributes["data-moku-source"]).toBe("kit.tsx:9");
    expect(withCall?.attributes["data-moku-style-source"]).toBe("kit.tsx:10");
  });

  it("names the element line of a pattern answer; an identifier without a found block has no style source", () => {
    const proxies = proxyList(boardScene(), {
      node: undefined,
      found: new Map<string, StyleSource>([
        ["coinPill", COIN_SOURCE],
        ["energyPill", { kind: "defined", path: "strip.tsx", line: 216, range: [215, 5, 247, 14] }]
      ]),
      blocks: new Map()
    });
    const coin = proxies.find(proxy => proxy.id === "ui:boardScreen/hudRow/coinPill");
    const energy = proxies.find(proxy => proxy.id === "ui:boardScreen/hudRow/energyPill");
    expect(coin?.attributes["data-moku-style-source"]).toBeUndefined();
    expect(energy?.attributes["data-moku-source"]).toBe("strip.tsx:216");
  });

  it("gives the reference bounds in reference units and the scene frame", () => {
    const capture = sceneCapture("scene-board.txt");
    const half = buildScene({ ...capture, frame: 7, calibration: { scale: 0.5, x: 0, y: 0 } });
    if ("error" in half) throw new Error("fixture");
    const coin = proxyList(half, { node: undefined, found: new Map(), blocks: new Map() }).find(
      proxy => proxy.id === "ui:boardScreen/hudRow/coinPill"
    );
    expect(coin?.attributes["data-moku-bounds"]).toBe("118 37 145 38");
    expect(coin?.attributes["data-moku-ref-bounds"]).toBe("235 74 290 76");
    expect(coin?.attributes["data-moku-frame"]).toBe("7");
  });

  it("names an entity proxy by its entity path and rounds its bounds", () => {
    const item = proxyList(boardScene(), {
      node: undefined,
      found: new Map(),
      blocks: new Map()
    }).find(proxy => proxy.id === "entity:1048628");
    expect(item?.attributes["data-moku-path"]).toBe("entity:1048628");
    expect(item?.attributes["data-moku-key"]).toBeUndefined();
    expect(item?.attributes["data-moku-bounds"]).toBe("429 881 223 223");
  });

  it("is empty for a scene that is not calibrated", () => {
    const capture = sceneCapture("scene-board.txt");
    const scene = buildScene({ ...capture, frame: 1, calibration: undefined });
    if ("error" in scene) throw new Error("fixture");
    expect(proxyList(scene, { node: undefined, found: new Map(), blocks: new Map() })).toEqual([]);
  });
});
