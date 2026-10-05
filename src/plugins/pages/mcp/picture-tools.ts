/**
 * @file pages/mcp — the picture tools (M5, M7, D-34): moku_screenshot (`editor.capture { maxWidth,
 * format, key? }`, JPEG by default, cropped to an element by key), moku_series (`editor.sheet {
 * frames, everyMs, maxWidth, format: "jpeg" }`, or `game.capture { sheet }` when the agent has no
 * editor.sheet; game ≥ 0.4) and moku_reference (a reference card of `.moku/captures`, flat or in a
 * `<YYYY-MM-DD>` day folder, with its crop). Screenshot and series check liveness first: a paused or hidden game gets a message, not a
 * timeout. Every image item takes its mimeType from the data URL: a page that cannot encode a
 * JPEG answers the game's PNG.
 */
import { statSync } from "node:fs";
import { basename, dirname, join } from "node:path/posix";
import type { FileEntry, Json, PictureFormat } from "../../registry/protocol";
import { readPicture } from "./file-tools";
import { withProgress } from "./progress";
import { errorResult, imageItem, imageKb, isTooLarge, pictureResult, textItem } from "./results";
import { numberArgument, READ_ONLY, SESSION_PROPERTY, textArgument } from "./schema";
import { livenessProblem } from "./sessions";
import {
  commandOf,
  pictureOf,
  pictureSize,
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
 * The name of a day folder in CAPTURES_DIR: `2026-10-05`. Other folders (such as `notes/`) hold no
 * cards moku_reference looks at.
 */
const DAY_FOLDER = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The default `frames` of moku_series: how many pictures the contact sheet has.
 */
const DEFAULT_FRAMES = 6;

/**
 * The default `everyMs` of moku_series: the game time between two pictures, in ms.
 */
const DEFAULT_EVERY_MS = 500;

/**
 * The picture formats editor.capture and editor.sheet encode; JPEG is the default (D-34).
 */
const FORMATS: readonly PictureFormat[] = ["jpeg", "png"];

/**
 * The format moku_screenshot asks for when none is given, and the one moku_series always asks.
 */
const DEFAULT_FORMAT: PictureFormat = "jpeg";

/**
 * One editor.capture shot.
 */
type Shot = { readonly image: string; readonly frame: number; readonly device: Json };

/**
 * What moku_screenshot asks editor.capture for, besides `maxWidth`: the format and the element key.
 */
type ShotRequest = { readonly format: PictureFormat; readonly key?: string };

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
 * @param request - The format and the element key.
 * @param session - The session, if asked for.
 * @returns The shot.
 * @throws {Error} When the answer carries no picture.
 */
async function captureShot(
  hub: HubClient,
  maxWidth: number,
  request: ShotRequest,
  session: string | undefined
): Promise<Shot> {
  const input = { maxWidth, ...request };
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
 */
function sizeNote(image: string): { note?: string } {
  if (!isTooLarge(image)) return {};
  return {
    note: `the picture is ${String(imageKb(image))} KB, above the 300 KB a result should carry`
  };
}

/**
 * The format and key arguments of moku_screenshot.
 *
 * @param call - The call.
 * @returns `{ format, key? }`, the format "jpeg" when absent.
 */
function shotRequestOf(call: ToolCall): ShotRequest {
  const asked = textArgument(call.args, "format");
  const format = FORMATS.find(entry => entry === asked) ?? DEFAULT_FORMAT;
  const key = textArgument(call.args, "key");
  return key === undefined ? { format } : { format, key };
}

/**
 * moku_screenshot: liveness, then editor.capture at `maxWidth` in the asked format, cropped to the
 * element `key` names; a picture above about 300 KB is taken once more at half its width (half of
 * `maxWidth`, or of the picture when it is narrower; the width is read from the PNG or JPEG
 * header).
 *
 * @param call - The call: maxWidth, key, format, session.
 * @param context - The tool context.
 * @returns A text item (frame, device, key, width, KB) and the image.
 */
async function screenshot(call: ToolCall, context: ToolContext): Promise<ToolResult> {
  const hub = await context.editor.hub();
  const session = textArgument(call.args, "session");
  const problem = livenessProblem(hub.sessions(), session);
  if (problem !== undefined) return errorResult(problem);

  const request = shotRequestOf(call);
  const asked = numberArgument(call.args, "maxWidth", DEFAULT_MAX_WIDTH);
  let maxWidth = asked;
  let shot = await captureShot(hub, maxWidth, request, session);
  // Half of what came back: a picture narrower than maxWidth is halved from its own width.
  const width = Math.min(asked, pictureSize(shot.image)?.width ?? asked);
  const half = Math.max(MIN_WIDTH, Math.floor(width / 2));
  // A picture above about 300 KB is taken once more, when half its width is still narrower.
  const tooLargeToShrink = isTooLarge(shot.image) && half < width;
  if (tooLargeToShrink) {
    maxWidth = half;
    shot = await captureShot(hub, maxWidth, request, session);
  }

  const key = request.key === undefined ? {} : { key: request.key };
  const facts = { frame: shot.frame, device: shot.device, ...key, maxWidth };
  return pictureResult({ ...facts, kb: imageKb(shot.image), ...sizeNote(shot.image) }, shot.image);
}

/**
 * Runs editor.sheet once: the agent takes the sheet, shrinks it to DEFAULT_MAX_WIDTH in the page
 * and encodes it as a JPEG, so it travels small.
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
  const input = { ...sheet, maxWidth: DEFAULT_MAX_WIDTH, format: DEFAULT_FORMAT };
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

  const frames = numberArgument(call.args, "frames", DEFAULT_FRAMES);
  const everyMs = numberArgument(call.args, "everyMs", DEFAULT_EVERY_MS);
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
 * The entries of one folder through the hub's `files.list`; a folder that cannot be listed has
 * none, unless the hub connection itself is gone.
 *
 * @param hub - The hub connection.
 * @param dir - The folder, relative to the bin's root.
 * @returns The entries.
 */
async function listFolder(hub: HubClient, dir: string): Promise<FileEntry[]> {
  try {
    return readFileEntries(await hub.request("files", "list", { dir }));
  } catch (error) {
    if (!hub.isOpen()) throw error;
    return [];
  }
}

/**
 * The day folders among the entries of CAPTURES_DIR, newest first: only `YYYY-MM-DD` names count.
 *
 * @param entries - The entries of CAPTURES_DIR.
 * @returns The day folder paths.
 * @example
 * ```ts
 * dayFoldersOf([
 *   { path: ".moku/captures/2026-10-04", kind: "dir", size: 0 },
 *   { path: ".moku/captures/2026-10-05", kind: "dir", size: 0 }
 * ]); // [".moku/captures/2026-10-05", ".moku/captures/2026-10-04"]
 * ```
 */
function dayFoldersOf(entries: readonly FileEntry[]): string[] {
  const days = entries.filter(
    entry => entry.kind === "dir" && DAY_FOLDER.test(basename(entry.path))
  );
  return days.map(entry => entry.path).toSorted((left, right) => right.localeCompare(left));
}

/**
 * True for a reference card: a `.md` file.
 *
 * @param entry - A folder entry.
 * @returns Whether it is a card.
 * @example
 * ```ts
 * isCard({ path: ".moku/captures/2026-10-05/play-f9.md", kind: "file", size: 812 }); // true
 * ```
 */
function isCard(entry: FileEntry): boolean {
  return entry.kind === "file" && entry.path.endsWith(".md");
}

/**
 * What a card search found: the card, and the cards it listed on the way.
 */
type CardSearch = { readonly card: FileEntry | undefined; readonly cards: readonly FileEntry[] };

/**
 * Finds the card an id names. The day folders (`CAPTURES_DIR/<YYYY-MM-DD>/*.md`) are listed one
 * at a time, newest day first, and the walk stops at the first day that has the card: for
 * "latest" the first day with cards, for a name the first day with a match. The flat cards from
 * before the day folders (`CAPTURES_DIR/*.md`) are weighed with every day. Without a card every
 * day is listed, so `cards` then holds them all, day folders first.
 *
 * @param hub - The hub connection.
 * @param id - The id argument.
 * @returns The card, undefined when none matches, and the cards listed.
 */
async function findCard(hub: HubClient, id: string): Promise<CardSearch> {
  const top = await listFolder(hub, CAPTURES_DIR);
  const flat = top.filter(entry => isCard(entry));
  const root = hub.bin.root;
  const listed: FileEntry[] = [];
  for (const day of dayFoldersOf(top)) {
    const entries = await listFolder(hub, day);
    const cards = entries.filter(entry => isCard(entry));
    listed.push(...cards);
    // A day with the card ends the walk; the flat cards are weighed against it.
    const hasCard = cardOf(cards, id, root) !== undefined;
    if (hasCard)
      return { card: cardOf([...cards, ...flat], id, root), cards: [...listed, ...flat] };
  }
  return { card: cardOf(flat, id, root), cards: [...listed, ...flat] };
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
 * The card a moku_reference id names: "latest" is the newest card; else the newest card whose path
 * is the id (as given or under CAPTURES_DIR, `.md` optional) or whose file name is the id (`.md`
 * optional). Between cards of the same time, the first in the list (the newest day) wins.
 *
 * @param cards - The card entries, newest day first.
 * @param id - The id argument.
 * @param root - The bin's root (for the modification times).
 * @returns The card, or undefined.
 * @example
 * ```ts
 * cardOf(cards, "play-f9", root)?.path; // ".moku/captures/2026-10-05/play-f9.md"
 * ```
 */
function cardOf(cards: readonly FileEntry[], id: string, root: string): FileEntry | undefined {
  const name = id.replace(/^\.\//, "");
  const names = new Set([name, `${name}.md`]);
  const paths = new Set([...names, `${CAPTURES_DIR}/${name}`, `${CAPTURES_DIR}/${name}.md`]);
  const matches =
    id === "latest"
      ? cards
      : cards.filter(card => paths.has(card.path) || names.has(basename(card.path)));
  const dated = matches.map(card => ({ card, at: modifiedAt(root, card.path) }));
  return dated.toSorted((left, right) => right.at - left.at)[0]?.card;
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
  return name === undefined ? undefined : readPicture(hub, `${dirname(card)}/${name}`);
}

/**
 * moku_reference: the newest or a named reference card, flat or in a day folder, and its crop.
 *
 * @param call - The call: id.
 * @param context - The tool context.
 * @returns The card text and the crop image.
 */
async function reference(call: ToolCall, context: ToolContext): Promise<ToolResult> {
  const hub = await context.editor.hub();
  const id = textArgument(call.args, "id") ?? "latest";
  const { card, cards } = await findCard(hub, id);
  if (cards.length === 0) {
    return errorResult(
      `no reference cards in ${CAPTURES_DIR} yet: pick an element in the Game view of the tools page first`
    );
  }
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
 * moku_screenshot: a picture of the game as it is now, scaled to maxWidth, cropped to one element
 * when a key is given.
 */
export const screenshotTool: Tool = {
  name: "moku_screenshot",
  title: "Screenshot",
  description:
    "A picture of the game as it is now (JPEG by default), at most maxWidth pixels wide, with its frame and device. key crops it to one ui element. The game page must be visible: a paused or hidden game answers a message instead.",
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
      key: {
        type: "string",
        minLength: 1,
        description:
          'A ui element key, projection-qualified like "hud/infoBar" allowed: the picture is cropped to that element plus 8 px.'
      },
      format: {
        type: "string",
        enum: FORMATS,
        default: DEFAULT_FORMAT,
        description: "jpeg (small, the default) or png (lossless)."
      },
      session: SESSION_PROPERTY
    },
    additionalProperties: false
  },
  annotations: READ_ONLY,
  run: screenshot
};

/**
 * moku_series: a contact sheet of frames pictures taken everyMs ms of game time apart.
 */
export const seriesTool: Tool = {
  name: "moku_series",
  title: "Contact sheet",
  description:
    "Takes frames pictures everyMs ms of game time apart and answers them laid out on one picture (ceil(sqrt(frames)) columns, a JPEG when the editor encodes it): a motion at a glance. Needs @moku-labs/game 0.4 or newer and a visible game page.",
  inputSchema: {
    type: "object",
    properties: {
      frames: {
        type: "integer",
        minimum: 2,
        maximum: 12,
        default: DEFAULT_FRAMES,
        description: "How many pictures."
      },
      everyMs: {
        type: "integer",
        minimum: 1,
        maximum: 5000,
        default: DEFAULT_EVERY_MS,
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
 * moku_reference: a reference card the tools page wrote, the newest or the newest with a name,
 * with its crop as an image.
 */
export const referenceTool: Tool = {
  name: "moku_reference",
  title: "Reference card",
  description: `A reference card the tools page wrote when an element or an area was picked (${CAPTURES_DIR}/<YYYY-MM-DD>/*.md, older cards ${CAPTURES_DIR}/*.md): the element, its flow node, its source lines and its crop as an image. "latest" (the default) is the newest card of all; a name answers the newest card with that name.`,
  inputSchema: {
    type: "object",
    properties: {
      id: {
        type: "string",
        minLength: 1,
        description:
          'The card: "latest", its file name (with or without .md; the newest card of that name) or its path.'
      }
    },
    additionalProperties: false
  },
  annotations: READ_ONLY,
  run: reference
};
