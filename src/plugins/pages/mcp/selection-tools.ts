/**
 * @file pages/mcp — the selection tools (U7, D-33): moku_selection reads what is selected in the
 * editor page (`editor.selection`, answered by the hub from the page's last publish) and
 * moku_select selects an element by key or every element inside an area (`editor.select`, relayed
 * by the hub to the editor page, which picks like the Reference picker). Both answer the
 * SelectionInfo as JSON and, when the page wrote one, its crop picture. Hub errors, such as
 * -32003 `no_editor_page` with the URL to open, pass through as readable `isError` results.
 *
 * moku_select also selects a node of the flow graph (`node`, D-61), in three steps the page shows:
 * `editor.show { workspace: "flow" }`, `editor.node { id }`, then `files.find { key: "node:<id>" }`
 * for its source places. A node has no rect, crop or card, so that answer is `{ id, selected,
 * places }`, not a SelectionInfo.
 */
import type {
  Json,
  NodeInfo,
  SelectionInfo,
  SelectionRect,
  WireError
} from "../../registry/protocol";
import {
  bareMessage,
  isWireError,
  parseNodeInfo,
  parseSelectionInfo,
  parseShowInfo
} from "../../registry/protocol";
import { askPage } from "./editor-tools";
import { placesIfIndexed, readPicture } from "./file-tools";
import { errorResult, imageItem, jsonResult, jsonText, textItem } from "./results";
import {
  flagArgument,
  READ_ONLY,
  RECT_PROPERTY,
  rectArgument,
  SESSION_PROPERTY,
  textArgument
} from "./schema";
import type { HubClient, JsonObject, Tool, ToolCall, ToolContext, ToolResult } from "./types";

/**
 * The answer of moku_selection when nothing is selected.
 */
const NOTHING_SELECTED = "Nothing is selected in the editor.";

/**
 * The first line of a selection whose area held no element (U9: still a card and a picture).
 */
const EMPTY_AREA = "No elements in the area.";

/**
 * The error of moku_select without exactly one target.
 */
const ONE_TARGET =
  "pass exactly one of key (an element), rect (an area of the game page) or node (a node of the flow graph)";

/**
 * The error of moku_select with `card` next to `node`.
 */
const NO_NODE_CARD = "card does not go with node: a flow node has no reference card";

/**
 * The longest node id moku_select takes, in characters: the limit of `editor.node`.
 */
const NODE_ID_MAX = 256;

/**
 * What moku_select selects: an element by key, an area, or a node of the flow graph.
 */
type Target =
  | { readonly key: string }
  | { readonly rect: SelectionRect }
  | { readonly node: string };

/**
 * Reads the SelectionInfo an editor request answered.
 *
 * @param value - The answer.
 * @param method - The editor method, for the message.
 * @returns The checked SelectionInfo.
 * @throws {Error} `[moku-editor] editor.<method> answered no selection.` for another shape.
 * @example
 * ```ts
 * readSelection(await hub.request("editor", "select", { key: "coins", card: true }), "select").name; // "coins"
 * ```
 */
function readSelection(value: Json, method: string): SelectionInfo {
  const info = parseSelectionInfo(value);
  if (info === undefined) throw new Error(`[moku-editor] editor.${method} answered no selection.`);
  return info;
}

/**
 * The crop picture of a selection, read through the hub, when the page wrote one.
 *
 * @param hub - The hub connection.
 * @param info - The selection.
 * @returns The data URL, or undefined.
 */
async function cropOf(hub: HubClient, info: SelectionInfo): Promise<string | undefined> {
  return info.crop === undefined ? undefined : readPicture(hub, info.crop);
}

/**
 * True for an area selection with no element inside: its ref is a ui ref with an empty path.
 *
 * @param info - The selection.
 * @returns Whether the area held no element.
 * @example
 * ```ts
 * isEmptyArea({ ref: { kind: "ui", path: "" }, name: "area", type: "area", at: 1 }); // true
 * ```
 */
function isEmptyArea(info: SelectionInfo): boolean {
  return info.ref.kind === "ui" && info.ref.path === "";
}

/**
 * The target of moku_select: the key, the rect or the node, when exactly one of them is given.
 *
 * @param args - The checked arguments.
 * @returns `{ key }`, `{ rect }` or `{ node }`, or undefined for none or more than one.
 * @example
 * ```ts
 * targetOf({ key: "hud/coins" }); // { key: "hud/coins" }
 * targetOf({ node: "main/home" }); // { node: "main/home" }
 * targetOf({ key: "coins", rect: { x: 0, y: 0, w: 1, h: 1 } }); // undefined
 * ```
 */
function targetOf(args: JsonObject): Target | undefined {
  const key = textArgument(args, "key");
  const rect = rectArgument(args, "rect");
  const node = textArgument(args, "node");
  const targets: Target[] = [];
  if (key !== undefined) targets.push({ key });
  if (rect !== undefined) targets.push({ rect });
  if (node !== undefined) targets.push({ node });
  return targets.length === 1 ? targets[0] : undefined;
}

/**
 * The result of a selection: its JSON (after the line "No elements in the area." for an empty
 * area), then its crop image when the page wrote one and it can be read.
 *
 * @param hub - The hub connection.
 * @param info - The selection.
 * @returns The text item and the image.
 */
async function selectionResult(hub: HubClient, info: SelectionInfo): Promise<ToolResult> {
  const json = jsonText(info);
  const text = textItem(isEmptyArea(info) ? `${EMPTY_AREA}\n${json}` : json);
  const crop = await cropOf(hub, info);
  const image = crop === undefined ? undefined : imageItem(crop);
  return { content: image === undefined ? [text] : [text, image] };
}

/**
 * moku_selection: the selection the hub keeps, with its crop; nothing selected, or a selection of
 * another session than the one asked, is a plain message.
 *
 * @param call - The call: session.
 * @param context - The tool context.
 * @returns The SelectionInfo as JSON and the crop image, or the message.
 */
async function selection(call: ToolCall, context: ToolContext): Promise<ToolResult> {
  const hub = await context.editor.hub();
  const asked = textArgument(call.args, "session");
  const answer = await hub.request("editor", "selection", {});
  if (answer === null) return { content: [textItem(NOTHING_SELECTED)] };

  const info = readSelection(answer, "selection");
  const isOtherSession =
    asked !== undefined && info.session !== undefined && info.session !== asked;
  if (isOtherSession) {
    const other = `Nothing is selected in session ${asked}; the selection belongs to session ${info.session}.`;
    return { content: [textItem(other)] };
  }
  return selectionResult(hub, info);
}

/**
 * True for the -32003 `no_graph` of `editor.node`: the Flow view has no graph yet. Retryable.
 *
 * @param error - The thrown value.
 * @returns Whether the node can be selected a moment later.
 * @example
 * ```ts
 * isNoGraph(wireError(-32_003, "the Flow view has no graph yet", { reason: "no_graph", retryable: true })); // true
 * ```
 */
function isNoGraph(error: unknown): error is WireError {
  return isWireError(error) && error.data?.reason === "no_graph";
}

/**
 * Selects a node of the flow graph in the editor page, in the three steps the page shows: the Flow
 * workspace, the node, then its source places from the project index (left out while the index is
 * off). The Flow view without a graph yet reads as `isError` with "try again".
 *
 * @param hub - The hub connection.
 * @param id - The node id, such as `main/home`.
 * @returns `{ id, selected, places }` as JSON; `{ id, selected }` while the index is off.
 */
async function selectNode(hub: HubClient, id: string): Promise<ToolResult> {
  await askPage(hub, "show", { workspace: "flow" }, parseShowInfo);

  let node: NodeInfo;
  try {
    node = await askPage(hub, "node", { id }, parseNodeInfo);
  } catch (error) {
    if (!isNoGraph(error)) throw error;
    const reason = bareMessage(error.message).replace(/\.$/, "");
    return errorResult(`${reason}; try again in a moment`);
  }

  const places = await placesIfIndexed(hub, `node:${node.id}`);
  return jsonResult(places === undefined ? node : { ...node, places });
}

/**
 * moku_select: selects by key or by area in the editor page, with a card unless `card` is false,
 * and answers the selection with its crop. An area with no element is a valid selection: its text
 * starts with the line "No elements in the area.". With `node` it selects a node of the flow graph
 * instead (`selectNode`); `card` does not go with it.
 *
 * @param call - The call: key, rect or node, and card.
 * @param context - The tool context.
 * @returns The SelectionInfo as JSON and the crop image; `{ id, selected, places }` for a node.
 */
async function select(call: ToolCall, context: ToolContext): Promise<ToolResult> {
  const target = targetOf(call.args);
  if (target === undefined) return errorResult(ONE_TARGET);
  if ("node" in target) {
    if (call.args.card !== undefined) return errorResult(NO_NODE_CARD);
    return selectNode(await context.editor.hub(), target.node);
  }

  const hub = await context.editor.hub();
  const card = flagArgument(call.args, "card", true);
  const info = readSelection(await hub.request("editor", "select", { ...target, card }), "select");
  return selectionResult(hub, info);
}

/**
 * moku_selection: tells an MCP client what is selected in the editor page now (by the Reference
 * picker or by moku_select), as SelectionInfo JSON plus its crop picture. Read-only; a session
 * argument limits the answer to that session.
 */
export const selectionTool: Tool = {
  name: "moku_selection",
  title: "Editor selection",
  description:
    "What is selected in the editor page now (picked with the Reference picker, or by moku_select): ref, key, name, type, rect in game page CSS px, source file and line, the reference card and its one-line @moku reference, as JSON, and the element's crop picture when one was taken. An area selection lists its elements in items.",
  inputSchema: {
    type: "object",
    properties: { session: SESSION_PROPERTY },
    additionalProperties: false
  },
  annotations: READ_ONLY,
  run: selection
};

/**
 * moku_select: lets an MCP client select an element by ui key, or every element inside a rect,
 * in the editor page, the way the Reference picker does. With `card` (the default) the page writes
 * the reference card and the crop; the answer is the selection as JSON plus the crop picture. With
 * `node` it selects a node of the flow graph: the page opens the Flow workspace and focuses the
 * node, and the answer names the node's source places.
 */
export const selectTool: Tool = {
  name: "moku_select",
  title: "Select in the editor",
  description:
    "Selects an element in the editor page by its ui key, or every element inside an area (rect), the way a click or a drag of the Reference picker does: the Game view shows it, and with card (the default) a reference card and a crop picture are written. Answers the selection as JSON and the crop picture. Or selects a node of the flow graph (node): the tools page opens the Flow workspace and focuses the node, and the answer is { id, selected, places }, where places are the node's source files and lines; card does not go with node. Pass exactly one of key, rect or node. Needs the tools page open: without it the answer names the URL to open.",
  inputSchema: {
    type: "object",
    properties: {
      key: {
        type: "string",
        minLength: 1,
        description:
          'A ui element key, projection-qualified like "hud/infoBar" allowed: the first element with that key.'
      },
      rect: RECT_PROPERTY,
      node: {
        type: "string",
        minLength: 1,
        maxLength: NODE_ID_MAX,
        description:
          'A node of the flow graph by id, such as "main/home": its flow and its name. moku_project { prefix: "node:" } lists them.'
      },
      card: {
        type: "boolean",
        default: true,
        description: "Write the reference card and the crop picture, as after a picker click."
      }
    },
    additionalProperties: false
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false
  },
  run: select
};
