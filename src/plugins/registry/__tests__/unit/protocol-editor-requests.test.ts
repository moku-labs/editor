/* eslint-disable unicorn/no-null -- null is a wire value a parser must refuse */
import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  DeviceInfo,
  DeviceParams,
  DevicePresetInfo,
  DeviceSpec,
  EditorRequestMethod,
  EditorRequests,
  ErrorReason,
  NodeInfo,
  NodeParams,
  Orientation,
  RelayedEditorMethod,
  SelectionInfo,
  SelectParams,
  ShowInfo,
  ShowParams,
  WorkspaceName
} from "../../protocol";
import {
  decode,
  encode,
  errorCode,
  failure,
  isFailure,
  isResponse,
  isRetryable,
  parseDeviceInfo,
  parseDeviceParams,
  parseNodeInfo,
  parseNodeParams,
  parseShowInfo,
  parseShowParams,
  toWireError,
  WORKSPACE_NAMES,
  wireError
} from "../../protocol";

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

/** A phone row of the preset list. */
const pixel: DevicePresetInfo = {
  id: "pixel-8",
  name: "Pixel 8",
  group: "android",
  kind: "phone",
  w: 412,
  h: 915,
  foldable: false
};

/** A foldable row: the cover screen and `foldable: true`. */
const fold: DevicePresetInfo = {
  id: "galaxy-z-fold-6",
  name: "Galaxy Z Fold 6",
  group: "foldable",
  kind: "phone",
  w: 369,
  h: 968,
  foldable: true
};

/** The smallest DeviceInfo: no preset rows. */
const bareDevice: DeviceInfo = {
  preset: "pixel-8",
  orientation: "portrait",
  folded: true,
  w: 412,
  h: 915,
  presets: []
};

/** A DeviceInfo after a change to landscape, with the preset list. */
const fullDevice: DeviceInfo = {
  preset: "pixel-8",
  orientation: "landscape",
  folded: true,
  w: 915,
  h: 412,
  presets: [pixel, fold]
};

/**
 * A copy of a record without one field.
 *
 * @param record - The record.
 * @param field - The field to leave out.
 * @returns The copy.
 */
function without(record: object, field: string): object {
  return Object.fromEntries(Object.entries(record).filter(([key]) => key !== field));
}

/** The values no parser takes as an object. */
const NOT_OBJECTS: readonly unknown[] = [undefined, null, "device", 7, true, [], [{}]];

// ─────────────────────────────────────────────────────────────────────────────
// WORKSPACE_NAMES
// ─────────────────────────────────────────────────────────────────────────────

describe("WORKSPACE_NAMES", () => {
  it("lists the six workspaces in rail order", () => {
    expect(WORKSPACE_NAMES).toEqual(["flow", "game", "render", "state", "files", "console"]);
  });

  it("is a readonly list of WorkspaceName", () => {
    expectTypeOf(WORKSPACE_NAMES).toEqualTypeOf<readonly WorkspaceName[]>();
    expectTypeOf<WorkspaceName>().toEqualTypeOf<
      "flow" | "game" | "render" | "state" | "files" | "console"
    >();
    expect(new Set(WORKSPACE_NAMES).size).toBe(6);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseDeviceParams
// ─────────────────────────────────────────────────────────────────────────────

describe("parseDeviceParams", () => {
  it("accepts empty params: a read that changes nothing", () => {
    expect(parseDeviceParams({})).toEqual({});
  });

  it("accepts the full shape", () => {
    const params = { preset: "pixel-8", orientation: "landscape", folded: false };

    expect(parseDeviceParams(params)).toEqual(params);
  });

  it("accepts each field alone", () => {
    expect(parseDeviceParams({ preset: "ipad-mini" })).toEqual({ preset: "ipad-mini" });
    expect(parseDeviceParams({ orientation: "portrait" })).toEqual({ orientation: "portrait" });
    expect(parseDeviceParams({ folded: true })).toEqual({ folded: true });
  });

  it("leaves the preset id to the page: an unknown id is a string like any other", () => {
    expect(parseDeviceParams({ preset: "nokia-3310" })).toEqual({ preset: "nokia-3310" });
  });

  it("rejects an extra field", () => {
    expect(parseDeviceParams({ preset: "pixel-8", zoom: 2 })).toBeUndefined();
  });

  it("rejects a __proto__ key of a parsed JSON text: it is an own key like any other", () => {
    const value: unknown = JSON.parse('{"__proto__":{"preset":"pixel-8"},"folded":true}');

    expect(parseDeviceParams(value)).toBeUndefined();
  });

  it("rejects a wrong type", () => {
    expect(parseDeviceParams({ preset: 8 })).toBeUndefined();
    expect(parseDeviceParams({ orientation: "sideways" })).toBeUndefined();
    expect(parseDeviceParams({ orientation: 90 })).toBeUndefined();
    expect(parseDeviceParams({ folded: "yes" })).toBeUndefined();
  });

  it("rejects a field present with undefined", () => {
    expect(parseDeviceParams({ preset: undefined })).toBeUndefined();
    expect(parseDeviceParams({ folded: undefined })).toBeUndefined();
  });

  it("rejects a value that is not an object", () => {
    for (const value of NOT_OBJECTS) expect(parseDeviceParams(value)).toBeUndefined();
  });

  it("returns a copy", () => {
    const params = { preset: "pixel-8", orientation: "landscape", folded: false };
    const parsed = parseDeviceParams(params);

    expect(parsed).not.toBe(params);
    params.preset = "desktop";
    expect(parsed?.preset).toBe("pixel-8");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseShowParams
// ─────────────────────────────────────────────────────────────────────────────

describe("parseShowParams", () => {
  it("accepts empty params: a read that changes nothing", () => {
    expect(parseShowParams({})).toEqual({});
  });

  it("accepts every workspace of the list", () => {
    for (const workspace of WORKSPACE_NAMES) {
      expect(parseShowParams({ workspace })).toEqual({ workspace });
    }
  });

  it("rejects a workspace outside the list", () => {
    expect(parseShowParams({ workspace: "settings" })).toBeUndefined();
    expect(parseShowParams({ workspace: "Flow" })).toBeUndefined();
    expect(parseShowParams({ workspace: "" })).toBeUndefined();
  });

  it("rejects an extra field", () => {
    expect(parseShowParams({ workspace: "state", focus: true })).toBeUndefined();
  });

  it("rejects a wrong type", () => {
    expect(parseShowParams({ workspace: 2 })).toBeUndefined();
    expect(parseShowParams({ workspace: ["flow"] })).toBeUndefined();
    expect(parseShowParams({ workspace: undefined })).toBeUndefined();
  });

  it("rejects a value that is not an object", () => {
    for (const value of NOT_OBJECTS) expect(parseShowParams(value)).toBeUndefined();
  });

  it("returns a copy", () => {
    const params = { workspace: "state" };
    const parsed = parseShowParams(params);

    expect(parsed).not.toBe(params);
    params.workspace = "files";
    expect(parsed?.workspace).toBe("state");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseNodeParams
// ─────────────────────────────────────────────────────────────────────────────

describe("parseNodeParams", () => {
  it("accepts a node id", () => {
    expect(parseNodeParams({ id: "main/home" })).toEqual({ id: "main/home" });
  });

  it("accepts an id of 1 and of 256 chars", () => {
    const longest = "n".repeat(256);

    expect(parseNodeParams({ id: "n" })).toEqual({ id: "n" });
    expect(parseNodeParams({ id: longest })).toEqual({ id: longest });
  });

  it("rejects an empty id and an id of 257 chars", () => {
    expect(parseNodeParams({ id: "" })).toBeUndefined();
    expect(parseNodeParams({ id: "n".repeat(257) })).toBeUndefined();
  });

  it("rejects params without an id", () => {
    expect(parseNodeParams({})).toBeUndefined();
    expect(parseNodeParams({ id: undefined })).toBeUndefined();
  });

  it("rejects an extra field", () => {
    expect(parseNodeParams({ id: "main/home", expand: true })).toBeUndefined();
  });

  it("rejects a wrong type", () => {
    expect(parseNodeParams({ id: 7 })).toBeUndefined();
    expect(parseNodeParams({ id: { flow: "main", node: "home" } })).toBeUndefined();
  });

  it("rejects a value that is not an object", () => {
    for (const value of NOT_OBJECTS) expect(parseNodeParams(value)).toBeUndefined();
  });

  it("returns a copy", () => {
    const params = { id: "main/home" };
    const parsed = parseNodeParams(params);

    expect(parsed).not.toBe(params);
    params.id = "main/shop";
    expect(parsed?.id).toBe("main/home");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseDeviceInfo
// ─────────────────────────────────────────────────────────────────────────────

describe("parseDeviceInfo", () => {
  it("accepts the minimal shape: no preset rows", () => {
    expect(parseDeviceInfo(bareDevice)).toEqual(bareDevice);
  });

  it("accepts the full shape with the preset list", () => {
    expect(parseDeviceInfo(fullDevice)).toEqual(fullDevice);
  });

  it("accepts every group and kind of a DeviceSpec", () => {
    const groups: DeviceSpec["group"][] = ["iphone", "android", "foldable", "tablet", "desktop"];
    const kinds: DeviceSpec["kind"][] = ["phone", "tablet", "desktop"];

    for (const group of groups) {
      const info = { ...bareDevice, presets: [{ ...pixel, group }] };
      expect(parseDeviceInfo(info)).toEqual(info);
    }
    for (const kind of kinds) {
      const info = { ...bareDevice, presets: [{ ...pixel, kind }] };
      expect(parseDeviceInfo(info)).toEqual(info);
    }
  });

  it("rejects an extra field, at the top and in a preset row", () => {
    expect(parseDeviceInfo({ ...bareDevice, dpr: 3 })).toBeUndefined();
    expect(parseDeviceInfo({ ...bareDevice, presets: [{ ...pixel, radius: 30 }] })).toBeUndefined();
  });

  it("rejects a missing field", () => {
    const row = without(pixel, "foldable");

    expect(parseDeviceInfo(without(bareDevice, "folded"))).toBeUndefined();
    expect(parseDeviceInfo(without(bareDevice, "presets"))).toBeUndefined();
    expect(parseDeviceInfo({ ...bareDevice, presets: [row] })).toBeUndefined();
    expect(parseDeviceInfo(without(bareDevice, "zoom"))).toEqual(bareDevice);
  });

  it("rejects a wrong type at the top", () => {
    expect(parseDeviceInfo({ ...bareDevice, preset: 8 })).toBeUndefined();
    expect(parseDeviceInfo({ ...bareDevice, orientation: "sideways" })).toBeUndefined();
    expect(parseDeviceInfo({ ...bareDevice, folded: 1 })).toBeUndefined();
    expect(parseDeviceInfo({ ...bareDevice, w: "412" })).toBeUndefined();
    expect(parseDeviceInfo({ ...bareDevice, h: Number.NaN })).toBeUndefined();
    expect(parseDeviceInfo({ ...bareDevice, presets: { 0: pixel } })).toBeUndefined();
  });

  it("rejects a wrong type in a preset row", () => {
    const rows: readonly unknown[] = [
      { ...pixel, id: 8 },
      { ...pixel, name: undefined },
      { ...pixel, group: "console" },
      { ...pixel, kind: "watch" },
      { ...pixel, w: Number.POSITIVE_INFINITY },
      { ...pixel, h: "915" },
      { ...pixel, foldable: "no" },
      "pixel-8",
      null
    ];

    for (const row of rows) {
      expect(parseDeviceInfo({ ...bareDevice, presets: [pixel, row] })).toBeUndefined();
    }
  });

  it("rejects a value that is not an object", () => {
    for (const value of NOT_OBJECTS) expect(parseDeviceInfo(value)).toBeUndefined();
  });

  it("returns a copy: the list and its rows are fresh", () => {
    const row = { ...pixel };
    const presets = [row];
    const info = { ...bareDevice, presets };
    const parsed = parseDeviceInfo(info);

    expect(parsed).not.toBe(info);
    expect(parsed?.presets).not.toBe(presets);
    expect(parsed?.presets[0]).not.toBe(row);

    row.name = "changed";
    presets.push(fold);
    expect(parsed?.presets).toEqual([pixel]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseShowInfo
// ─────────────────────────────────────────────────────────────────────────────

describe("parseShowInfo", () => {
  it("accepts the active workspace with the list", () => {
    const info = { workspace: "state", workspaces: [...WORKSPACE_NAMES] };

    expect(parseShowInfo(info)).toEqual(info);
  });

  it("accepts an empty list", () => {
    expect(parseShowInfo({ workspace: "flow", workspaces: [] })).toEqual({
      workspace: "flow",
      workspaces: []
    });
  });

  it("rejects a workspace outside the list, active or listed", () => {
    expect(parseShowInfo({ workspace: "settings", workspaces: ["flow"] })).toBeUndefined();
    expect(parseShowInfo({ workspace: "flow", workspaces: ["flow", "settings"] })).toBeUndefined();
  });

  it("rejects an extra field", () => {
    expect(parseShowInfo({ workspace: "flow", workspaces: ["flow"], badge: 3 })).toBeUndefined();
  });

  it("rejects a missing field and a wrong type", () => {
    expect(parseShowInfo({ workspace: "flow" })).toBeUndefined();
    expect(parseShowInfo({ workspaces: ["flow"] })).toBeUndefined();
    expect(parseShowInfo({ workspace: 0, workspaces: ["flow"] })).toBeUndefined();
    expect(parseShowInfo({ workspace: "flow", workspaces: "flow" })).toBeUndefined();
    expect(parseShowInfo({ workspace: "flow", workspaces: [0] })).toBeUndefined();
  });

  it("rejects a value that is not an object", () => {
    for (const value of NOT_OBJECTS) expect(parseShowInfo(value)).toBeUndefined();
  });

  it("returns a copy: the list is fresh", () => {
    const workspaces = ["flow", "game"];
    const info = { workspace: "flow", workspaces };
    const parsed = parseShowInfo(info);

    expect(parsed).not.toBe(info);
    expect(parsed?.workspaces).not.toBe(workspaces);

    workspaces.push("state");
    expect(parsed?.workspaces).toEqual(["flow", "game"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseNodeInfo
// ─────────────────────────────────────────────────────────────────────────────

describe("parseNodeInfo", () => {
  it("accepts the node id with the focused item key", () => {
    const info = { id: "board/merge", selected: "main/board>board/merge" };

    expect(parseNodeInfo(info)).toEqual(info);
  });

  it("rejects an extra field", () => {
    expect(parseNodeInfo({ id: "main/home", selected: "main/home", open: true })).toBeUndefined();
  });

  it("rejects a missing field and a wrong type", () => {
    expect(parseNodeInfo({ id: "main/home" })).toBeUndefined();
    expect(parseNodeInfo({ selected: "main/home" })).toBeUndefined();
    expect(parseNodeInfo({ id: 7, selected: "main/home" })).toBeUndefined();
    expect(parseNodeInfo({ id: "main/home", selected: null })).toBeUndefined();
    expect(parseNodeInfo({ id: "main/home", selected: undefined })).toBeUndefined();
  });

  it("rejects a value that is not an object", () => {
    for (const value of NOT_OBJECTS) expect(parseNodeInfo(value)).toBeUndefined();
  });

  it("returns a copy", () => {
    const info = { id: "main/home", selected: "main/home" };
    const parsed = parseNodeInfo(info);

    expect(parsed).not.toBe(info);
    info.selected = "main/shop";
    expect(parsed?.selected).toBe("main/home");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Errors of the node request
// ─────────────────────────────────────────────────────────────────────────────

describe("node request errors", () => {
  it("decode keeps the no_graph reason of a retryable -32003 answer", () => {
    const thrown = wireError(errorCode.noSession, "the Flow view has no graph yet", {
      reason: "no_graph",
      retryable: true
    });
    const message = decode(encode(failure(7, toWireError(thrown))));

    if (!isResponse(message) || !isFailure(message)) throw new Error("expected an error response");
    expect(message.error).toEqual({
      code: -32_003,
      message: "[moku-editor] the Flow view has no graph yet",
      data: { reason: "no_graph", retryable: true }
    });
    expect(isRetryable(message.error)).toBe(true);
  });

  it("ErrorReason holds no_graph", () => {
    const reasons: ErrorReason[] = ["no_graph"];

    expectTypeOf<"no_graph">().toExtend<ErrorReason>();
    expect(reasons).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

describe("editor request types", () => {
  it("EditorRequests types device, show and node by params and result", () => {
    expectTypeOf<EditorRequests["device"]["params"]>().toEqualTypeOf<DeviceParams>();
    expectTypeOf<EditorRequests["device"]["result"]>().toEqualTypeOf<DeviceInfo>();
    expectTypeOf<EditorRequests["show"]["params"]>().toEqualTypeOf<ShowParams>();
    expectTypeOf<EditorRequests["show"]["result"]>().toEqualTypeOf<ShowInfo>();
    expectTypeOf<EditorRequests["node"]["params"]>().toEqualTypeOf<NodeParams>();
    expectTypeOf<EditorRequests["node"]["result"]>().toEqualTypeOf<NodeInfo>();

    // select keeps its shape.
    expectTypeOf<EditorRequests["select"]["params"]>().toEqualTypeOf<SelectParams>();
    expectTypeOf<EditorRequests["select"]["result"]>().toEqualTypeOf<SelectionInfo>();

    const methods: EditorRequestMethod[] = ["selection", "select", "device", "show", "node"];
    expect(methods).toHaveLength(5);
  });

  it("RelayedEditorMethod is exactly the four methods the hub relays", () => {
    expectTypeOf<RelayedEditorMethod>().toEqualTypeOf<"select" | "device" | "show" | "node">();
    expectTypeOf<RelayedEditorMethod>().toExtend<EditorRequestMethod>();
    expectTypeOf<Exclude<EditorRequestMethod, RelayedEditorMethod>>().toEqualTypeOf<"selection">();

    const relayed: RelayedEditorMethod[] = ["select", "device", "show", "node"];
    expect(relayed).toHaveLength(4);
  });

  it("the params are closed readonly shapes", () => {
    expectTypeOf<DeviceParams>().toEqualTypeOf<{
      readonly preset?: string;
      readonly orientation?: Orientation;
      readonly folded?: boolean;
    }>();
    expectTypeOf<ShowParams>().toEqualTypeOf<{ readonly workspace?: WorkspaceName }>();
    expectTypeOf<NodeParams>().toEqualTypeOf<{ readonly id: string }>();

    const read: DeviceParams = {};
    expect(read.preset).toBeUndefined();
  });

  it("the results carry the state after the change", () => {
    expectTypeOf<DeviceInfo>().toEqualTypeOf<{
      readonly preset: string;
      readonly orientation: Orientation;
      readonly folded: boolean;
      readonly w: number;
      readonly h: number;
      readonly presets: readonly DevicePresetInfo[];
    }>();
    expectTypeOf<DevicePresetInfo>().toEqualTypeOf<{
      readonly id: string;
      readonly name: string;
      readonly group: DeviceSpec["group"];
      readonly kind: DeviceSpec["kind"];
      readonly w: number;
      readonly h: number;
      readonly foldable: boolean;
    }>();
    expectTypeOf<ShowInfo>().toEqualTypeOf<{
      readonly workspace: WorkspaceName;
      readonly workspaces: readonly WorkspaceName[];
    }>();
    expectTypeOf<NodeInfo>().toEqualTypeOf<{ readonly id: string; readonly selected: string }>();

    expect(fullDevice.presets).toHaveLength(2);
  });

  it("the parsers answer their type or undefined", () => {
    expectTypeOf(parseDeviceParams).toEqualTypeOf<(value: unknown) => DeviceParams | undefined>();
    expectTypeOf(parseShowParams).toEqualTypeOf<(value: unknown) => ShowParams | undefined>();
    expectTypeOf(parseNodeParams).toEqualTypeOf<(value: unknown) => NodeParams | undefined>();
    expectTypeOf(parseDeviceInfo).toEqualTypeOf<(value: unknown) => DeviceInfo | undefined>();
    expectTypeOf(parseShowInfo).toEqualTypeOf<(value: unknown) => ShowInfo | undefined>();
    expectTypeOf(parseNodeInfo).toEqualTypeOf<(value: unknown) => NodeInfo | undefined>();

    expect(parseNodeInfo({ id: "main/home", selected: "main/home" })?.id).toBe("main/home");
  });
});
