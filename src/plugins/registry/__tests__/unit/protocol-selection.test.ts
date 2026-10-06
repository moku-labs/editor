/* eslint-disable unicorn/no-null -- null is the wire value of "nothing is selected" */
import { describe, expect, expectTypeOf, it } from "vitest";
import type { ElementRef, PageRect } from "../../../panels/shared/scene";
import type {
  EditorNotificationMethod,
  EditorNotifications,
  EditorRequestMethod,
  EditorRequests,
  ErrorReason,
  HotReload,
  Json,
  ProjectState,
  PublishMethod,
  PublishParams,
  SelectionInfo,
  SelectionItem,
  SelectionRect,
  SelectionRef,
  SelectParams,
  SessionParams,
  SessionsParams
} from "../../protocol";
import {
  decode,
  encode,
  errorCode,
  failure,
  isFailure,
  isResponse,
  isRetryable,
  isSelectionInfo,
  notification,
  parseSelectionInfo,
  parseSelectParams,
  toWireError,
  toWireValue,
  wireError
} from "../../protocol";

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

/** The smallest SelectionInfo: a ui element with the four required fields. */
const minimal: SelectionInfo = {
  ref: { kind: "ui", path: "column#0/hudRow/coins" },
  name: "coins",
  type: "text",
  at: 1_790_000_000_000
};

/** A SelectionInfo after a picker click: every field set. */
const picked: SelectionInfo = {
  ref: { kind: "ui", path: "column#0/hudRow/coins" },
  key: "coins",
  projection: "hud",
  name: "coins",
  type: "text",
  rect: { x: 12, y: 40, w: 96, h: 24 },
  source: { path: "src/ui/hud.ts", line: 42 },
  card: ".moku/editor/captures/coins-1840.md",
  crop: ".moku/editor/captures/coins-1840-crop.jpg",
  line: "@moku ui:column#0/hudRow/coins hud.ts:42",
  session: "s-7f3a",
  frame: 1840,
  at: 1_790_000_000_000
};

/** An area selection of two group elements (U9). */
const area: SelectionInfo = {
  ref: { kind: "ui", path: "column#0/hudRow" },
  name: "area",
  type: "area",
  rect: { x: 0, y: 30, w: 200, h: 60 },
  area: { x: 0, y: 30, w: 200, h: 60 },
  items: [
    {
      ref: { kind: "ui", path: "column#0/hudRow/coins" },
      key: "coins",
      name: "coins",
      type: "text",
      rect: { x: 12, y: 40, w: 96, h: 24 },
      source: { path: "src/ui/hud.ts", line: 42 }
    },
    { ref: { kind: "entity", id: 7 }, name: "slime", type: "entity" }
  ],
  frame: 1840,
  at: 1
};

/** An area with no element inside. */
const emptyArea: SelectionInfo = {
  ref: { kind: "ui", path: "" },
  name: "area",
  type: "area",
  rect: { x: 0, y: 0, w: 10, h: 10 },
  area: { x: 0, y: 0, w: 10, h: 10 },
  items: [],
  at: 1
};

/** The JSON text of the full selection, as the wire carries it. */
const pickedText = JSON.stringify(picked);

/** An entity selection. */
const entity: SelectionInfo = {
  ref: { kind: "entity", id: 7 },
  name: "slime",
  type: "entity",
  at: 1
};

// ─────────────────────────────────────────────────────────────────────────────
// isSelectionInfo
// ─────────────────────────────────────────────────────────────────────────────

describe("isSelectionInfo", () => {
  it("accepts the minimal, the full and the entity selection", () => {
    expect(isSelectionInfo(minimal)).toBe(true);
    expect(isSelectionInfo(picked)).toBe(true);
    expect(isSelectionInfo(entity)).toBe(true);
  });

  it("accepts a selection that went through JSON", () => {
    expect(isSelectionInfo(JSON.parse(pickedText))).toBe(true);
  });

  it("ignores unknown fields", () => {
    expect(isSelectionInfo({ ...picked, zoom: 2, extra: { a: 1 } })).toBe(true);
    expect(isSelectionInfo({ ...minimal, ref: { kind: "ui", path: "a", depth: 3 } })).toBe(true);
  });

  it("accepts an area selection and an empty one", () => {
    expect(isSelectionInfo(area)).toBe(true);
    expect(isSelectionInfo(emptyArea)).toBe(true);
    expect(isSelectionInfo({ ...area, items: [{ ...area.items?.[0], zoom: 2 }] })).toBe(true);
  });

  it.each([
    ["area missing w", { area: { x: 0, y: 0, h: 1 } }],
    ["area null", { area: null }],
    ["items not an array", { items: { 0: minimal } }],
    ["item not an object", { items: ["coins"] }],
    ["item without a name", { items: [{ ref: { kind: "ui", path: "a" }, type: "text" }] }],
    ["item with a bad ref", { items: [{ ref: { kind: "ui" }, name: "a", type: "text" }] }],
    ["item with a number key", { items: [{ ...minimal, key: 1 }] }],
    ["item with a bad rect", { items: [{ ...minimal, rect: { x: 0 } }] }],
    ["item with a bad source", { items: [{ ...minimal, source: { path: "a.ts" } }] }]
  ])("rejects an area selection with a bad %s", (_label, patch) => {
    expect(isSelectionInfo({ ...area, ...patch })).toBe(false);
  });

  it.each([
    ["null", null],
    ["a string", "coins"],
    ["an array", [minimal]],
    ["undefined", undefined]
  ])("rejects %s", (_label, value) => {
    expect(isSelectionInfo(value)).toBe(false);
  });

  it.each([
    "ref",
    "name",
    "type",
    "at"
  ] as const)("rejects a selection without the required %s", field => {
    const rest = Object.fromEntries(Object.entries(picked).filter(([key]) => key !== field));

    expect(isSelectionInfo(rest)).toBe(false);
  });

  it.each([
    ["ref kind", { ref: { kind: "node", path: "a" } }],
    ["ui ref without a path", { ref: { kind: "ui" } }],
    ["ui ref with a number path", { ref: { kind: "ui", path: 3 } }],
    ["entity ref with a string id", { ref: { kind: "entity", id: "7" } }],
    ["entity ref with a fraction id", { ref: { kind: "entity", id: 1.5 } }],
    ["ref that is a string", { ref: "ui:coins" }],
    ["name", { name: 1 }],
    ["type", { type: null }],
    ["at", { at: "now" }],
    ["at NaN", { at: Number.NaN }],
    ["key", { key: 1 }],
    ["projection", { projection: false }],
    ["card", { card: {} }],
    ["crop", { crop: 2 }],
    ["line", { line: ["@moku"] }],
    ["session", { session: 0 }],
    ["frame", { frame: "1840" }],
    ["rect missing h", { rect: { x: 0, y: 0, w: 1 } }],
    ["rect with a string", { rect: { x: 0, y: "0", w: 1, h: 1 } }],
    ["rect infinite", { rect: { x: 0, y: 0, w: Number.POSITIVE_INFINITY, h: 1 } }],
    ["rect null", { rect: null }],
    ["source without a line", { source: { path: "a.ts" } }],
    ["source with a string line", { source: { path: "a.ts", line: "4" } }],
    ["source path", { source: { path: 4, line: 4 } }],
    ["key present but undefined", { key: undefined }]
  ])("rejects a bad %s", (_label, patch) => {
    expect(isSelectionInfo({ ...picked, ...patch })).toBe(false);
  });

  it("narrows the value to SelectionInfo", () => {
    const value: unknown = JSON.parse(pickedText);

    if (!isSelectionInfo(value)) throw new Error("expected a selection");
    expectTypeOf(value).toEqualTypeOf<SelectionInfo>();
    expect(value.ref.kind === "ui" && value.ref.path).toBe("column#0/hudRow/coins");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseSelectionInfo
// ─────────────────────────────────────────────────────────────────────────────

describe("parseSelectionInfo", () => {
  it("returns an equal, fresh copy of a valid selection", () => {
    const copy = parseSelectionInfo(picked);

    expect(copy).toEqual(picked);
    expect(copy).not.toBe(picked);
    expect(copy?.ref).not.toBe(picked.ref);
    expect(copy?.rect).not.toBe(picked.rect);
    expect(copy?.source).not.toBe(picked.source);
  });

  it("drops unknown fields, at the top and in the nested objects", () => {
    const copy = parseSelectionInfo({
      ...entity,
      zoom: 2,
      ref: { kind: "entity", id: 7, owner: "world" },
      rect: { x: 1, y: 2, w: 3, h: 4, z: 5 },
      source: { path: "a.ts", line: 1, column: 9 }
    });

    expect(copy).toEqual({
      ...entity,
      rect: { x: 1, y: 2, w: 3, h: 4 },
      source: { path: "a.ts", line: 1 }
    });
  });

  it("keeps optional fields absent, not undefined", () => {
    const copy = parseSelectionInfo(minimal);

    expect(Object.keys(copy ?? {})).toEqual(["ref", "name", "type", "at"]);
  });

  it("copies the area and the items, fresh, without unknown fields", () => {
    const copy = parseSelectionInfo({
      ...area,
      area: { ...area.area, z: 1 },
      items: [
        {
          ...area.items?.[0],
          at: 5,
          frame: 3,
          zoom: 2,
          ref: { kind: "ui", path: "column#0/hudRow/coins", depth: 1 },
          rect: { x: 12, y: 40, w: 96, h: 24, z: 0 },
          source: { path: "src/ui/hud.ts", line: 42, column: 3 }
        },
        area.items?.[1]
      ]
    });

    expect(copy).toEqual(area);
    expect(copy?.area).not.toBe(area.area);
    expect(copy?.items).not.toBe(area.items);
    expect(copy?.items?.[0]).not.toBe(area.items?.[0]);
    expect(copy?.items?.[0]?.rect).not.toBe(area.items?.[0]?.rect);
    expect(Object.keys(copy?.items?.[1] ?? {})).toEqual(["ref", "name", "type"]);
  });

  it("keeps an empty item list", () => {
    expect(parseSelectionInfo(emptyArea)).toEqual(emptyArea);
  });

  it("returns undefined for a value that is not a selection", () => {
    expect(parseSelectionInfo(null)).toBeUndefined();
    expect(parseSelectionInfo({ ...minimal, at: "now" })).toBeUndefined();
  });

  it.each([
    ["a pick", picked],
    ["an area", area]
  ])("the copy of %s survives toWireValue, encode and decode", (_label, info) => {
    const copy = parseSelectionInfo(info);
    if (copy === undefined) throw new Error("expected a selection");

    const params = toWireValue(copy);
    const message = decode(encode(notification("editor", "selection", params)));

    expect("params" in message && parseSelectionInfo(message.params)).toEqual(info);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseSelectParams
// ─────────────────────────────────────────────────────────────────────────────

describe("parseSelectParams", () => {
  it("accepts a key, a ref and the card flag", () => {
    expect(parseSelectParams({ key: "hud/infoBar" })).toEqual({ key: "hud/infoBar" });
    expect(parseSelectParams({ ref: { kind: "entity", id: 3 }, card: false })).toEqual({
      ref: { kind: "entity", id: 3 },
      card: false
    });
    expect(parseSelectParams({})).toEqual({});
  });

  it("copies an area rect, fresh and without unknown fields", () => {
    const rect = { x: 0, y: 30, w: 200, h: 60, z: 1 };
    const params = parseSelectParams({ rect, key: "coins", card: true });

    expect(params).toEqual({ rect: { x: 0, y: 30, w: 200, h: 60 }, key: "coins", card: true });
    expect(params?.rect).not.toBe(rect);
  });

  it("drops unknown fields and keeps absent fields absent", () => {
    const params = parseSelectParams({ key: "coins", ref: { kind: "ui", path: "a", x: 1 }, z: 1 });

    expect(params).toEqual({ key: "coins", ref: { kind: "ui", path: "a" } });
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["an array", ["coins"]],
    ["a number key", { key: 1 }],
    ["a bad ref", { ref: { kind: "ui", path: 1 } }],
    ["a string card", { card: "yes" }],
    ["a rect without h", { rect: { x: 0, y: 0, w: 1 } }],
    ["a rect of strings", { rect: { x: "0", y: "0", w: "1", h: "1" } }]
  ])("returns undefined for %s", (_label, value) => {
    expect(parseSelectParams(value)).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Errors of the selection relay (A4)
// ─────────────────────────────────────────────────────────────────────────────

describe("selection relay errors", () => {
  it.each([
    ["no_editor_page", errorCode.noEditorPage, false],
    ["page_closed", errorCode.pageClosed, true]
  ] as const)("decode keeps the %s reason of a %i answer", (reason, code, retryable) => {
    const error = toWireError(wireError(code, "editor.select failed", { reason, retryable }));
    const message = decode(encode(failure(4, error)));

    if (!isResponse(message) || !isFailure(message)) throw new Error("expected an error response");
    expect(message.error).toEqual({
      code,
      message: "[moku-editor] editor.select failed",
      data: { reason, retryable }
    });
    expect(isRetryable(message.error)).toBe(retryable);
  });

  it("ErrorReason holds both reasons", () => {
    const reasons: ErrorReason[] = ["no_editor_page", "page_closed"];

    expectTypeOf<"no_editor_page" | "page_closed">().toExtend<ErrorReason>();
    expect(reasons).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Types: SelectionInfo, publish, the editor channel
// ─────────────────────────────────────────────────────────────────────────────

describe("selection types", () => {
  it("SelectionRef and SelectionRect are the scene's ElementRef and PageRect", () => {
    expectTypeOf<SelectionRef>().toEqualTypeOf<ElementRef>();
    expectTypeOf<SelectionRect>().toEqualTypeOf<PageRect>();
    expectTypeOf<SelectionInfo["ref"]>().toEqualTypeOf<SelectionRef>();
    expectTypeOf<SelectionInfo["rect"]>().toEqualTypeOf<SelectionRect | undefined>();

    const ref: ElementRef = picked.ref;
    expect(ref.kind).toBe("ui");
  });

  it("SelectionInfo is readonly; its readonly items make senders use toWireValue", () => {
    const info: SelectionInfo = { ...picked };
    // @ts-expect-error -- readonly items are not the mutable Json, like Manifest
    const json: Json = area;
    // @ts-expect-error -- every field is readonly
    info.at = 2;

    expect(toWireValue(info)).toEqual({ ...picked, at: 2 });
    expect(json).toBe(area);
  });

  it("PublishMethod is hotReload, selection or project, typed by PublishParams", () => {
    expectTypeOf<PublishMethod>().toEqualTypeOf<"hotReload" | "selection" | "project">();
    expectTypeOf<PublishParams["hotReload"]>().toEqualTypeOf<HotReload>();
    expectTypeOf<PublishParams["selection"]>().toEqualTypeOf<SelectionInfo | null>();
    expectTypeOf<PublishParams["project"]>().toEqualTypeOf<ProjectState>();

    const params: PublishParams = {
      hotReload: { hmr: true, owner: "bin" },
      selection: null,
      project: { state: "off", reason: "disabled" }
    };
    expect(params.selection).toBeNull();
  });

  it("SelectionInfo carries an optional area and items of SelectionItem", () => {
    expectTypeOf<SelectionInfo["area"]>().toEqualTypeOf<SelectionRect | undefined>();
    expectTypeOf<SelectionInfo["items"]>().toEqualTypeOf<readonly SelectionItem[] | undefined>();
    expectTypeOf<SelectionItem>().toEqualTypeOf<{
      readonly ref: SelectionRef;
      readonly key?: string;
      readonly name: string;
      readonly type: string;
      readonly rect?: SelectionRect;
      readonly source?: { readonly path: string; readonly line: number };
    }>();
    expectTypeOf<SelectionItem>().toExtend<Json>();

    expect(area.items).toHaveLength(2);
  });

  it("SelectParams has an optional key, ref, rect and card", () => {
    expectTypeOf<SelectParams>().toEqualTypeOf<{
      readonly key?: string;
      readonly ref?: SelectionRef;
      readonly rect?: SelectionRect;
      readonly card?: boolean;
    }>();

    const params: SelectParams = { key: "coins" };
    expect(params.card).toBeUndefined();
  });

  it("the editor channel names its notifications and requests", () => {
    expectTypeOf<EditorNotificationMethod>().toEqualTypeOf<
      "session" | "sessions" | "hotReload" | "selection" | "project"
    >();
    expectTypeOf<EditorNotifications["selection"]>().toEqualTypeOf<SelectionInfo | null>();
    expectTypeOf<EditorNotifications["hotReload"]>().toEqualTypeOf<HotReload>();
    expectTypeOf<EditorNotifications["session"]>().toEqualTypeOf<SessionParams>();
    expectTypeOf<EditorNotifications["sessions"]>().toEqualTypeOf<SessionsParams>();

    expectTypeOf<EditorRequestMethod>().toEqualTypeOf<"selection" | "select">();
    expectTypeOf<EditorRequests["selection"]["result"]>().toEqualTypeOf<SelectionInfo | null>();
    expectTypeOf<EditorRequests["select"]["params"]>().toEqualTypeOf<SelectParams>();
    expectTypeOf<EditorRequests["select"]["result"]>().toEqualTypeOf<SelectionInfo>();

    const methods: EditorRequestMethod[] = ["selection", "select"];
    expect(methods).toHaveLength(2);
  });
});
