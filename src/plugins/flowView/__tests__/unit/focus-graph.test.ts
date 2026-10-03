import { describe, expect, it } from "vitest";
import {
  incoming,
  nodeKinds,
  nodeOf,
  outgoing,
  parentsOf,
  resolveStack,
  targetOf
} from "../../focus/graph";
import { mergeGraph } from "../helpers";

describe("resolveStack", () => {
  it("resolves nested paths level by level", () => {
    expect(resolveStack(mergeGraph, "board/awaitIntent").map(entry => entry.id)).toEqual([
      "main/board",
      "board/awaitIntent"
    ]);
    expect(resolveStack(mergeGraph, "home").map(entry => entry.id)).toEqual(["main/home"]);
    expect(resolveStack(mergeGraph, "board/settings/open").map(entry => entry.id)).toEqual([
      "main/board",
      "board/settings",
      "settingsPopup/open"
    ]);
  });

  it("follows a slot into the first contribution flow that has the node", () => {
    expect(resolveStack(mergeGraph, "afterOrder/show").map(entry => entry.id)).toEqual([
      "main/afterOrder",
      "rewardPopup/show"
    ]);
  });

  it("drops an unresolvable tail", () => {
    expect(resolveStack(mergeGraph, "board/nope").map(entry => entry.id)).toEqual(["main/board"]);
    expect(resolveStack(mergeGraph, "")).toEqual([]);
  });
});

describe("nodeKinds", () => {
  it("tags start, rest, transit, sub-flow, slot, checkpoint and over", () => {
    expect(nodeKinds(mergeGraph, "main/boot")).toEqual(["start", "transit"]);
    expect(nodeKinds(mergeGraph, "main/home")).toEqual(["rest", "checkpoint"]);
    expect(nodeKinds(mergeGraph, "main/settings")).toEqual(["sub-flow"]);
    expect(nodeKinds(mergeGraph, "main/afterOrder")).toEqual(["slot"]);
    expect(nodeKinds(mergeGraph, "board/awaitIntent")).toEqual(["start", "rest"]);
    expect(nodeKinds(mergeGraph, "rewardPopup/show")).toEqual(["start", "transit", "over"]);
    expect(nodeKinds(mergeGraph, "nope/x")).toEqual([]);
  });
});

describe("outgoing", () => {
  it("lists outcomes in declared order with back edges marked", () => {
    const rows = outgoing(mergeGraph, "board/giveToOrder");
    expect(rows.map(row => row.outcome)).toEqual(["done", "orderComplete", "rejected"]);
    expect(rows[0]).toEqual({
      outcome: "done",
      key: "board/giveToOrder:done",
      to: "board/awaitIntent",
      back: true
    });
    expect(rows[1]).toMatchObject({ exit: "orderComplete", to: undefined, back: false });
  });

  it("resolves exit:x through the one parent instance on screen", () => {
    const rows = outgoing(mergeGraph, "board/giveToOrder", "main/board");
    expect(rows[1]?.to).toBe("main/afterOrder");
    expect(outgoing(mergeGraph, "main/home").map(row => row.to)).toEqual([
      "main/board",
      "main/dailyGift",
      "main/settings"
    ]);
  });
});

describe("incoming", () => {
  it("lists the edges into a node, plus the parents' incoming edges for a flow start", () => {
    const rows = incoming(mergeGraph, "board/awaitIntent");
    const inner = rows.filter(row => row.via === undefined).map(row => row.key);
    expect(inner).toContain("board/tapGenerator:done");
    expect(inner).toContain("board/energy:watch");
    const via = rows.filter(row => row.via !== undefined);
    expect(via.map(row => [row.from, row.outcome, row.via])).toEqual([
      ["main/home", "play", "main/board"],
      ["main/afterOrder", "done", "main/board"]
    ]);
    expect(incoming(mergeGraph, "main/boot")).toEqual([]);
  });
});

describe("helpers", () => {
  it("finds parents, targets and nodes", () => {
    expect(parentsOf(mergeGraph, "settingsPopup")).toEqual(["main/settings", "board/settings"]);
    expect(parentsOf(mergeGraph, "rewardPopup")).toEqual(["main/afterOrder"]);
    expect(targetOf("main", "home")).toBe("main/home");
    expect(targetOf("main", "map:home")).toBe("main/home");
    expect(targetOf("board", "exit:left")).toBeUndefined();
    expect(nodeOf(mergeGraph, "board/merge")?.outcomes).toEqual(["done", "rejected"]);
    expect(nodeOf(mergeGraph, "bad")).toBeUndefined();
  });
});
