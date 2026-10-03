import { describe, expect, it } from "vitest";
import { stackOf } from "../../stack";
import { GRAPH } from "../fixtures";

describe("stackOf", () => {
  it("derives two frames for board/awaitIntent", () => {
    expect(stackOf("board/awaitIntent", GRAPH, "board")).toEqual([
      { flow: "main", node: "board" },
      { flow: "board", node: "awaitIntent" }
    ]);
  });

  it("follows sub-flows three levels deep", () => {
    expect(stackOf("board/settings/open", GRAPH, "settingsPopup")).toEqual([
      { flow: "main", node: "board" },
      { flow: "board", node: "settings" },
      { flow: "settingsPopup", node: "open" }
    ]);
  });

  it("gives the last frame the top flow below a slot node", () => {
    expect(stackOf("afterOrder/show", GRAPH, "rewardPopup")).toEqual([
      { flow: "main", node: "afterOrder" },
      { flow: "rewardPopup", node: "show" }
    ]);
  });

  it("returns a single frame for a node of main", () => {
    expect(stackOf("boot", GRAPH, "main")).toEqual([{ flow: "main", node: "boot" }]);
  });

  it("returns [] for an unknown node, an unknown step or a missing graph", () => {
    expect(stackOf("board/nope", GRAPH, "board")).toEqual([]);
    expect(stackOf("nope", GRAPH, "main")).toEqual([]);
    expect(stackOf("afterOrder/show", GRAPH, undefined)).toEqual([]);
    expect(stackOf("boot/a/b", GRAPH, "main")).toEqual([]);
    expect(stackOf("board/awaitIntent", undefined, "board")).toEqual([]);
    expect(stackOf("board/awaitIntent", { flows: {} }, "board")).toEqual([]);
    expect(stackOf("", GRAPH, "main")).toEqual([]);
  });
});
