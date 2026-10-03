import { describe, expect, it } from "vitest";
import { entryFrame, entryKey, frameLabel, rejectedEdges, trailRanks } from "../../focus/trail";
import { entry, mergeGraph } from "../helpers";

const history = [
  entry(1, "home", "play", { next: "board/awaitIntent" }),
  entry(2, "board/awaitIntent", "merge", { next: "board/merge" }),
  entry(3, "board/merge", "rejected", { payload: { reason: "empty" }, frame: 1778 }),
  entry(4, "board/awaitIntent", "merge", { next: "board/merge" }),
  entry(5, "board/merge", "done", { frame: 1800 })
];

describe("trailRanks", () => {
  it("ranks the newest entries first; the first occurrence wins", () => {
    const ranks = trailRanks(history, mergeGraph, 6);
    expect(ranks.get("board/merge:done")).toBe(0);
    expect(ranks.get("board/awaitIntent:merge")).toBe(1);
    expect(ranks.get("board/merge:rejected")).toBe(2);
    expect(ranks.get("main/home:play")).toBe(4);
  });

  it("looks at the newest n entries only", () => {
    const ranks = trailRanks(history, mergeGraph, 2);
    expect([...ranks.keys()]).toEqual(["board/merge:done", "board/awaitIntent:merge"]);
  });
});

describe("rejectedEdges", () => {
  it("keeps the last rejected entry per edge for the configured outcomes", () => {
    const rejected = rejectedEdges(history, mergeGraph, ["rejected"]);
    expect([...rejected.keys()]).toEqual(["board/merge:rejected"]);
    expect(rejected.get("board/merge:rejected")?.index).toBe(3);
    expect(rejectedEdges(history, mergeGraph, ["nope"]).size).toBe(0);
  });
});

describe("frame labels (F-H1)", () => {
  it("shows f<frame> from the entry or from a frame seen live, else #index", () => {
    const live = new Map([[4, 1790]]);
    expect(frameLabel(history[2] ?? entry(0, "", ""), live)).toBe("f1778");
    expect(frameLabel(history[3] ?? entry(0, "", ""), live)).toBe("f1790");
    expect(frameLabel(history[1] ?? entry(0, "", ""), live)).toBe("#2");
    expect(entryFrame(history[1] ?? entry(0, "", ""), live)).toBeUndefined();
    expect(entryFrame(history[4] ?? entry(0, "", ""), live)).toBe(1800);
  });

  it("keys an entry by its resolved node id", () => {
    expect(entryKey(history[0] ?? entry(0, "", ""), mergeGraph)).toBe("main/home:play");
    expect(entryKey(entry(9, "", "x"), mergeGraph)).toBeUndefined();
  });
});
