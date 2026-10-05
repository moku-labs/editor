/**
 * @file pages/mcp — the selection tools (U7, D-33): moku_selection reads what is selected in the
 * editor page (`editor.selection`, answered by the hub from the page's last publish) and
 * moku_select selects an element by key or every element inside an area (`editor.select`, relayed
 * by the hub to the editor page, which picks like the Reference picker). Both answer the
 * SelectionInfo as JSON and, when the page wrote one, its crop picture. Hub errors, such as
 * -32003 `no_editor_page` with the URL to open, pass through as readable `isError` results.
 */
import type { Json, SelectionInfo, SelectionRect } from "../../registry/protocol";
import { parseSelectionInfo } from "../../registry/protocol";
import { readPicture } from "./file-tools";
import { errorResult, imageItem, jsonText, textItem } from "./results";
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
const ONE_TARGET = "pass exactly one of key (an element) or rect (an area of the game page)";

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
 * The target of moku_select: the key or the rect, when exactly one of them is given.
 *
 * @param args - The checked arguments.
 * @returns `{ key }` or `{ rect }`, or undefined for neither or both.
 * @example
 * ```ts
 * targetOf({ key: "hud/coins" }); // { key: "hud/coins" }
 * targetOf({ key: "coins", rect: { x: 0, y: 0, w: 1, h: 1 } }); // undefined
 * ```
 */
function targetOf(
  args: JsonObject
): { readonly key: string } | { readonly rect: SelectionRect } | undefined {
  const key = textArgument(args, "key");
  const rect = rectArgument(args, "rect");
  if (key !== undefined && rect === undefined) return { key };
  if (rect !== undefined && key === undefined) return { rect };
  return undefined;
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
  if (asked !== undefined && info.session !== undefined && info.session !== asked) {
    const other = `Nothing is selected in session ${asked}; the selection belongs to session ${info.session}.`;
    return { content: [textItem(other)] };
  }
  return selectionResult(hub, info);
}

/**
 * moku_select: selects by key or by area in the editor page, with a card unless `card` is false,
 * and answers the selection with its crop. An area with no element is a valid selection: its text
 * starts with the line "No elements in the area.".
 *
 * @param call - The call: key or rect, card.
 * @param context - The tool context.
 * @returns The SelectionInfo as JSON and the crop image.
 */
async function select(call: ToolCall, context: ToolContext): Promise<ToolResult> {
  const target = targetOf(call.args);
  if (target === undefined) return errorResult(ONE_TARGET);

  const hub = await context.editor.hub();
  const card = flagArgument(call.args, "card", true);
  const info = readSelection(await hub.request("editor", "select", { ...target, card }), "select");
  return selectionResult(hub, info);
}

/**
 * moku_selection.
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
 * moku_select.
 */
export const selectTool: Tool = {
  name: "moku_select",
  title: "Select in the editor",
  description:
    "Selects an element in the editor page by its ui key, or every element inside an area (rect), the way a click or a drag of the Reference picker does: the Game view shows it, and with card (the default) a reference card and a crop picture are written. Answers the selection as JSON and the crop picture. Pass exactly one of key or rect. Needs the tools page open: without it the answer names the URL to open.",
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
