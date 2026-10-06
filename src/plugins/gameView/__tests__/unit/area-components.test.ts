import { describe, expect, it, vi } from "vitest";
import type { SceneNode } from "../../../panels/shared/scene";
import { areaComponents, componentAt, DEFINITION_LINES } from "../../reference/area-components";
import { answer, createCtx, place, templateOf } from "../helpers";
import { boardScene } from "../ui";

// ─────────────────────────────────────────────────────────────────────────────
// Component sources of the fuller area card (captures-by-day U5): the component
// an element is an instance of (the tag that opens its index range), and its
// definition as the index answers `component:<Name>` (G1). No crawl.
// ─────────────────────────────────────────────────────────────────────────────

const HUD = [
  "<row>",
  '  <RoundButton id="home" intent="leave" />',
  '  <column key="giftCorner" style={giftCorner} />',
  "</row>"
].join("\n");

const KIT = [
  'import { defineStyle } from "@moku-labs/game";',
  "",
  "export function RoundButton(props: RoundButtonProps) {",
  "  return (",
  "    <button key={props.id} style={styles.disc} />",
  "  );",
  "}"
].join("\n");

/**
 * The scene node of the board fixture by id.
 *
 * @param id - The scene node id.
 * @returns The node.
 */
function nodeOf(id: string): SceneNode {
  const node = boardScene().nodes.get(id);
  if (node === undefined) throw new Error(`no node ${id}`);
  return node;
}

describe("componentAt", () => {
  it("names the component whose tag opens the element's range", () => {
    expect(componentAt(['          <RoundButton id="homeSettings" />'], [1, 11, 1, 46])).toBe(
      "RoundButton"
    );
    expect(
      componentAt(["            <RoundButton", '              id="gift"'], [1, 13, 3, 15])
    ).toBe("RoundButton");
  });

  it("is undefined for an intrinsic element, a member tag, or a range that opens no tag", () => {
    expect(componentAt(['<column key="giftCorner" style={giftCorner}>'], [1, 1, 1, 46])).toBe(
      undefined
    );
    expect(componentAt(['<Kit.Button id="ok" />'], [1, 1, 1, 23])).toBeUndefined();
    expect(
      componentAt([`const id = ${templateOf("card", "slot")};`], [1, 1, 1, 27])
    ).toBeUndefined();
  });
});

describe("areaComponents", () => {
  it("shows each component's definition once, from the index's component:<Name>, cut to 60 lines", async () => {
    const ctx = createCtx({ "src/hud/Hud.tsx": HUD, "features/ui/kit.tsx": KIT });
    answer(ctx, "jsx:home", place("src/hud/Hud.tsx", [2, 3, 2, 43]));
    answer(ctx, "jsx:coinPill", place("src/hud/Hud.tsx", [2, 3, 2, 43]));
    answer(ctx, "component:RoundButton", place("features/ui/kit.tsx", [3, 1, 7, 2]));
    const find = vi.spyOn(ctx.link.files, "find");
    const home = nodeOf("ui:boardScreen/hudRow/home");
    const coin = nodeOf("ui:boardScreen/hudRow/coinPill");

    const components = await areaComponents(ctx, [home, coin], new Map());

    expect(components).toEqual([
      {
        key: "home",
        name: "RoundButton",
        snippet: { path: "features/ui/kit.tsx", line: 3, lines: KIT.split("\n").slice(2) }
      }
    ]);
    expect(find.mock.calls.map(call => call[0])).toEqual([
      "jsx:home",
      "component:RoundButton",
      "jsx:coinPill"
    ]);
    expect(DEFINITION_LINES).toBe(60);
  });

  it("leaves out an intrinsic element, a key and a component the index does not know", async () => {
    const ctx = createCtx({ "src/hud/Hud.tsx": HUD });
    answer(ctx, "jsx:home", place("src/hud/Hud.tsx", [2, 3, 2, 43]));
    answer(ctx, "jsx:coinPill", place("src/hud/Hud.tsx", [3, 3, 3, 49]));
    const nodes = [nodeOf("ui:boardScreen/hudRow/home"), nodeOf("ui:boardScreen/hudRow/coinPill")];
    expect(await areaComponents(ctx, nodes, new Map())).toEqual([]);
    expect(
      await areaComponents(ctx, [nodeOf("ui:boardScreen/hudRow/energyPill")], new Map())
    ).toEqual([]);
  });

  it("uses a remembered source without asking the index for the key again", async () => {
    const ctx = createCtx({ "src/hud/Hud.tsx": HUD, "features/ui/kit.tsx": KIT });
    ctx.state.found.set("home", {
      kind: "defined",
      path: "src/hud/Hud.tsx",
      line: 2,
      range: [2, 3, 2, 43]
    });
    answer(ctx, "component:RoundButton", place("features/ui/kit.tsx", [3, 1, 7, 2]));
    const find = vi.spyOn(ctx.link.files, "find");
    const components = await areaComponents(ctx, [nodeOf("ui:boardScreen/hudRow/home")], new Map());
    expect(components.map(component => component.name)).toEqual(["RoundButton"]);
    expect(find.mock.calls.map(call => call[0])).toEqual(["component:RoundButton"]);
  });
});
