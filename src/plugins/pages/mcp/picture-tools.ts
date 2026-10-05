/**
 * @file pages/mcp — the picture tools (M5, M7): moku_screenshot (`editor.capture { maxWidth }`),
 * moku_series (`editor.sheet { frames, everyMs, maxWidth }`, or `game.capture { sheet }` when the
 * agent has no editor.sheet; game ≥ 0.4) and moku_reference (a reference card of `.moku/captures`
 * with its crop). Screenshot and series check liveness first: a paused or hidden game gets a
 * message, not a timeout.
 */
import { statSync } from "node:fs";
import { dirname, join } from "node:path/posix";
import type { FileEntry, Json } from "../../registry/protocol";
import { isPrivatePath } from "./file-tools";
import { withProgress } from "./progress";
import { errorResult, imageItem, imageKb, isTooLarge, pictureResult, textItem } from "./results";
import { numberArgument, READ_ONLY, SESSION_PROPERTY, textArgument } from "./schema";
import { livenessProblem } from "./sessions";
import {
  commandOf,
  dataUrlOf,
  pictureOf,
  pngWidth,
  readFileEntries,
  readFileText,
  readRunResult,
  readShot
} from "./shapes";
import type { HubClient, Tool, ToolCall, ToolContext, ToolResult } from "./types";

/**
 * Where the editor writes captures and reference cards (gameView's default `capturesDir`).
 */
export const CAPTURES_DIR = ".moku/captures";

/**
 * The default `maxWidth` of moku_screenshot.
 */
const DEFAULT_MAX_WIDTH = 1080;

/**
 * The narrowest picture editor.capture makes.
 */
const MIN_WIDTH = 64;

/**
 * The widest picture editor.capture makes.
 */
const MAX_WIDTH = 4096;

/**
 * The link to the crop in a reference card: `![element](<file>)`.
 */
const CROP_LINK = /!\[element\]\(([^)\s]+)\)/;

/**
 * One editor.capture shot.
 */
type Shot = { readonly image: string; readonly frame: number; readonly device: Json };

/**
 * The sheet option of a contact sheet: how many pictures, how far apart in game time.
 */
type SheetOption = { readonly frames: number; readonly everyMs: number };

/**
 * A contact sheet as moku_series shows it: the picture, the frame after the last picture and,
 * when the agent shrank it, the width it was shrunk to.
 */
type TakenSheet = { readonly image: string; readonly frame: number; readonly maxWidth?: number };

/**
 * The no-picture message of moku_series.
 */
const NO_SHEET =
  "game.capture gave no picture: the renderer is inert, headless or this is not a dev build";

/**
 * Runs editor.capture once.
 *
 * @param hub - The hub connection.
 * @param maxWidth - The widest picture wanted.
 * @param session - The session, if asked for.
 * @returns The shot.
 * @throws {Error} When the answer carries no picture.
 */
async function captureShot(
  hub: HubClient,
  maxWidth: number,
  session: string | undefined
): Promise<Shot> {
  const input = { maxWidth };
  const ran = await hub.request("game", "run", { id: "editor.capture", input }, session);
  const shot = readShot(readRunResult(ran)?.value ?? ran);
  if (shot === undefined) throw new Error("[moku-editor] editor.capture answered no picture.");
  return shot;
}

/**
 * The size note of a picture that stayed larger than a result carries comfortably.
 *
 * @param image - The data URL.
 * @returns `{ note }` when it is too large, else `{}`.
 * @example
 * ```ts
 * sizeNote(sheet); // { note: "the picture is 1981.9 KB, above the 300 KB a result should carry" }
 * ```
 */
function sizeNote(image: string): { note?: string } {
  if (!isTooLarge(image)) return {};
  return {
    note: `the picture is ${String(imageKb(image))} KB, above the 300 KB a result should carry`
  };
}

/**
 * moku_screenshot: liveness, then editor.capture at `maxWidth`; a picture above about 300 KB is
 * taken once more at half its width (half of `maxWidth`, or of the picture when it is narrower).
 *
 * @param call - The call: maxWidth, session.
 * @param context - The tool context.
 * @returns A text item (frame, device, width, KB) and the image.
 */
async function screenshot(call: ToolCall, context: ToolContext): Promise<ToolResult> {
  const hub = await context.editor.hub();
  const session = textArgument(call.args, "session");
  const problem = livenessProblem(hub.sessions(), session);
  if (problem !== undefined) return errorResult(problem);

  const asked = numberArgument(call.args, "maxWidth", DEFAULT_MAX_WIDTH);
  let maxWidth = asked;
  let shot = await captureShot(hub, maxWidth, session);
  // Half of what came back: a picture narrower than maxWidth is halved from its own width.
  const width = Math.min(asked, pngWidth(shot.image) ?? asked);
  const half = Math.max(MIN_WIDTH, Math.floor(width / 2));
  if (isTooLarge(shot.image) && half < width) {
    maxWidth = half;
    shot = await captureShot(hub, maxWidth, session);
  }

  const facts = { frame: shot.frame, device: shot.device, maxWidth, kb: imageKb(shot.image) };
  return pictureResult({ ...facts, ...sizeNote(shot.image) }, shot.image);
}

/**
 * Runs editor.sheet once: the agent takes the sheet and shrinks it to DEFAULT_MAX_WIDTH in the
 * page, so it travels small.
 *
 * @param hub - The hub connection.
 * @param sheet - Frames and everyMs.
 * @param session - The session, if asked for.
 * @returns The sheet, or undefined when the answer carries no picture.
 */
async function editorSheet(
  hub: HubClient,
  sheet: SheetOption,
  session: string | undefined
): Promise<TakenSheet | undefined> {
  const input = { ...sheet, maxWidth: DEFAULT_MAX_WIDTH };
  const ran = await hub.request("game", "run", { id: "editor.sheet", input }, session);
  const shot = readShot(readRunResult(ran)?.value ?? ran);
  return shot === undefined
    ? undefined
    : { image: shot.image, frame: shot.frame, maxWidth: DEFAULT_MAX_WIDTH };
}

/**
 * Runs `game.capture { sheet }` once, for an agent without editor.sheet: the sheet comes at full
 * size (`{ png }` or the data URL itself, the pictureOf rule).
 *
 * @param hub - The hub connection.
 * @param sheet - Frames and everyMs.
 * @param session - The session, if asked for.
 * @returns The sheet, or undefined when the answer carries no picture.
 */
async function gameSheet(
  hub: HubClient,
  sheet: SheetOption,
  session: string | undefined
): Promise<TakenSheet | undefined> {
  const input = { sheet: { ...sheet } };
  const result = readRunResult(
    await hub.request("game", "run", { id: "game.capture", input }, session)
  );
  const picture = result === undefined ? undefined : pictureOf(result.value);
  return result === undefined || picture === undefined
    ? undefined
    : { image: picture, frame: result.state.frame };
}

/**
 * moku_series: liveness, a game ≥ 0.4 check, then one contact sheet: `editor.sheet` (shrunk to
 * 1080 px wide by the agent) when the agent has it, else `game.capture { sheet }` at full size.
 *
 * @param call - The call: frames, everyMs, session.
 * @param context - The tool context.
 * @returns A text item (frames, everyMs, columns, frame, maxWidth when shrunk, KB) and the sheet.
 */
async function series(call: ToolCall, context: ToolContext): Promise<ToolResult> {
  const hub = await context.editor.hub();
  const session = textArgument(call.args, "session");
  const problem = livenessProblem(hub.sessions(), session);
  if (problem !== undefined) return errorResult(problem);

  const manifest = await hub.request("game", "manifest", {}, session);
  const capture = commandOf(manifest, "game.capture");
  if (capture === undefined || !Object.hasOwn(capture.input, "sheet")) {
    return errorResult(
      "moku_series needs game.capture with a sheet option: @moku-labs/game 0.4 or newer"
    );
  }

  const frames = numberArgument(call.args, "frames", 6);
  const everyMs = numberArgument(call.args, "everyMs", 500);
  const take = commandOf(manifest, "editor.sheet") === undefined ? gameSheet : editorSheet;
  const taken = await withProgress(call, frames * everyMs, context.now, () =>
    take(hub, { frames, everyMs }, session)
  );
  if (taken === undefined) return errorResult(NO_SHEET);

  const { image, frame, maxWidth } = taken;
  const columns = Math.ceil(Math.sqrt(frames));
  const shrunk = maxWidth === undefined ? {} : { maxWidth };
  const facts = { frames, everyMs, columns, frame, ...shrunk, kb: imageKb(image) };
  return pictureResult({ ...facts, ...sizeNote(image) }, image);
}

/**
 * The reference cards (`*.md`) in CAPTURES_DIR; an unreadable folder has none.
 *
 * @param hub - The hub connection.
 * @returns The card entries.
 */
async function listCards(hub: HubClient): Promise<FileEntry[]> {
  try {
    const entries = readFileEntries(await hub.request("files", "list", { dir: CAPTURES_DIR }));
    return entries.filter(entry => entry.kind === "file" && entry.path.endsWith(".md"));
  } catch (error) {
    if (!hub.isOpen()) throw error;
    return [];
  }
}

/**
 * The modification time of a file under the bin's root; 0 when it cannot be read.
 *
 * @param root - The bin's root.
 * @param path - The relative path.
 * @returns Epoch ms.
 * @example
 * ```ts
 * modifiedAt("/games/merge", ".moku/captures/claim-f25.md"); // 1790000000000
 * ```
 */
function modifiedAt(root: string, path: string): number {
  try {
    return statSync(join(root, path)).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * The card a moku_reference id names: "latest" is the newest file, else the path, the name or
 * the name without `.md`.
 *
 * @param cards - The card entries.
 * @param id - The id argument.
 * @param root - The bin's root (for the modification times).
 * @returns The card, or undefined.
 * @example
 * ```ts
 * cardOf(cards, "claim-f25", root)?.path; // ".moku/captures/claim-f25.md"
 * ```
 */
function cardOf(cards: readonly FileEntry[], id: string, root: string): FileEntry | undefined {
  if (id === "latest") {
    const dated = cards.map(card => ({ card, at: modifiedAt(root, card.path) }));
    return dated.toSorted((left, right) => right.at - left.at)[0]?.card;
  }
  const name = id.replace(/^\.\//, "");
  const wanted = new Set([name, `${CAPTURES_DIR}/${name}`, `${CAPTURES_DIR}/${name}.md`]);
  return cards.find(card => wanted.has(card.path));
}

/**
 * The crop image a card links, read through the hub; none when the card has no crop link, the
 * link points at the bin's private files, or the file cannot be read.
 *
 * @param hub - The hub connection.
 * @param card - The card path.
 * @param text - The card text.
 * @returns The data URL, or undefined.
 */
async function cropOf(hub: HubClient, card: string, text: string): Promise<string | undefined> {
  const name = CROP_LINK.exec(text)?.[1];
  const path = name === undefined ? undefined : `${dirname(card)}/${name}`;
  if (path === undefined || isPrivatePath(path)) return undefined;
  try {
    return dataUrlOf(await hub.request("files", "readBinary", { path }));
  } catch {
    return undefined;
  }
}

/**
 * moku_reference: the newest or a named reference card and its crop.
 *
 * @param call - The call: id.
 * @param context - The tool context.
 * @returns The card text and the crop image.
 */
async function reference(call: ToolCall, context: ToolContext): Promise<ToolResult> {
  const hub = await context.editor.hub();
  const id = textArgument(call.args, "id") ?? "latest";
  const cards = await listCards(hub);
  if (cards.length === 0) {
    return errorResult(
      `no reference cards in ${CAPTURES_DIR} yet: pick an element in the Game view of the tools page first`
    );
  }
  const card = cardOf(cards, id, hub.bin.root);
  if (card === undefined) {
    const names = cards.map(entry => entry.path).join(", ");
    return errorResult(`no reference card ${id} in ${CAPTURES_DIR}; the cards are: ${names}`);
  }

  const file = readFileText(await hub.request("files", "read", { path: card.path }));
  const text = file?.text ?? "";
  const crop = await cropOf(hub, card.path, text);
  const image = crop === undefined ? undefined : imageItem(crop);
  const first = textItem(`${card.path}\n\n${text}`);
  return { content: image === undefined ? [first] : [first, image] };
}

/**
 * moku_screenshot.
 */
export const screenshotTool: Tool = {
  name: "moku_screenshot",
  title: "Screenshot",
  description:
    "A PNG of the game as it is now, at most maxWidth pixels wide, with its frame and device. The game page must be visible: a paused or hidden game answers a message instead.",
  inputSchema: {
    type: "object",
    properties: {
      maxWidth: {
        type: "integer",
        minimum: MIN_WIDTH,
        maximum: MAX_WIDTH,
        default: DEFAULT_MAX_WIDTH,
        description: "The widest picture in pixels; a wider game picture is scaled down."
      },
      session: SESSION_PROPERTY
    },
    additionalProperties: false
  },
  annotations: READ_ONLY,
  run: screenshot
};

/**
 * moku_series.
 */
export const seriesTool: Tool = {
  name: "moku_series",
  title: "Contact sheet",
  description:
    "Takes frames pictures everyMs ms of game time apart and answers them laid out on one PNG (ceil(sqrt(frames)) columns): a motion at a glance. Needs @moku-labs/game 0.4 or newer and a visible game page.",
  inputSchema: {
    type: "object",
    properties: {
      frames: {
        type: "integer",
        minimum: 2,
        maximum: 12,
        default: 6,
        description: "How many pictures."
      },
      everyMs: {
        type: "integer",
        minimum: 1,
        maximum: 5000,
        default: 500,
        description: "Game time between two pictures, in ms."
      },
      session: SESSION_PROPERTY
    },
    additionalProperties: false
  },
  annotations: READ_ONLY,
  run: series
};

/**
 * moku_reference.
 */
export const referenceTool: Tool = {
  name: "moku_reference",
  title: "Reference card",
  description: `A reference card the tools page wrote when an element was picked (${CAPTURES_DIR}/*.md): the element, its flow node, its source lines and its crop as an image. "latest" (the default) is the newest card.`,
  inputSchema: {
    type: "object",
    properties: {
      id: {
        type: "string",
        minLength: 1,
        description: 'The card: "latest", its file name (with or without .md) or its path.'
      }
    },
    additionalProperties: false
  },
  annotations: READ_ONLY,
  run: reference
};
