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

  it("finds no hub in main and rewardPopup", () => {
    // Fixed: the spec says 3 returns; splash, dailyGift, settings and board all lead to home.
    expect(returnsOf(flowOf("main"), "home")).toBe(4);
    expect(detectHub(flowOf("main"), config)).toBeUndefined();
    expect(detectHub(flowOf("rewardPopup"), config)).toBeUndefined();
  });

  it("makes settingsPopup/open (5 outcomes, 5 returns) the settingsPopup hub", () => {
    expect(flowOf("settingsPopup").nodes.open?.outcomes).toHaveLength(5);
    expect(returnsOf(flowOf("settingsPopup"), "open")).toBe(5);
    expect(detectHub(flowOf("settingsPopup"), config)).toBe("open");
  });

  it("breaks a tie by declared order and respects the thresholds", () => {
    const five = ["a", "b", "c", "d", "e"];
    const flow: FlowJson = {
      start: "s",
      nodes: {
        s: plain(["go"]),
        first: rest(five),
        second: rest(five),
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
    expect(detectHub(flow, testConfig({ hubMinOutcomes: 6 }))).toBeUndefined();
  });
});
