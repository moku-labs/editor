import type { Anchor, Found, ProjectChange as GameProjectChange } from "@moku-labs/game/project";
import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  FindParams,
  Json,
  ProjectAnchor,
  ProjectChange,
  ProjectDelta,
  ProjectFound,
  ProjectState
} from "../../protocol";
import {
  anchorKey,
  firstDefinition,
  parseFoundList,
  parseProjectState,
  projectDelta
} from "../../protocol";

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures: the merge game after one watch batch, and a fresh `find` answer.
// ─────────────────────────────────────────────────────────────────────────────

const change: ProjectChange = {
  files: ["flows/board.ts", "nodes/board/catch-up.ts", "nodes/catch-up.ts"],
  moved: [{ key: "node:board/catchUp", from: "nodes/catch-up.ts", to: "nodes/board/catch-up.ts" }],
  removed: []
};

const on: ProjectState = {
  state: "on",
  revision: "r2",
  previous: "r1",
  manifest: "manifest.json",
  defs: {
    "flow:board": ["flows/board.ts"],
    "node:board/merge": ["nodes/merge.ts"],
    "textStyle:ui.number": ["features/ui/text-styles.ts", "features/ui/legacy.ts"]
  },
  uses: { "node:board/merge": ["flows/board.ts"] },
  broken: { "features/ui/popup.tsx": "features/ui/popup.tsx:12:3 ')' expected." },
  change
};

const found: ProjectFound = {
  path: "features/settings/settings.tsx",
  key: "settingsBoard",
  component: "Signboard",
  kind: "idProp",
  line: 301,
  range: [300, 5, 318, 7],
  hash: "0f3c9a"
};

describe("protocol project types", () => {
  it("mirror the game's project types field by field", () => {
    expectTypeOf<Anchor>().toExtend<ProjectAnchor>();
    expectTypeOf<Found>().toExtend<ProjectFound>();
    expectTypeOf<GameProjectChange>().toExtend<ProjectChange>();
    expectTypeOf<keyof ProjectAnchor>().toEqualTypeOf<keyof Anchor>();
    expectTypeOf<keyof ProjectFound>().toEqualTypeOf<keyof Found>();

    expect(found.range).toHaveLength(4);
  });

  it("ProjectState narrows by state, and travels as Json through toWireValue", () => {
    expectTypeOf<Extract<ProjectState, { state: "off" }>>().toEqualTypeOf<{
      readonly state: "off";
      readonly reason: string;
    }>();
    expectTypeOf<ProjectDelta["all"]>().toEqualTypeOf<boolean>();
    expectTypeOf<FindParams>().toEqualTypeOf<{ key: string }>();
    // @ts-expect-error -- readonly maps and arrays are not the mutable Json, like Manifest
    const json: Json = on;

    expect(json).toBe(on);
  });
});

describe("parseProjectState", () => {
  it("round-trips an on state with every field", () => {
    const parsed = parseProjectState(structuredClone(on));

    expect(parsed).toEqual(on);
    expect(parsed).not.toBe(on);
  });

  it("round-trips an on state without the optional fields", () => {
    const bare: ProjectState = { state: "on", revision: "r1", defs: {}, uses: {}, broken: {} };

    expect(parseProjectState({ ...bare })).toEqual(bare);
  });

  it("round-trips an off state", () => {
    expect(parseProjectState({ state: "off", reason: "disabled" })).toEqual({
      state: "off",
      reason: "disabled"
    });
  });

  it("drops unknown fields at the top, in the change and in a move", () => {
    const wire = {
      ...structuredClone(on),
      extra: 1,
      change: { ...change, revision: "r2", moved: [{ ...change.moved[0], extra: true }] }
    };

    expect(parseProjectState(wire)).toEqual(on);
  });

  it("keeps a key named __proto__ as a plain map entry", () => {
    const parsed = parseProjectState(
      JSON.parse(
        '{"state":"on","revision":"r","defs":{"__proto__":["a.ts"]},"uses":{},"broken":{}}'
      )
    );

    expect(parsed?.state === "on" && Object.hasOwn(parsed.defs, "__proto__")).toBe(true);
    expect(parsed?.state === "on" && Object.getPrototypeOf(parsed.defs)).toBe(Object.prototype);
  });

  it.each([
    ["a non-object", "on"],
    ["an array", []],
    ["an unknown state", { state: "maybe" }],
    ["off without a reason", { state: "off" }],
    ["on without a revision", { ...on, revision: undefined }],
    ["a bad defs value", { ...on, defs: { "flow:board": "flows/board.ts" } }],
    ["a bad defs path", { ...on, defs: { "flow:board": [3] } }],
    ["defs as an array", { ...on, defs: [] }],
    ["a bad uses value", { ...on, uses: { "node:board/merge": [true] } }],
    ["a bad broken value", { ...on, broken: { "a.ts": 1 } }],
    ["a bad previous", { ...on, previous: 1 }],
    ["a bad manifest", { ...on, manifest: false }],
    ["a change without moved", { ...on, change: { files: [], removed: [] } }],
    ["a bad move", { ...on, change: { ...change, moved: [{ key: "k", from: "a.ts" }] } }],
    ["a bad removed key", { ...on, change: { ...change, removed: [1] } }]
  ])("rejects %s", (_name, value) => {
    expect(parseProjectState(value)).toBeUndefined();
  });
});

describe("parseFoundList", () => {
  it("round-trips a list of answers", () => {
    const broken: ProjectFound = {
      path: "nodes/merge.ts",
      binding: "merge",
      line: 17,
      range: [17, 1, 30, 3],
      hash: "a1",
      broken: true
    };
    const parsed = parseFoundList(structuredClone([found, broken]));

    expect(parsed).toEqual([found, broken]);
  });

  it("answers an empty list for no answer", () => {
    expect(parseFoundList([])).toEqual([]);
  });

  it("drops unknown fields of an answer", () => {
    expect(parseFoundList([{ ...found, extra: 1 }])).toEqual([found]);
  });

  it("keeps the prop a key value sits on (G4)", () => {
    const tab: ProjectFound = {
      path: "features/ui/kit.tsx",
      key: "{id}",
      component: "Tab",
      kind: "idProp",
      prop: "id",
      line: 105,
      range: [104, 5, 112, 11],
      hash: "b2"
    };

    expect(parseFoundList(structuredClone([tab]))).toEqual([tab]);
  });

  it.each([
    ["a non-array", found],
    ["a 3-number range", [{ ...found, range: [300, 5, 318] }]],
    ["a range with a fraction", [{ ...found, range: [300, 5.5, 318, 7] }]],
    ["a missing hash", [{ ...found, hash: undefined }]],
    ["a missing path", [{ ...found, path: undefined }]],
    ["a line of 0", [{ ...found, line: 0 }]],
    ["an unknown kind", [{ ...found, kind: "spread" }]],
    ["broken false", [{ ...found, broken: false }]],
    ["a bad binding", [{ ...found, binding: 1 }]],
    ["a bad prop", [{ ...found, prop: 1 }]],
    ["one bad answer among good ones", [found, { ...found, line: "301" }]]
  ])("rejects %s", (_name, value) => {
    expect(parseFoundList(value)).toBeUndefined();
  });
});

describe("projectDelta", () => {
  const first: ProjectState = { state: "on", revision: "r1", defs: {}, uses: {}, broken: {} };
  const off: ProjectState = { state: "off", reason: "stopped" };

  it("a contiguous batch answers the arrays of its change", () => {
    expect(projectDelta(first, on)).toEqual({
      all: false,
      files: change.files,
      moved: change.moved,
      removed: []
    });
  });

  it("a contiguous state without a change answers empty arrays", () => {
    const quiet: ProjectState = { ...first, revision: "r2", previous: "r1" };

    expect(projectDelta(first, quiet)).toEqual({ all: false, files: [], moved: [], removed: [] });
  });

  it("a revision gap answers all", () => {
    const gap = { ...first, revision: "r0" };

    expect(projectDelta(gap, on).all).toBe(true);
  });

  it("the first state answers all", () => {
    expect(projectDelta(undefined, first)).toEqual({
      all: true,
      files: [],
      moved: [],
      removed: []
    });
  });

  it("a state without previous answers all", () => {
    expect(projectDelta(on, { ...first, revision: "r3" }).all).toBe(true);
  });

  it("an on state after off answers all", () => {
    expect(projectDelta(off, on).all).toBe(true);
  });

  it("an off state answers all", () => {
    expect(projectDelta(on, off).all).toBe(true);
  });
});

describe("firstDefinition", () => {
  it("answers the first def path of a key", () => {
    expect(firstDefinition(on, "textStyle:ui.number")).toBe("features/ui/text-styles.ts");
  });

  it("answers undefined for an unknown key, an off state or no state", () => {
    expect(firstDefinition(on, "node:board/nothing")).toBeUndefined();
    expect(firstDefinition({ state: "off", reason: "disabled" }, "flow:board")).toBeUndefined();
    expect(firstDefinition(undefined, "flow:board")).toBeUndefined();
  });
});

describe("anchorKey", () => {
  it("a const style block is a style key of its file", () => {
    expect(anchorKey({ kind: "const", name: "popupScreen" }, "features/ui/popup.tsx")).toBe(
      "style:features/ui/popup.tsx#popupScreen"
    );
  });

  it("a text style block is a textStyle key, whatever the file", () => {
    expect(anchorKey({ kind: "text", key: "ui.number" }, "features/ui/text-styles.ts")).toBe(
      "textStyle:ui.number"
    );
  });

  it("a call of a style function is the style key of the function or its property (G2)", () => {
    const icon = { kind: "call", name: "roundStylesOf.icon", line: 358, column: 11 } as const;
    expect(anchorKey(icon, "features/ui/kit.tsx")).toBe(
      "style:features/ui/kit.tsx#roundStylesOf.icon"
    );
    expect(anchorKey({ kind: "call", name: "plankStyle" }, "features/ui/kit.tsx")).toBe(
      "style:features/ui/kit.tsx#plankStyle"
    );
  });
});
