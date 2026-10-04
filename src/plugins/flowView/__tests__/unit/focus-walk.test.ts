import { describe, expect, it } from "vitest";
import { defaultRow, moveHighlight, walkRow, walkTarget } from "../../focus/walk";
import { mergeGraph } from "../helpers";

const none = new Map<string, number>();

describe("walkTarget", () => {
  it("→ prefers the row on the trail", () => {
    const trail = new Map([["board/tapGenerator:noEnergy", 0]]);
    expect(
      walkTarget(mergeGraph, "board/tapGenerator", "next", { side: "to", index: -1 }, trail)
    ).toBe("board/energy");
  });

  it("→ falls back to the first row with a target", () => {
    expect(
      walkTarget(mergeGraph, "board/tapGenerator", "next", { side: "from", index: 0 }, none)
    ).toBe("board/awaitIntent");
  });

  it("→ follows the highlighted row", () => {
    expect(
      walkTarget(mergeGraph, "board/tapGenerator", "next", { side: "to", index: 2 }, none)
    ).toBe("board/toast");
  });

  it("← walks to the first source by default", () => {
    expect(walkTarget(mergeGraph, "board/energy", "prev", { side: "to", index: 0 }, none)).toBe(
      "board/tapGenerator"
    );
  });

  it("an exit row walks to the resolved parent target; rows without a target do nothing", () => {
    expect(
      walkTarget(
        mergeGraph,
        "board/giveToOrder",
        "next",
        { side: "to", index: 1 },
        none,
        "main/board"
      )
    ).toBe("main/afterOrder");
    expect(
      walkTarget(mergeGraph, "board/giveToOrder", "next", { side: "to", index: 1 }, none)
    ).toBeUndefined();
  });

  it("an empty column walks nowhere", () => {
    expect(
      walkTarget(mergeGraph, "main/boot", "prev", { side: "from", index: 0 }, none)
    ).toBeUndefined();
  });
});

describe("defaultRow and moveHighlight", () => {
  it("picks the trail row, else the first row with a target", () => {
    expect(
      defaultRow(
        [
          { key: "a", to: undefined },
          { key: "b", to: "x" },
          { key: "c", to: "y" }
        ],
        new Map([["c", 0]])
      )
    ).toBe(2);
    expect(
      defaultRow(
        [
          { key: "a", to: undefined },
          { key: "b", to: "x" }
        ],
        none
      )
    ).toBe(1);
    expect(defaultRow([], none)).toBe(0);
  });

  it("moves the highlight through Outcomes, then Comes from, and clamps at both ends", () => {
    const counts = { from: 2, to: 4 };
    expect(moveHighlight({ side: "to", index: -1 }, 1, counts)).toEqual({ side: "to", index: 0 });
    expect(moveHighlight({ side: "to", index: -1 }, -1, counts)).toEqual({ side: "to", index: 0 });
    expect(moveHighlight({ side: "to", index: 0 }, 1, counts)).toEqual({ side: "to", index: 1 });
    expect(moveHighlight({ side: "to", index: 3 }, 1, counts)).toEqual({ side: "from", index: 0 });
    expect(moveHighlight({ side: "from", index: 0 }, -1, counts)).toEqual({ side: "to", index: 3 });
    expect(moveHighlight({ side: "from", index: 1 }, 1, counts)).toEqual({
      side: "from",
      index: 1
    });
    expect(moveHighlight({ side: "to", index: 0 }, -1, counts)).toEqual({ side: "to", index: 0 });
    expect(moveHighlight({ side: "to", index: -1 }, 1, { from: 3, to: 0 })).toEqual({
      side: "from",
      index: 0
    });
    expect(moveHighlight({ side: "to", index: 0 }, 1, { from: 0, to: 0 })).toEqual({
      side: "to",
      index: -1
    });
  });

  it("walkRow takes the highlighted row of its side, else the default", () => {
    expect(
      walkRow(mergeGraph, "board/tapGenerator", "next", { side: "from", index: 0 }, none)
    ).toEqual({ side: "to", index: 0 });
    expect(walkRow(mergeGraph, "board/energy", "prev", { side: "from", index: 1 }, none)).toEqual({
      side: "from",
      index: 1
    });
    expect(walkRow(mergeGraph, "board/energy", "prev", { side: "to", index: 1 }, none)).toEqual({
      side: "from",
      index: 0
    });
  });
});
