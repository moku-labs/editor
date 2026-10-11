/* eslint-disable unicorn/no-null -- null is the selection the hub answers when nothing is selected */
import { afterEach, describe, expect, it } from "vitest";
import type { Json } from "../../../../registry/protocol";
import { wireError } from "../../../../registry/protocol";
import { checkArguments } from "../../../mcp/schema";
import { selectionTool, selectTool } from "../../../mcp/selection-tools";
import { session, until } from "../../fake-hub";
import type { ToolSetup } from "../../mcp-tools";
import { jpegOf, jsonOf, textAt, toolSetup } from "../../mcp-tools";

// ─────────────────────────────────────────────────────────────────────────────
// pages/mcp selection tools (U7, D-33): moku_selection reads the selection the
// hub keeps (editor.selection), moku_select relays a select by key or by area
// to the editor page (editor.select). Both answer the SelectionInfo as JSON and
// its crop picture; hub errors (no editor page) pass through readable. With
// `node`, moku_select opens the Flow workspace, focuses the node and names its
// source places (editor.show, editor.node, files.find; D-61).
// ─────────────────────────────────────────────────────────────────────────────

let setup: ToolSetup | undefined;

afterEach(async () => {
  await setup?.cleanup();
  setup = undefined;
});

/** The setup of a test, kept for the cleanup. */
async function ready(options: Parameters<typeof toolSetup>[0] = {}): Promise<ToolSetup> {
  setup = await toolSetup({ sessions: [session("s-1")], ...options });
  return setup;
}

/** What moku_select answers without exactly one target. */
const ONE_TARGET =
  "pass exactly one of key (an element), rect (an area of the game page) or node (a node of the flow graph)";

/** The crop picture the fake hub serves. */
const CROP = jpegOf(96, 64);

/** The coins label as selected without a card: no card and no crop. */
const ELEMENT = {
  ref: { kind: "ui", path: "column#0/hudRow/coins" },
  key: "coins",
  projection: "hud",
  name: "coins",
  type: "text",
  rect: { x: 12, y: 40, w: 96, h: 24 },
  source: { path: "src/ui/hud.ts", line: 42 },
  line: "@moku ui:column#0/hudRow/coins hud.ts:42",
  session: "s-1",
  frame: 1840,
  at: 1_790_000_000_000
};

/** The coins label after a pick: its card and its crop are written. */
const PICKED = {
  ...ELEMENT,
  card: ".moku/captures/coins-f1840.md",
  crop: ".moku/captures/coins-f1840-crop.jpg"
};

/** An area selection with no element inside: its ref has an empty ui path. */
const EMPTY_AREA = {
  ref: { kind: "ui", path: "" },
  name: "area",
  type: "area",
  rect: { x: 0, y: 0, w: 40, h: 40 },
  area: { x: 0, y: 0, w: 40, h: 40 },
  items: [],
  crop: ".moku/captures/area-f12-crop.jpg",
  at: 1
};

/** The crop image item of CROP. */
const CROP_ITEM = {
  type: "image",
  data: CROP.slice("data:image/jpeg;base64,".length),
  mimeType: "image/jpeg"
};

/**
 * Serves the crop picture through files.readBinary.
 *
 * @param current - The setup.
 */
function serveCrop(current: ToolSetup): void {
  current.hub.handle("files.readBinary", () => ({ dataUrl: CROP, version: "v1" }));
}

describe("moku_selection", () => {
  it("answers a plain message when nothing is selected", async () => {
    const { run, hub } = await ready();
    hub.handle("editor.selection", () => null);
    const { result } = await run(selectionTool);
    expect(result).toEqual({
      content: [{ type: "text", text: "Nothing is selected in the editor." }]
    });
    expect(hub.requests).toEqual([
      { channel: "editor", method: "selection", params: {}, session: undefined }
    ]);
  });

  it("answers the selection as JSON and its crop as an image", async () => {
    const current = await ready();
    current.hub.handle("editor.selection", () => ({ ...PICKED, zoom: 2 }));
    serveCrop(current);
    const { result } = await current.run(selectionTool);
    expect(jsonOf(result)).toEqual(PICKED);
    expect(result.content[1]).toEqual(CROP_ITEM);
    expect(result.isError).toBeUndefined();
    expect(current.hub.requests.at(-1)).toMatchObject({
      channel: "files",
      method: "readBinary",
      params: { path: PICKED.crop }
    });
  });

  it("answers the text alone without a crop, or when the crop cannot be read", async () => {
    const current = await ready();
    current.hub.handle("editor.selection", () => ELEMENT);
    const plain = await current.run(selectionTool);
    expect(plain.result.content).toHaveLength(1);
    expect(current.hub.requests.some(entry => entry.method === "readBinary")).toBe(false);

    current.hub.handle("editor.selection", () => PICKED);
    current.hub.handle("files.readBinary", () => {
      throw new Error("not found");
    });
    const gone = await current.run(selectionTool);
    expect(gone.result.content).toHaveLength(1);
    expect(jsonOf(gone.result)).toEqual(PICKED);
  });

  it("never reads a crop that points at the bin's private files", async () => {
    const current = await ready();
    current.hub.handle("editor.selection", () => ({ ...PICKED, crop: ".moku/editor.json" }));
    const { result } = await current.run(selectionTool);
    expect(result.content).toHaveLength(1);
    expect(current.hub.requests.some(entry => entry.method === "readBinary")).toBe(false);
  });

  it("names the session the selection belongs to when another one is asked", async () => {
    const current = await ready();
    current.hub.handle("editor.selection", () => PICKED);
    const { result } = await current.run(selectionTool, { session: "s-2" });
    expect(textAt(result)).toBe(
      "Nothing is selected in session s-2; the selection belongs to session s-1."
    );
    const same = await current.run(selectionTool, { session: "s-1" });
    expect(jsonOf(same.result)).toEqual(PICKED);
  });

  it("answers isError for an answer that is not a selection", async () => {
    const { run, hub } = await ready();
    hub.handle("editor.selection", () => ({ name: "coins" }));
    const { result } = await run(selectionTool);
    expect(result).toEqual({
      content: [{ type: "text", text: "editor.selection answered no selection." }],
      isError: true
    });
  });

  it("only reads", () => {
    expect(selectionTool.annotations).toEqual({ readOnlyHint: true, openWorldHint: false });
  });

  it("takes only an optional session id", () => {
    expect(selectionTool.inputSchema).toEqual({
      type: "object",
      properties: {
        session: { type: "string", minLength: 1, description: expect.any(String) }
      },
      additionalProperties: false
    });
  });
});

describe("moku_select", () => {
  it("selects by key with a card by default and answers the selection and its crop", async () => {
    const current = await ready();
    current.hub.handle("editor.select", () => PICKED);
    serveCrop(current);
    const { result } = await current.run(selectTool, { key: "hud/coins" });
    expect(current.hub.requests[0]).toEqual({
      channel: "editor",
      method: "select",
      params: { key: "hud/coins", card: true },
      session: undefined
    });
    expect(jsonOf(result)).toEqual(PICKED);
    expect(result.content[1]).toEqual(CROP_ITEM);
  });

  it("selects an area by rect, without a card when asked", async () => {
    const current = await ready();
    const area = { ...ELEMENT, type: "area", name: "area", area: ELEMENT.rect, items: [] };
    current.hub.handle("editor.select", () => area);
    const rect = { x: 0, y: 30, w: 200, h: 60 };
    const { result } = await current.run(selectTool, { rect, card: false });
    expect(current.hub.requests[0]?.params).toEqual({ rect, card: false });
    expect(jsonOf(result)).toMatchObject({ type: "area", items: [] });
    expect(result.content).toHaveLength(1);
  });

  it("answers an area with no element as a valid selection, with the area's picture", async () => {
    const current = await ready();
    current.hub.handle("editor.select", () => EMPTY_AREA);
    serveCrop(current);
    const { result } = await current.run(selectTool, { rect: { x: 0, y: 0, w: 40, h: 40 } });
    const [first, ...json] = textAt(result).split("\n");
    expect(first).toBe("No elements in the area.");
    expect(JSON.parse(json.join("\n"))).toEqual(EMPTY_AREA);
    expect(result.content[1]).toEqual(CROP_ITEM);
    expect(result.isError).toBeUndefined();
  });

  it.each([
    ["neither key, rect nor node", {}],
    ["both key and rect", { key: "coins", rect: { x: 0, y: 0, w: 1, h: 1 } }],
    ["both key and node", { key: "coins", node: "main/home" }],
    ["both rect and node", { rect: { x: 0, y: 0, w: 1, h: 1 }, node: "main/home" }],
    ["key, rect and node", { key: "coins", rect: { x: 0, y: 0, w: 1, h: 1 }, node: "main/home" }]
  ])("answers isError for %s, without a request", async (_case, args: Json) => {
    const { run, hub } = await ready();
    const { result } = await run(selectTool, args);
    expect(result).toEqual({ content: [{ type: "text", text: ONE_TARGET }], isError: true });
    expect(hub.requests).toEqual([]);
  });

  it("passes the hub's no_editor_page error through, with the editor page URL", async () => {
    const { run, hub } = await ready();
    hub.handle("editor.select", () => {
      throw wireError(
        -32_003,
        "no editor page is open. Open the editor page: http://127.0.0.1:3000/__editor/",
        { reason: "no_editor_page", retryable: false }
      );
    });
    const { result } = await run(selectTool, { key: "coins" });
    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: "no editor page is open. Open the editor page: http://127.0.0.1:3000/__editor/"
        }
      ],
      isError: true
    });
  });

  it("answers isError for an answer that is not a selection", async () => {
    const { run, hub } = await ready();
    hub.handle("editor.select", () => null);
    const { result } = await run(selectTool, { key: "coins" });
    expect(textAt(result)).toBe("editor.select answered no selection.");
    expect(result.isError).toBe(true);
  });

  it("changes the editor page but destroys nothing", () => {
    expect(selectTool.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    });
  });

  it("takes a key, a rect or a node and the card flag, none of them required by the schema", () => {
    const side = (minimum: number) => ({
      type: "number",
      minimum,
      description: expect.any(String)
    });
    expect(selectTool.inputSchema).toEqual({
      type: "object",
      properties: {
        key: { type: "string", minLength: 1, description: expect.any(String) },
        rect: {
          type: "object",
          description: expect.any(String),
          properties: { x: side(0), y: side(0), w: side(1), h: side(1) },
          required: ["x", "y", "w", "h"],
          additionalProperties: false
        },
        node: { type: "string", minLength: 1, maxLength: 256, description: expect.any(String) },
        card: { type: "boolean", default: true, description: expect.any(String) }
      },
      additionalProperties: false
    });
    expect(checkArguments(selectTool.inputSchema, { node: "n".repeat(257) })).toBe(
      "node must be at most 256 characters"
    );
  });
});

/** The place of the node main/home, as files.find answers it. */
const HOME_PLACE = {
  path: "nodes/home.ts",
  binding: "home",
  line: 12,
  range: [12, 1, 40, 3],
  hash: "9c1e"
};

/** The workspaces of the rail, in rail order. */
const WORKSPACES = ["flow", "game", "render", "state", "files", "console"];

/**
 * Answers the three requests of a node selection: the Flow workspace, the focused node and its
 * places.
 *
 * @param current - The setup.
 */
function serveNode(current: ToolSetup): void {
  const { hub } = current;
  hub.handle("editor.show", () => ({ workspace: "flow", workspaces: WORKSPACES }));
  hub.handle("editor.node", () => ({ id: "main/home", selected: "node:main/home" }));
  hub.handle("files.find", () => [HOME_PLACE]);
}

describe("moku_select { node }", () => {
  it("opens the Flow workspace, focuses the node and finds its places, in that order", async () => {
    const current = await ready();
    serveNode(current);
    const { result } = await current.run(selectTool, { node: "main/home" });
    expect(current.hub.requests).toEqual([
      { channel: "editor", method: "show", params: { workspace: "flow" }, session: undefined },
      { channel: "editor", method: "node", params: { id: "main/home" }, session: undefined },
      { channel: "files", method: "find", params: { key: "node:main/home" }, session: undefined }
    ]);
    expect(jsonOf(result)).toEqual({
      id: "main/home",
      selected: "node:main/home",
      places: [{ path: "nodes/home.ts", binding: "home", line: 12, hash: "9c1e" }]
    });
    expect(result.content).toHaveLength(1);
    expect(result.isError).toBeUndefined();
  });

  it("answers { id, selected } without asking for places while the project index is off", async () => {
    const current = await ready({ project: { state: "off", reason: "disabled" } });
    await until(() => current.client.project() !== undefined, "the published project state");
    serveNode(current);
    const { result } = await current.run(selectTool, { node: "main/home" });
    expect(jsonOf(result)).toEqual({ id: "main/home", selected: "node:main/home" });
    expect(current.hub.requests.map(entry => entry.method)).toEqual(["show", "node"]);
  });

  it("answers { id, selected } when files.find says the index is off", async () => {
    const current = await ready();
    serveNode(current);
    current.hub.handle("files.find", () => {
      throw wireError(-32_008, "project index off: not opened", { reason: "not_installed" });
    });
    const { result } = await current.run(selectTool, { node: "main/home" });
    expect(jsonOf(result)).toEqual({ id: "main/home", selected: "node:main/home" });
    expect(result.isError).toBeUndefined();
  });

  it("answers another failure of files.find as isError", async () => {
    const current = await ready();
    serveNode(current);
    current.hub.handle("files.find", () => {
      throw wireError(-32_002, "the project index did not answer in 5 s", {
        reason: "timeout",
        retryable: true
      });
    });
    const { result } = await current.run(selectTool, { node: "main/home" });
    expect(result).toEqual({
      content: [{ type: "text", text: "the project index did not answer in 5 s" }],
      isError: true
    });
  });

  it("answers an empty places list for a node the index does not know", async () => {
    const current = await ready();
    serveNode(current);
    current.hub.handle("files.find", () => []);
    const { result } = await current.run(selectTool, { node: "main/home" });
    expect(jsonOf(result)).toEqual({ id: "main/home", selected: "node:main/home", places: [] });
  });

  it("answers isError for card with node, without a request", async () => {
    const current = await ready();
    serveNode(current);
    for (const card of [true, false]) {
      const { result } = await current.run(selectTool, { node: "main/home", card });
      expect(result).toEqual({
        content: [
          { type: "text", text: "card does not go with node: a flow node has no reference card" }
        ],
        isError: true
      });
    }
    expect(current.hub.requests).toEqual([]);
  });

  it("reads the retryable no_graph as isError with try again, and asks for no places", async () => {
    const current = await ready();
    serveNode(current);
    current.hub.handle("editor.node", () => {
      throw wireError(-32_003, "the Flow view has no graph yet", {
        reason: "no_graph",
        retryable: true
      });
    });
    const { result } = await current.run(selectTool, { node: "main/home" });
    expect(result).toEqual({
      content: [{ type: "text", text: "the Flow view has no graph yet; try again in a moment" }],
      isError: true
    });
    expect(current.hub.requests.map(entry => entry.method)).toEqual(["show", "node"]);
  });

  it("passes the page's refusal of an unknown node through", async () => {
    const current = await ready();
    serveNode(current);
    current.hub.handle("editor.node", () => {
      throw wireError(-32_602, "unknown node main/nope", {
        reason: "invalid_input",
        field: "id"
      });
    });
    const { result } = await current.run(selectTool, { node: "main/nope" });
    expect(result).toEqual({
      content: [{ type: "text", text: "unknown node main/nope" }],
      isError: true
    });
  });

  it("stops at the first step without an editor page, and tells an older page to reload", async () => {
    const current = await ready();
    serveNode(current);
    current.hub.handle("editor.show", () => {
      throw wireError(
        -32_003,
        "no editor page is open. Open the editor page: http://127.0.0.1:3000/__editor/",
        { reason: "no_editor_page", retryable: false }
      );
    });
    const closed = await current.run(selectTool, { node: "main/home" });
    expect(textAt(closed.result)).toBe(
      "no editor page is open. Open the editor page: http://127.0.0.1:3000/__editor/"
    );
    expect(closed.result.isError).toBe(true);
    expect(current.hub.requests.map(entry => entry.method)).toEqual(["show"]);

    serveNode(current);
    current.hub.handle("editor.node", () => {
      throw wireError(-32_601, "unknown method editor.node: this page has no handler", {
        retryable: false
      });
    });
    const older = await current.run(selectTool, { node: "main/home" });
    expect(older.result).toEqual({
      content: [{ type: "text", text: "this editor page is older than the bridge; reload it" }],
      isError: true
    });
  });
});
