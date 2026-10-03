import { describe, expect, it } from "vitest";
import { detectHub, returnsOf } from "../../layout/hub";
import type { FlowJson } from "../../types";
import { flowOf, testConfig } from "../helpers";

const config = testConfig();

/** A rest node with outcomes. */
function rest(outcomes: string[]) {
  return {
    flow: "f",
    node: "x",
    rest: true,
    over: false,
    checkpoint: false,
    barrier: false,
    outcomes
  };
}

/** A plain node with outcomes. */
function plain(outcomes: string[]) {
  return { ...rest(outcomes), rest: false };
}

describe("detectHub (design §7.1)", () => {
  it("makes board/awaitIntent (8 outcomes, 9 returns) the board hub", () => {
    expect(returnsOf(flowOf("board"), "awaitIntent")).toBe(9);
    expect(detectHub(flowOf("board"), config)).toBe("awaitIntent");
  });

  it("finds no hub in main, settingsPopup and rewardPopup", () => {
    // Fixed: the spec says 3 returns; splash, dailyGift, leaveGame, settings and board all lead to home.
    expect(returnsOf(flowOf("main"), "home")).toBe(5);
    expect(detectHub(flowOf("main"), config)).toBeUndefined();
    // merge-game v5: settingsPopup/open has 5 outcomes and 5 returns, one outcome short of a hub.
    expect(flowOf("settingsPopup").nodes.open?.outcomes).toHaveLength(5);
    expect(returnsOf(flowOf("settingsPopup"), "open")).toBe(5);
    expect(detectHub(flowOf("settingsPopup"), config)).toBeUndefined();
    expect(detectHub(flowOf("rewardPopup"), config)).toBeUndefined();
  });

  it("makes a rest node with 6 outcomes and 4 returns a hub, not one with 5 outcomes", () => {
    const flow: FlowJson = {
      start: "s",
      nodes: {
        s: plain(["go"]),
        menu: rest(["a", "b", "c", "d", "e", "f"]),
        r1: plain(["x"]),
        r2: plain(["x"]),
        r3: plain(["x"])
      },
      edges: {
        s: { go: "menu" },
        r1: { x: "menu" },
        r2: { x: "menu" },
        r3: { x: "menu" }
      }
    };
    // s, r1, r2 and r3 lead to menu: exactly hubMinReturns.
    expect(returnsOf(flow, "menu")).toBe(4);
    expect(detectHub(flow, config)).toBe("menu");
    const five = structuredClone(flow);
    five.nodes.menu = rest(["a", "b", "c", "d", "e"]);
    expect(detectHub(five, config)).toBeUndefined();
  });

  it("breaks a tie by declared order and respects the thresholds", () => {
    const six = ["a", "b", "c", "d", "e", "f"];
    const flow: FlowJson = {
      start: "s",
      nodes: {
        s: plain(["go"]),
        first: rest(six),
        second: rest(six),
        r1: plain(["x", "y"]),
        r2: plain(["x", "y"]),
        r3: plain(["x", "y"]),
        r4: plain(["x", "y"])
      },
      edges: {
        s: { go: "first" },
        r1: { x: "first", y: "second" },
        r2: { x: "first", y: "second" },
        r3: { x: "first", y: "second" },
        r4: { x: "first", y: "second" }
      }
    };
    expect(detectHub(flow, config)).toBe("first");
    expect(detectHub(flow, testConfig({ hubMinReturns: 6 }))).toBeUndefined();
    expect(detectHub(flow, testConfig({ hubMinOutcomes: 7 }))).toBeUndefined();
  });
});
