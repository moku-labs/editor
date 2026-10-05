/**
 * @file pages/mcp — reads the hub answers and notifications the bridge acts on (sessions,
 * heartbeats, run results, shots, file results, manifest entries) from Json into typed values.
 * Every field is checked; a bad shape reads as undefined. The bridge imports only the protocol
 * module, so these readers are its own.
 */
import type { FileEntry, FileText, Json, RunResult, SessionInfo } from "../../registry/protocol";
import { isObject } from "./rpc";
import type { JsonObject } from "./types";

/**
 * The start of every picture a game answers (a PNG data URL).
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
 * Reads one session: the five wire fields and the optional heartbeat readout.
 *
 * @param value - One list item.
 * @returns The session, or undefined.
 * @example
 * ```ts
 * readSession({ id: "s-1", game: "g", page: "p", embedded: true, connectedAt: 1 });
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
  const info = { id, game, page, embedded, connectedAt };
  return heartbeat === undefined ? info : { ...info, heartbeat };
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
 * The width of a PNG data URL, read from its IHDR header (bytes 16 to 19, big-endian).
 *
 * @param dataUrl - The data URL.
 * @returns The width in pixels, or undefined for anything but a PNG.
 * @example
 * ```ts
 * pngWidth(shot.image); // 393 for a shot of a 393 px wide canvas
 * ```
 */
export function pngWidth(dataUrl: string): number | undefined {
  const split = splitDataUrl(dataUrl);
  if (split?.mimeType !== "image/png") return undefined;

  const header = Buffer.from(split.data.slice(0, 32), "base64");
  const isPng = header.length >= 24 && PNG_SIGNATURE.every((byte, index) => header[index] === byte);
  return isPng ? header.readUInt32BE(16) : undefined;
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
