/**
 * @file pages/mcp — reads the hub answers and notifications the bridge acts on (sessions,
 * heartbeats, run results, shots, file results, manifest entries and command doors) from Json
 * into typed values. Every field is checked; a bad shape reads as undefined. The bridge imports
 * only the protocol module, so these readers are its own.
 */
import type {
  CommandDescriptor,
  Effect,
  FileEntry,
  FileText,
  InputKind,
  InputSchema,
  Json,
  Manifest,
  RunResult,
  SessionInfo
} from "../../registry/protocol";
import { isObject } from "./rpc";
import type { JsonObject } from "./types";

/**
 * The game name and the command doors of a manifest: what the door tools are built from.
 */
export type DoorManifest = Pick<Manifest, "game" | "commands">;

/**
 * Every effect a command door declares.
 */
const EFFECTS: ReadonlySet<string> = new Set<Effect>(["read", "route", "cosmetic", "cheat", "raw"]);

/**
 * Every kind an input field declares, required and optional.
 */
const FIELD_KINDS: ReadonlySet<string> = new Set<InputKind | `${InputKind}?`>([
  "string",
  "string?",
  "number",
  "number?",
  "boolean",
  "boolean?",
  "json",
  "json?"
]);

/**
 * The start of every picture a game answers (a PNG or JPEG data URL).
 */
const IMAGE_PREFIX = "data:image/";

/**
 * A base64 data URL: its mime type and its data.
 */
const DATA_URL = /^data:([\w.+-]+\/[\w.+-]+);base64,(.*)$/s;

/**
 * A string member, or undefined.
 *
 * @param object - A JSON object.
 * @param key - The member.
 * @returns The string.
 * @example
 * ```ts
 * textOf({ id: "s-1" }, "id"); // "s-1"
 * ```
 */
function textOf(object: JsonObject, key: string): string | undefined {
  const value = object[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * A finite number member, or undefined.
 *
 * @param object - A JSON object.
 * @param key - The member.
 * @returns The number.
 * @example
 * ```ts
 * numberOf({ frame: 3 }, "frame"); // 3
 * ```
 */
function numberOf(object: JsonObject, key: string): number | undefined {
  const value = object[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * A boolean member, or undefined.
 *
 * @param object - A JSON object.
 * @param key - The member.
 * @returns The boolean.
 * @example
 * ```ts
 * flagOf({ paused: true }, "paused"); // true
 * ```
 */
function flagOf(object: JsonObject, key: string): boolean | undefined {
  const value = object[key];
  return typeof value === "boolean" ? value : undefined;
}

/**
 * Reads the hub's `heartbeat` readout of a session (M4).
 *
 * @param value - The `heartbeat` member.
 * @returns `{ frame, paused, silent }`, or undefined when absent or malformed.
 * @example
 * ```ts
 * readReadout({ frame: 1840, paused: true, silent: false }); // { frame: 1840, paused: true, silent: false }
 * ```
 */
function readReadout(value: Json | undefined): SessionInfo["heartbeat"] {
  if (!isObject(value)) return undefined;
  const frame = numberOf(value, "frame");
  const paused = flagOf(value, "paused");
  const silent = flagOf(value, "silent");
  if (frame === undefined || paused === undefined || silent === undefined) return undefined;
  return { frame, paused, silent };
}

/**
 * Reads one session: the five wire fields, the optional heartbeat readout and the optional
 * `manifestHash` (D-37; a value that is not a string is dropped).
 *
 * @param value - One list item.
 * @returns The session, or undefined.
 * @example
 * ```ts
 * readSession({ id: "s-1", game: "g", page: "p", embedded: true, connectedAt: 1, manifestHash: "4f528e73" });
 * // { id: "s-1", game: "g", page: "p", embedded: true, connectedAt: 1, manifestHash: "4f528e73" }
 * ```
 */
function readSession(value: Json): SessionInfo | undefined {
  if (!isObject(value)) return undefined;
  const id = textOf(value, "id");
  const game = textOf(value, "game");
  const page = textOf(value, "page");
  const embedded = flagOf(value, "embedded");
  const connectedAt = numberOf(value, "connectedAt");
  if (id === undefined || game === undefined || page === undefined) return undefined;
  if (embedded === undefined || connectedAt === undefined) return undefined;

  const heartbeat = readReadout(value.heartbeat);
  const manifestHash = textOf(value, "manifestHash");
  return {
    id,
    game,
    page,
    embedded,
    connectedAt,
    ...(heartbeat === undefined ? {} : { heartbeat }),
    ...(manifestHash === undefined ? {} : { manifestHash })
  };
}

/**
 * Reads the params of an `editor.sessions` notification; malformed entries are skipped.
 *
 * @param params - The notification params.
 * @returns The sessions, or undefined when there is no list.
 * @example
 * ```ts
 * readSessionList({ list: [{ id: "s-1", game: "g", page: "p", embedded: true, connectedAt: 1 }] })?.length; // 1
 * ```
 */
export function readSessionList(params: Json | undefined): SessionInfo[] | undefined {
  const list = isObject(params) ? params.list : undefined;
  if (!Array.isArray(list)) return undefined;
  return list.flatMap(item => readSession(item) ?? []);
}

/**
 * Reads a forwarded `game.heartbeat`: its frame and paused.
 *
 * @param params - The notification params.
 * @returns `{ frame, paused }`, or undefined.
 * @example
 * ```ts
 * readBeat({ frame: 12, paused: false, at: 5 }); // { frame: 12, paused: false }
 * ```
 */
export function readBeat(
  params: Json | undefined
): { readonly frame: number; readonly paused: boolean } | undefined {
  if (!isObject(params)) return undefined;
  const frame = numberOf(params, "frame");
  const paused = flagOf(params, "paused");
  return frame === undefined || paused === undefined ? undefined : { frame, paused };
}

/**
 * Reads a `run` result: a value and the run state.
 *
 * @param value - The `run` result.
 * @returns The RunResult, or undefined.
 * @example
 * ```ts
 * readRunResult({ value: null, state: { path: "home", frame: 3, tainted: false } })?.state.frame; // 3
 * ```
 */
export function readRunResult(value: Json): RunResult | undefined {
  if (!isObject(value) || value.value === undefined || !isObject(value.state)) return undefined;
  const { state } = value;
  const path = textOf(state, "path");
  const frame = numberOf(state, "frame");
  const tainted = flagOf(state, "tainted");
  if (path === undefined || frame === undefined || tainted === undefined) return undefined;
  return { value: value.value, state: { path, frame, tainted } };
}

/**
 * Reads the value of `editor.capture`: the picture, its frame and the device.
 *
 * @param value - The command value.
 * @returns `{ image, frame, device }`, or undefined.
 * @example
 * ```ts
 * readShot({ image: "data:image/png;base64,AA", frame: 25, device: { w: 393, h: 852, orientation: "portrait" } })?.frame; // 25
 * ```
 */
export function readShot(
  value: Json
): { readonly image: string; readonly frame: number; readonly device: Json } | undefined {
  if (!isObject(value)) return undefined;
  const image = textOf(value, "image");
  const frame = numberOf(value, "frame");
  if (image === undefined || frame === undefined) return undefined;
  return { image, frame, device: value.device ?? {} };
}

/**
 * The picture of a game.capture value, the rule of capture/shot.ts: the PNG data URL itself
 * (game 0.1), or the string `png` of `{ png, legend? }` (game 0.4).
 *
 * @param value - What game.capture answered.
 * @returns The data URL, or undefined (no picture).
 * @example
 * ```ts
 * pictureOf({ png: "data:image/png;base64,AA" }); // "data:image/png;base64,AA"
 * pictureOf(null); // undefined: the renderer is inert
 * ```
 */
export function pictureOf(value: Json): string | undefined {
  const png = isObject(value) ? value.png : value;
  return typeof png === "string" && png.startsWith(IMAGE_PREFIX) ? png : undefined;
}

/**
 * Splits a base64 data URL.
 *
 * @param dataUrl - The data URL.
 * @returns The mime type and the base64 data, or undefined for anything else.
 * @example
 * ```ts
 * splitDataUrl("data:image/png;base64,iVBO"); // { mimeType: "image/png", data: "iVBO" }
 * ```
 */
export function splitDataUrl(
  dataUrl: string
): { readonly mimeType: string; readonly data: string } | undefined {
  const match = DATA_URL.exec(dataUrl);
  const [, mimeType, data] = match ?? [];
  return mimeType === undefined || data === undefined ? undefined : { mimeType, data };
}

/**
 * The eight bytes every PNG starts with.
 */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * The JPEG frame headers that carry the picture size: SOF0 (baseline), SOF1 and SOF2
 * (progressive). Canvas encoders write SOF0.
 */
const JPEG_FRAME_MARKERS: ReadonlySet<number> = new Set([0xc0, 0xc1, 0xc2]);

/**
 * The JPEG start-of-scan marker: the picture data follows, no frame header after it.
 */
const JPEG_START_OF_SCAN = 0xda;

/**
 * How many base64 characters of a JPEG are decoded to find its frame header (48 KB of bytes):
 * enough for the APP and DQT segments a canvas or a camera writes before it.
 */
const JPEG_HEAD_CHARS = 65_536;

/**
 * The size of a picture in pixels.
 */
export type PictureSize = { readonly width: number; readonly height: number };

/**
 * True for a JPEG marker without a length: the restart markers RST0..RST7 and TEM.
 *
 * @param marker - The marker byte after 0xff.
 * @returns Whether no segment length follows it.
 * @example
 * ```ts
 * isStandalone(0xd0); // true
 * ```
 */
function isStandalone(marker: number): boolean {
  return marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7);
}

/**
 * The size of a JPEG from its frame header: the segments after the SOI are walked by their
 * lengths until a SOF0, SOF1 or SOF2 header (height at +5, width at +7, big-endian).
 *
 * @param bytes - The first bytes of the JPEG.
 * @returns The size, or undefined when no frame header comes before the scan.
 * @example
 * ```ts
 * jpegSize(Buffer.from(data.slice(0, JPEG_HEAD_CHARS), "base64")); // { width: 393, height: 852 }
 * ```
 */
function jpegSize(bytes: Buffer): PictureSize | undefined {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;

  let offset = 2;
  while (offset + 9 <= bytes.length) {
    if (bytes[offset] !== 0xff) return undefined;
    const marker = bytes[offset + 1] ?? 0;
    if (JPEG_FRAME_MARKERS.has(marker)) {
      return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
    }
    if (marker === JPEG_START_OF_SCAN) return undefined;
    // A fill byte (0xff) or a standalone marker has no length.
    const fill = marker === 0xff;
    offset += fill ? 1 : 2;
    if (!fill && !isStandalone(marker)) offset += bytes.readUInt16BE(offset);
  }
  return undefined;
}

/**
 * The size of a PNG from its IHDR header (width at bytes 16 to 19, height at 20 to 23).
 *
 * @param bytes - The first bytes of the PNG.
 * @returns The size, or undefined when the signature is not a PNG's.
 * @example
 * ```ts
 * pngSize(Buffer.from(data.slice(0, 32), "base64")); // { width: 393, height: 852 }
 * ```
 */
function pngSize(bytes: Buffer): PictureSize | undefined {
  const isPng = bytes.length >= 24 && PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
  return isPng ? { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) } : undefined;
}

/**
 * The size of a PNG or JPEG data URL, read from its header without decoding the picture.
 *
 * @param dataUrl - The data URL.
 * @returns The size in pixels, or undefined for another type or a header it cannot read.
 * @example
 * ```ts
 * pictureSize(shot.image)?.width; // 393 for a shot of a 393 px wide canvas
 * ```
 */
export function pictureSize(dataUrl: string): PictureSize | undefined {
  const split = splitDataUrl(dataUrl);
  if (split?.mimeType === "image/png") {
    return pngSize(Buffer.from(split.data.slice(0, 32), "base64"));
  }
  if (split?.mimeType === "image/jpeg") {
    return jpegSize(Buffer.from(split.data.slice(0, JPEG_HEAD_CHARS), "base64"));
  }
  return undefined;
}

/**
 * Reads one file entry.
 *
 * @param value - One list item.
 * @returns The entry, or undefined.
 * @example
 * ```ts
 * readFileEntry({ path: "src", kind: "dir", size: 0 });
 * ```
 */
function readFileEntry(value: Json): FileEntry | undefined {
  if (!isObject(value)) return undefined;
  const path = textOf(value, "path");
  const kind = textOf(value, "kind");
  const size = numberOf(value, "size");
  const version = textOf(value, "version");
  if (path === undefined || size === undefined || (kind !== "file" && kind !== "dir")) {
    return undefined;
  }
  return version === undefined ? { path, kind, size } : { path, kind, size, version };
}

/**
 * Reads a files `list` result; malformed entries are skipped.
 *
 * @param value - The result.
 * @returns The entries (empty for any other shape).
 * @example
 * ```ts
 * readFileEntries([{ path: "a.md", kind: "file", size: 3 }]); // [{ path: "a.md", kind: "file", size: 3 }]
 * ```
 */
export function readFileEntries(value: Json): FileEntry[] {
  return Array.isArray(value) ? value.flatMap(item => readFileEntry(item) ?? []) : [];
}

/**
 * Reads a files `read` result.
 *
 * @param value - The result.
 * @returns `{ text, version }`, or undefined.
 * @example
 * ```ts
 * readFileText({ text: "# hi", version: "v1" }); // { text: "# hi", version: "v1" }
 * ```
 */
export function readFileText(value: Json): FileText | undefined {
  if (!isObject(value)) return undefined;
  const text = textOf(value, "text");
  const version = textOf(value, "version");
  return text === undefined || version === undefined ? undefined : { text, version };
}

/**
 * The data URL of a files `readBinary` result.
 *
 * @param value - The result.
 * @returns The data URL, or undefined.
 * @example
 * ```ts
 * dataUrlOf({ dataUrl: "data:image/png;base64,AA", version: "v1" }); // "data:image/png;base64,AA"
 * ```
 */
export function dataUrlOf(value: Json): string | undefined {
  return isObject(value) ? textOf(value, "dataUrl") : undefined;
}

/**
 * A command of a manifest: its effect and its input schema.
 *
 * @param manifest - The `manifest` result.
 * @param id - The command id.
 * @returns `{ effect, input }`, or undefined when the manifest has no such command.
 * @example
 * ```ts
 * commandOf(manifest, "game.capture"); // { effect: "read", input: { legend: "boolean?", sheet: "json?", … } }
 * ```
 */
export function commandOf(
  manifest: Json,
  id: string
): { readonly effect: string; readonly input: JsonObject } | undefined {
  const commands = isObject(manifest) ? manifest.commands : undefined;
  if (!Array.isArray(commands)) return undefined;

  const found = commands.find(command => isObject(command) && command.id === id);
  if (!isObject(found)) return undefined;
  const effect = textOf(found, "effect") ?? "unknown";
  return { effect, input: isObject(found.input) ? found.input : {} };
}

/**
 * True for a known command effect.
 *
 * @param value - A Json value.
 * @returns Whether it is read, route, cosmetic, cheat or raw.
 * @example
 * ```ts
 * isEffect("cheat"); // true
 * isEffect("explode"); // false
 * ```
 */
function isEffect(value: Json | undefined): value is Effect {
  return typeof value === "string" && EFFECTS.has(value);
}

/**
 * True for a known input field kind, required or optional.
 *
 * @param value - A Json value.
 * @returns Whether it is string, number, boolean or json, with or without `?`.
 * @example
 * ```ts
 * isFieldKind("number?"); // true
 * isFieldKind("date"); // false
 * ```
 */
function isFieldKind(value: Json | undefined): value is InputKind | `${InputKind}?` {
  return typeof value === "string" && FIELD_KINDS.has(value);
}

/**
 * Reads the input schema of a door: field name to kind.
 *
 * @param value - The `input` member.
 * @returns The schema, or undefined when it is not an object of known kinds.
 * @example
 * ```ts
 * readInputSchema({ target: "string", x: "number?" }); // { target: "string", x: "number?" }
 * readInputSchema({ at: "date" }); // undefined
 * ```
 */
function readInputSchema(value: Json | undefined): InputSchema | undefined {
  if (!isObject(value)) return undefined;
  const schema: Record<string, InputKind | `${InputKind}?`> = {};
  for (const [field, kind] of Object.entries(value)) {
    if (!isFieldKind(kind)) return undefined;
    schema[field] = kind;
  }
  return schema;
}

/**
 * Reads one command door of a manifest.
 *
 * @param value - One `commands` item.
 * @returns The door, or undefined when a field is missing or malformed.
 * @example
 * ```ts
 * readCommand({ id: "game.tap", title: "Tap", input: { target: "string" }, effect: "route" })?.effect; // "route"
 * ```
 */
function readCommand(value: Json): CommandDescriptor | undefined {
  if (!isObject(value)) return undefined;
  const id = textOf(value, "id");
  const title = textOf(value, "title");
  const { effect } = value;
  const input = readInputSchema(value.input);
  if (id === undefined || title === undefined || input === undefined) return undefined;
  return isEffect(effect) ? { id, title, input, effect } : undefined;
}

/**
 * Reads the game name and the command doors of a `manifest` answer. A malformed door is skipped
 * (the hub checked the manifest on hello; this keeps the bridge from trusting it blindly).
 *
 * @param manifest - The `manifest` result.
 * @returns `{ game, commands }`, or undefined without a game name or a command list.
 * @example
 * ```ts
 * readDoorManifest(await hub.request("game", "manifest", {}, "s-1"))?.commands.map(door => door.id);
 * // ["game.tap", "game.step", …]
 * ```
 */
export function readDoorManifest(manifest: Json): DoorManifest | undefined {
  if (!isObject(manifest)) return undefined;
  const game = textOf(manifest, "game");
  const { commands } = manifest;
  if (game === undefined || !Array.isArray(commands)) return undefined;
  return { game, commands: commands.flatMap(command => readCommand(command) ?? []) };
}

/**
 * The frame of the checkpoint a manifest says it restored (R6), when it did.
 *
 * @param manifest - The `manifest` result.
 * @returns The frame of the restored checkpoint, or undefined.
 * @example
 * ```ts
 * restoredFrameOf({ game: "g", restored: { bookmark: "{}", frame: 1840 } }); // 1840
 * ```
 */
export function restoredFrameOf(manifest: Json): number | undefined {
  const restored = isObject(manifest) ? manifest.restored : undefined;
  return isObject(restored) ? numberOf(restored, "frame") : undefined;
}
