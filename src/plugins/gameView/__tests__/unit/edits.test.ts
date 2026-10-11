import { describe, expect, it } from "vitest";
import {
  countText,
  editCountText,
  editFields,
  editKey,
  editsOf,
  editsText,
  fieldKind,
  STYLE_ENUMS,
  selectedEditKey,
  selectOptions,
  styleValueAt,
  unresolved,
  valueText,
  withEdit
} from "../../element/edits";
import type { ElementEdits } from "../../types";
import { boardCaptureWith, boardScene, sceneOf } from "../ui";

// ─────────────────────────────────────────────────────────────────────────────
// Pending style edits (U8, D-67), the pure part: the text the agent gets, the
// field kinds of one style entry, the value a path names, one edit recorded
// into a list and the edits a scene has not taken yet.
// ─────────────────────────────────────────────────────────────────────────────

const HOME_PLAY: ElementEdits = {
  label: "homePlay",
  source: { path: "features/stage/views/home-screen.tsx", line: 199 },
  byId: false,
  edits: [
    { path: "minWidth", from: 556, to: 600 },
    { path: "padding.top", from: 25, to: 30 }
  ]
};

const TITLE: ElementEdits = {
  label: "homeTitle",
  source: { path: "features/stage/views/home-screen.tsx", line: 120 },
  byId: false,
  edits: [{ path: "justify", from: "center", to: "start" }]
};

describe("editsText", () => {
  it("one element: the @moku head with its source, then one line per edit", () => {
    expect(editsText([HOME_PLAY])).toBe(
      [
        "@moku homePlay · features/stage/views/home-screen.tsx:199",
        "minWidth: 556 -> 600",
        "padding.top: 25 -> 30"
      ].join("\n")
    );
  });

  it("two elements: one block each in the list's order (the selected first), one empty line between", () => {
    expect(editsText([TITLE, HOME_PLAY]).split("\n")).toEqual([
      "@moku homeTitle · features/stage/views/home-screen.tsx:120",
      'justify: "center" -> "start"',
      "",
      "@moku homePlay · features/stage/views/home-screen.tsx:199",
      "minWidth: 556 -> 600",
      "padding.top: 25 -> 30"
    ]);
  });

  it("writes a string in double quotes, a number and a boolean bare", () => {
    const entry: ElementEdits = {
      label: "row",
      byId: true,
      edits: [
        { path: "justify", from: "center", to: 'the "end"' },
        { path: "wrap", from: false, to: true },
        { path: "gap", from: 0, to: 12.5 }
      ]
    };
    expect(editsText([entry]).split("\n").slice(1)).toEqual([
      String.raw`justify: "center" -> "the \"end\""`,
      "wrap: false -> true",
      "gap: 0 -> 12.5"
    ]);
    expect(valueText("center")).toBe('"center"');
    expect(valueText(600)).toBe("600");
    expect(valueText(true)).toBe("true");
  });

  it("an element without a source has only its label in the head; no edits is an empty text", () => {
    const entry: ElementEdits = {
      label: "i1",
      byId: true,
      edits: [{ path: "alpha", from: 1, to: 0.5 }]
    };
    expect(editsText([entry])).toBe("@moku i1\nalpha: 1 -> 0.5");
    expect(editsText([])).toBe("");
  });
});

describe("countText", () => {
  it("counts the edits, and the elements only above one", () => {
    expect(countText([{ ...HOME_PLAY, edits: HOME_PLAY.edits.slice(0, 1) }])).toBe("1 edit");
    expect(countText([HOME_PLAY])).toBe("2 edits");
    expect(countText([HOME_PLAY, TITLE])).toBe("3 edits · 2 elements");
  });

  it("the copy toast counts the edits only", () => {
    expect(editCountText([HOME_PLAY, TITLE])).toBe("3 edits");
    expect(editCountText([TITLE])).toBe("1 edit");
  });
});

describe("selectedEditKey", () => {
  const COIN = { kind: "ui", path: "boardScreen/hudRow/coinPill" } as const;
  const published = { ref: COIN, key: "coinPill", name: "coinPill", type: "row", at: 1 };

  it("is the ui key of the selected node, else its node id; undefined without a selection", () => {
    const scene = boardScene();
    expect(selectedEditKey({ selected: COIN, scene, selection: undefined })).toBe("coinPill");

    const bare = sceneOf(boardCaptureWith("coinPill", node => delete node.key));
    const row = { kind: "ui", path: "boardScreen/hudRow/row#1" } as const;
    expect(selectedEditKey({ selected: row, scene: bare, selection: undefined })).toBe(
      "ui:boardScreen/hudRow/row#1"
    );
    expect(selectedEditKey({ selected: undefined, scene, selection: undefined })).toBeUndefined();
  });

  it("without the scene node, the selection published last for the element names its key", () => {
    const state = { selected: COIN, scene: undefined, selection: published };
    expect(selectedEditKey(state)).toBe("coinPill");

    // A publish of another element says nothing about this one: the node id stands in.
    const other = { ...published, ref: { kind: "entity", id: 7 } as const };
    expect(selectedEditKey({ ...state, selection: other })).toBe("ui:boardScreen/hudRow/coinPill");
    expect(selectedEditKey({ ...state, selection: undefined })).toBe(
      "ui:boardScreen/hudRow/coinPill"
    );
    // An element without a ui key is filed under its node id, published or not.
    const entity = { kind: "entity", id: 7 } as const;
    const bare = { ref: entity, name: "i7", type: "Sprite", at: 1 };
    expect(selectedEditKey({ selected: entity, scene: undefined, selection: bare })).toBe(
      "entity:7"
    );
  });
});

describe("editKey and editsOf", () => {
  it("names an element by its ui key, else by its node id", () => {
    expect(editKey({ id: "ui:homeScreen/homePlay", key: "homePlay" })).toBe("homePlay");
    expect(editKey({ id: "entity:7", key: undefined })).toBe("entity:7");
  });

  it("answers the edits kept under a key; none for an unknown key or no key", () => {
    const kept = new Map([["homePlay", HOME_PLAY]]);
    expect(editsOf(kept, "homePlay")).toBe(HOME_PLAY.edits);
    expect(editsOf(kept, "homeTitle")).toEqual([]);
    expect(editsOf(kept, undefined)).toEqual([]);
  });
});

describe("styleValueAt", () => {
  const style = { minWidth: 556, justify: "center", wrap: false, padding: { top: 25, left: 8 } };

  it("reads a number, a string and a boolean by key, and a leaf by its dotted path", () => {
    expect(styleValueAt(style, "minWidth")).toBe(556);
    expect(styleValueAt(style, "justify")).toBe("center");
    expect(styleValueAt(style, "wrap")).toBe(false);
    expect(styleValueAt(style, "padding.top")).toBe(25);
  });

  it("is undefined for a record, a missing key, a missing leaf, or no style", () => {
    expect(styleValueAt(style, "padding")).toBeUndefined();
    expect(styleValueAt(style, "gap")).toBeUndefined();
    expect(styleValueAt(style, "padding.bottom")).toBeUndefined();
    expect(styleValueAt(style, "minWidth.top")).toBeUndefined();
    expect(styleValueAt(undefined, "minWidth")).toBeUndefined();
  });
});

describe("editFields", () => {
  it("one field for a number, a string or a boolean: its path is the key, no label", () => {
    expect(editFields("minWidth", 556)).toEqual([
      { path: "minWidth", label: undefined, value: 556 }
    ]);
    expect(editFields("justify", "center")).toEqual([
      { path: "justify", label: undefined, value: "center" }
    ]);
    expect(editFields("wrap", true)).toEqual([{ path: "wrap", label: undefined, value: true }]);
  });

  it("one field per leaf of a record of those kinds, labelled with the leaf name", () => {
    expect(editFields("padding", { top: 25, left: 8 })).toEqual([
      { path: "padding.top", label: "top", value: 25 },
      { path: "padding.left", label: "left", value: 8 }
    ]);
  });

  it("is read-only for an array, a deeper record, an empty record or null", () => {
    expect(editFields("inset", ["safeArea.top", 12])).toBeUndefined();
    expect(editFields("shadow", { offset: { x: 0, y: 2 } })).toBeUndefined();
    expect(editFields("padding", {})).toBeUndefined();
    // eslint-disable-next-line unicorn/no-null -- null is a JSON value on the wire
    expect(editFields("fill", null)).toBeUndefined();
  });
});

describe("STYLE_ENUMS", () => {
  it("lists the values of every style property the engine types as a union of string literals", () => {
    expect(STYLE_ENUMS).toEqual({
      direction: ["row", "column"],
      justify: ["start", "center", "end", "between", "around", "evenly"],
      align: ["start", "center", "end", "stretch"],
      alignSelf: ["auto", "start", "center", "end", "stretch"],
      overflow: ["visible", "hidden", "scroll"],
      fit: ["contain"],
      position: ["relative", "absolute"],
      shape: ["rect", "triangle"],
      origin: ["center", "top", "topLeft"]
    });
  });

  it("has no row for a free string: a texture key and the reason of an absolute element", () => {
    expect(STYLE_ENUMS.nineSlice).toBeUndefined();
    expect(STYLE_ENUMS.reason).toBeUndefined();
  });
});

describe("fieldKind", () => {
  it("a number is a number field, a boolean a checkbox, a free string a text field", () => {
    expect(fieldKind({ path: "minWidth", label: undefined }, 556)).toBe("number");
    expect(fieldKind({ path: "wrap", label: undefined }, true)).toBe("checkbox");
    expect(fieldKind({ path: "nineSlice", label: undefined }, "ui.hud-pill")).toBe("text");
    expect(fieldKind({ path: "width", label: undefined }, "100%")).toBe("text");
  });

  it("a string of an enum property is a select: justify, align and every other row of the table", () => {
    for (const name of Object.keys(STYLE_ENUMS)) {
      expect(fieldKind({ path: name, label: undefined }, "center")).toBe("select");
    }
  });

  it("a leaf of a record with an enum name is a select too; its other leaves keep their kind", () => {
    expect(fieldKind({ path: "cell.direction", label: "direction" }, "row")).toBe("select");
    expect(fieldKind({ path: "cell.gap", label: "gap" }, 4)).toBe("number");
    expect(fieldKind({ path: "padding.top", label: "top" }, 25)).toBe("number");
  });

  it("goes by the value it shows: an enum name with a number or a boolean is no select", () => {
    expect(fieldKind({ path: "origin", label: undefined }, 0.5)).toBe("number");
    expect(fieldKind({ path: "fit", label: undefined }, true)).toBe("checkbox");
  });

  it("a name every object inherits is no enum", () => {
    expect(fieldKind({ path: "constructor", label: undefined }, "x")).toBe("text");
    expect(fieldKind({ path: "is.toString", label: "toString" }, "x")).toBe("text");
  });
});

describe("selectOptions", () => {
  it("answers the engine's values of the property, in the engine's order", () => {
    expect(selectOptions({ path: "justify", label: undefined, value: "center" }, "center")).toEqual(
      ["start", "center", "end", "between", "around", "evenly"]
    );
    expect(
      selectOptions({ path: "cell.direction", label: "direction", value: "row" }, "row")
    ).toEqual(["row", "column"]);
  });

  it("adds the scene value when the table does not list it", () => {
    expect(selectOptions({ path: "align", label: undefined, value: "left" }, "left")).toEqual([
      "start",
      "center",
      "end",
      "stretch",
      "left"
    ]);
  });

  it("adds a pending value the table does not list, once", () => {
    const field = { path: "fit", label: undefined, value: "contain" } as const;
    expect(selectOptions(field, "cover")).toEqual(["contain", "cover"]);
    expect(selectOptions({ ...field, value: "cover" }, "cover")).toEqual(["contain", "cover"]);
  });
});

describe("withEdit", () => {
  it("the first edit of a path takes `from` from the scene value", () => {
    expect(withEdit([], "minWidth", 556, 600)).toEqual([{ path: "minWidth", from: 556, to: 600 }]);
  });

  it("a second edit of the path replaces `to` and keeps the first `from`, in its place", () => {
    const first = withEdit(HOME_PLAY.edits, "minWidth", 556, 640);
    expect(first).toEqual([
      { path: "minWidth", from: 556, to: 640 },
      { path: "padding.top", from: 25, to: 30 }
    ]);
  });

  it("a `to` equal to the scene value removes the edit of that path", () => {
    expect(withEdit(HOME_PLAY.edits, "minWidth", 556, 556)).toEqual([
      { path: "padding.top", from: 25, to: 30 }
    ]);
  });

  it("answers the same list when nothing changes", () => {
    expect(withEdit(HOME_PLAY.edits, "minWidth", 556, 600)).toBe(HOME_PLAY.edits);
    expect(withEdit(HOME_PLAY.edits, "gap", 12, 12)).toBe(HOME_PLAY.edits);
  });
});

describe("unresolved", () => {
  it("drops the edits whose scene value equals `to`, keeps the others", () => {
    const style = { minWidth: 600, padding: { top: 25 } };
    expect(unresolved(HOME_PLAY.edits, style)).toEqual([{ path: "padding.top", from: 25, to: 30 }]);
    expect(unresolved(HOME_PLAY.edits, { minWidth: 600, padding: { top: 30 } })).toEqual([]);
  });

  it("answers the same list when the scene took none", () => {
    expect(unresolved(HOME_PLAY.edits, { minWidth: 556, padding: { top: 25 } })).toBe(
      HOME_PLAY.edits
    );
    expect(unresolved(HOME_PLAY.edits, undefined)).toBe(HOME_PLAY.edits);
  });
});
