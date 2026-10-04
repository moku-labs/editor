// @vitest-environment happy-dom
/* eslint-disable unicorn/no-null -- isTextField takes EventTarget | null */
import { describe, expect, it } from "vitest";
import { DRAG_THRESHOLD, isTextField, KEY_OPS, releaseIntent, wheelOp } from "../../camera/input";

const plain = {
  deltaX: 0,
  deltaY: 0,
  deltaMode: 0,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false
};
const pointer = { x: 300, y: 200 };

describe("wheelOp", () => {
  it("pans by (−deltaX, −deltaY)", () => {
    expect(wheelOp({ ...plain, deltaX: 10, deltaY: 20 }, pointer, 800)).toEqual({
      kind: "pan",
      dx: -10,
      dy: -20
    });
  });

  it("Shift + wheel pans horizontally", () => {
    expect(wheelOp({ ...plain, deltaY: 30, shiftKey: true }, pointer, 800)).toEqual({
      kind: "pan",
      dx: -30,
      dy: 0
    });
  });

  it("Ctrl or ⌘ + wheel zooms at the pointer by exp(−deltaY · 0.01)", () => {
    const op = wheelOp({ ...plain, deltaY: 50, ctrlKey: true }, pointer, 800);
    expect(op.kind).toBe("zoom");
    if (op.kind !== "zoom") return;
    expect(op.px).toBe(300);
    expect(op.py).toBe(200);
    expect(op.factor).toBeCloseTo(Math.exp(-0.5), 9);
    expect(wheelOp({ ...plain, deltaY: -10, metaKey: true }, pointer, 800).kind).toBe("zoom");
  });

  it("scales lines (deltaMode 1) by 16 and pages (2) by the viewport height", () => {
    expect(wheelOp({ ...plain, deltaY: 3, deltaMode: 1 }, pointer, 800)).toEqual({
      kind: "pan",
      dx: 0,
      dy: -48
    });
    expect(wheelOp({ ...plain, deltaY: 1, deltaMode: 2 }, pointer, 800)).toEqual({
      kind: "pan",
      dx: 0,
      dy: -800
    });
  });
});

describe("releaseIntent (M2)", () => {
  it("a click under 3 px on empty canvas, a frame background or a lane clears the selection", () => {
    expect(DRAG_THRESHOLD).toBe(3);
    for (const target of ["canvas", "frame", "lane"] as const) {
      expect(releaseIntent(2, target, "main/board")).toEqual({ kind: "clear" });
    }
  });

  it("a click on a card selects it; a drag is no click", () => {
    expect(releaseIntent(0, "card", "board/merge")).toEqual({ kind: "select", key: "board/merge" });
    expect(releaseIntent(1, "card", "main/home")).toEqual({ kind: "select", key: "main/home" });
    expect(releaseIntent(3, "card", "board/merge")).toBeUndefined();
    expect(releaseIntent(5, "canvas", undefined)).toBeUndefined();
  });

  it("a click on the hub head selects the hub", () => {
    expect(releaseIntent(0, "hub-head", "main/board>board/awaitIntent")).toEqual({
      kind: "select",
      key: "main/board>board/awaitIntent"
    });
  });
});

describe("KEY_OPS", () => {
  it("maps the Flow keys to camera ops", () => {
    const byKey = new Map(KEY_OPS.flatMap(row => row.keys.map(key => [key, row.op] as const)));
    expect(byKey.get("+")).toEqual({ kind: "zoomBy", factor: 1.25 });
    expect(byKey.get("=")).toEqual({ kind: "zoomBy", factor: 1.25 });
    expect(byKey.get("-")).toEqual({ kind: "zoomBy", factor: 0.8 });
    expect(byKey.get("0")).toEqual({ kind: "zoomTo", z: 1 });
    expect(byKey.get("f")).toEqual({ kind: "fit", target: "all" });
    expect(byKey.get("shift+1")).toEqual({ kind: "fit", target: "all" });
    expect(byKey.get("shift+2")).toEqual({ kind: "fit", target: "selection" });
  });
});

describe("isTextField", () => {
  it("is true inside inputs, textareas and contenteditable, false elsewhere", () => {
    const input = document.createElement("input");
    const area = document.createElement("textarea");
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    expect(isTextField(input)).toBe(true);
    expect(isTextField(area)).toBe(true);
    expect(isTextField(editable)).toBe(true);
    expect(isTextField(document.createElement("button"))).toBe(false);
    expect(isTextField(null)).toBe(false);
  });
});
