import { describe, expect, it } from "vitest";
import {
  anchorIn,
  anchorOut,
  orthogonalRoute,
  rerouteTouching,
  roundedPath
} from "../../layout/routes";
import type { EdgePath } from "../../types";
import { item } from "../helpers";

describe("orthogonalRoute", () => {
  it("is a straight line on one row, else three segments through the middle", () => {
    expect(orthogonalRoute({ x: 0, y: 10 }, { x: 100, y: 10 })).toEqual([
      { x: 0, y: 10 },
      { x: 100, y: 10 }
    ]);
    expect(orthogonalRoute({ x: 0, y: 0 }, { x: 100, y: 50 })).toEqual([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 50 },
      { x: 100, y: 50 }
    ]);
  });

  it("steps out 24 units before turning back to a target on the left", () => {
    expect(orthogonalRoute({ x: 100, y: 0 }, { x: 0, y: 50 })).toEqual([
      { x: 100, y: 0 },
      { x: 124, y: 0 },
      { x: 124, y: 50 },
      { x: 0, y: 50 }
    ]);
  });
});

describe("roundedPath", () => {
  it("rounds every corner with an 8 px radius", () => {
    expect(
      roundedPath(
        [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 50 }
        ],
        8
      )
    ).toBe("M 0 0 L 92 0 Q 100 0 100 8 L 100 50");
  });

  it("shrinks the radius on short segments and handles two points", () => {
    expect(
      roundedPath(
        [
          { x: 0, y: 0 },
          { x: 6, y: 0 },
          { x: 6, y: 50 }
        ],
        8
      )
    ).toBe("M 0 0 L 3 0 Q 6 0 6 3 L 6 50");
    expect(
      roundedPath(
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 }
        ],
        8
      )
    ).toBe("M 0 0 L 10 0");
    expect(roundedPath([], 8)).toBe("");
  });
});

describe("anchors", () => {
  it("leaves from the right side at the port, enters on the left middle", () => {
    const hub = item({ key: "h", kind: "hub", x: 10, y: 20, w: 200, h: 400, ports: { tap: 100 } });
    expect(anchorOut(hub, "tap")).toEqual({ x: 210, y: 120 });
    expect(anchorOut(hub, "other")).toEqual({ x: 210, y: 220 });
    expect(anchorIn(item({ key: "n", x: 300, y: 50 }))).toEqual({ x: 300, y: 72 });
    const port = item({ key: "exit:left", kind: "port", x: 500, y: 94, w: 12, h: 12 });
    expect(anchorIn(port)).toEqual({ x: 506, y: 100 });
  });
});

/** An edge with placeholder points. */
function edge(key: string, from: string, to: string): EdgePath {
  return {
    key,
    from,
    to,
    outcome: key,
    kind: "edge",
    points: [
      { x: -1, y: -1 },
      { x: -2, y: -2 }
    ]
  };
}

describe("rerouteTouching", () => {
  it("re-routes only the edges touching the moved item", () => {
    const a = item({ key: "a", x: 0, y: 0 });
    const b = item({ key: "b", x: 400, y: 0 });
    const c = item({ key: "c", x: 400, y: 200 });
    const edges = [edge("ab", "a", "b"), edge("bc", "b", "c"), edge("ac", "a", "c")];
    const moved = { ...c, y: 300 };
    const result = rerouteTouching(edges, { a, b, c: moved }, "c");
    expect(result.rerouted).toBe(2);
    expect(result.edges[0]).toBe(edges[0]);
    expect(result.edges[1]?.points.at(-1)).toEqual({ x: 400, y: 322 });
    expect(result.edges[2]?.points[0]).toEqual({ x: 172, y: 22 });
  });
});
