/**
 * @file link plugin — reads the wire shapes link receives (sessions, manifest, run results, file
 * results, boot, hello and hot reload JSON) from Json into fresh typed objects. No casts: every field is
 * checked, unknown keys are dropped, a bad shape reads as undefined.
 */

import type {
  Changes,
  CommandDescriptor,
  Effect,
  FileBinary,
  FileEntry,
  FileText,
  HelloBody,
  HotReload,
  InputKind,
  InputSchema,
  Json,
  Manifest,
  RunResult,
  SessionInfo,
  SourceDescriptor,
  ToolsBoot,
  WriteResult
} from "../../registry/protocol";
import { errorCode, wireError } from "../../registry/protocol";

/**
 * A decoded JSON object.
 */
export type JsonObject = { [key: string]: Json };

/**
 * One input field kind, optional or not.
 */
type FieldKind = InputKind | `${InputKind}?`;

/**
 * Every field kind of an input schema.
 */
const FIELD_KINDS: ReadonlySet<string> = new Set(
  ["string", "number", "boolean", "json"].flatMap(kind => [kind, `${kind}?`])
);

/**
 * Every `changes` value of a source.
 */
const CHANGES: ReadonlySet<string> = new Set(["frame", "commit", "edge"]);

/**
 * Every `effect` value of a command.
 */
const EFFECTS: ReadonlySet<string> = new Set(["read", "route", "cosmetic", "cheat", "raw"]);

/**
 * The value as a JSON object, or undefined for null, arrays and primitives.
 *
 * @param value - A Json value.
 * @returns The object or undefined.
 * @example
 * ```ts
 * objectOf({ a: 1 }); // { a: 1 }
 * ```
 */
export function objectOf(value: Json | undefined): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : undefined;
}

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
export function textOf(object: JsonObject, key: string): string | undefined {
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
export function numberOf(object: JsonObject, key: string): number | undefined {
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
export function flagOf(object: JsonObject, key: string): boolean | undefined {
  const value = object[key];
  return typeof value === "boolean" ? value : undefined;
}

/**
 * Reads every item of an array; the whole list is undefined when one item is bad.
 *
 * @param value - A Json value.
 * @param readItem - Reads one item.
 * @returns The items, or undefined.
 * @example
 * ```ts
 * listOf([{ path: "a" }], readItem);
 * ```
 */
function listOf<T>(
  value: Json | undefined,
  readItem: (item: Json) => T | undefined
): T[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const items: T[] = [];
  for (const item of value) {
    const read = readItem(item);
    if (read === undefined) return undefined;
    items.push(read);
  }
  return items;
}

/**
 * True for an input field kind.
 *
 * @param value - A Json value.
 * @returns Whether it is `string`, `number?` …
 * @example
 * ```ts
 * isFieldKind("number?"); // true
 * ```
 */
function isFieldKind(value: Json | undefined): value is FieldKind {
  return typeof value === "string" && FIELD_KINDS.has(value);
}

/**
 * True for a source `changes` value.
 *
 * @param value - A Json value.
 * @returns Whether it is frame, commit or edge.
 * @example
 * ```ts
 * isChanges("commit"); // true
 * ```
 */
function isChanges(value: Json | undefined): value is Changes {
  return typeof value === "string" && CHANGES.has(value);
}

/**
 * True for a command `effect` value.
 *
 * @param value - A Json value.
 * @returns Whether it is a known effect.
 * @example
 * ```ts
 * isEffect("cheat"); // true
 * ```
 */
function isEffect(value: Json | undefined): value is Effect {
  return typeof value === "string" && EFFECTS.has(value);
}

/**
 * Reads an input schema: an object of field kinds.
 *
 * @param value - A Json value.
 * @returns The schema, or undefined.
 * @example
 * ```ts
 * readInput({ frames: "number" }); // { frames: "number" }
 * ```
 */
function readInput(value: Json | undefined): InputSchema | undefined {
  const object = objectOf(value);
  if (object === undefined) return undefined;

  const schema: Record<string, FieldKind> = {};
  for (const [field, kind] of Object.entries(object)) {
    if (!isFieldKind(kind)) return undefined;
    schema[field] = kind;
  }
  return schema;
}

/**
 * Reads the `id`, `title` and `input` every descriptor has.
 *
 * @param value - A Json value.
 * @returns The common fields and the object, or undefined.
 * @example
 * ```ts
 * readDescriptor({ id: "game.graph", title: "Graph", input: {}, changes: "edge" });
 * ```
 */
function readDescriptor(
  value: Json
): { id: string; title: string; input: InputSchema; object: JsonObject } | undefined {
  const object = objectOf(value);
  if (object === undefined) return undefined;

  const id = textOf(object, "id");
  const title = textOf(object, "title");
  const input = readInput(object.input);
  if (id === undefined || title === undefined || input === undefined) return undefined;
  return { id, title, input, object };
}

/**
 * Reads a source descriptor. `available: false` and its text `reason` are kept (a source the game
 * does not have); any other `available` value, or a reason without it, is dropped.
 *
 * @param value - A Json value.
 * @returns The descriptor, or undefined.
 * @example
 * ```ts
 * readSource({ id: "game.graph", title: "Graph", input: {}, changes: "edge" });
 * readSource({ id: "game.effects", title: "Effects", input: {}, changes: "frame", available: false, reason: "app.effects is undefined" });
 * ```
 */
function readSource(value: Json): SourceDescriptor | undefined {
  const common = readDescriptor(value);
  const changes = common?.object.changes;
  if (common === undefined || !isChanges(changes)) return undefined;

  const source = { id: common.id, title: common.title, input: common.input, changes };
  if (common.object.available !== false) return source;

  const reason = textOf(common.object, "reason");
  return reason === undefined
    ? { ...source, available: false }
    : { ...source, available: false, reason };
}

/**
 * Reads a command descriptor.
 *
 * @param value - A Json value.
 * @returns The descriptor, or undefined.
 * @example
 * ```ts
 * readCommand({ id: "game.step", title: "Step", input: { frames: "number" }, effect: "raw" });
 * ```
 */
function readCommand(value: Json): CommandDescriptor | undefined {
  const common = readDescriptor(value);
  const effect = common?.object.effect;
  if (common === undefined || !isEffect(effect)) return undefined;
  return { id: common.id, title: common.title, input: common.input, effect };
}

/**
 * Reads one reserved panel entry of a manifest.
 *
 * @param value - A Json value.
 * @returns `{ id, module }`, or undefined.
 * @example
 * ```ts
 * readPanel({ id: "p", module: "./p.js" });
 * ```
 */
function readPanel(value: Json): { id: string; module: string } | undefined {
  const object = objectOf(value);
  const id = object && textOf(object, "id");
  const module = object && textOf(object, "module");
  return id === undefined || module === undefined ? undefined : { id, module };
}

/**
 * Reads the `restored` entry of a manifest: a string bookmark and a number frame (R6).
 *
 * @param value - The `restored` member.
 * @returns `{ bookmark, frame }`, or undefined when absent or malformed.
 * @example
 * ```ts
 * readRestored({ bookmark: '{"path":"home"}', frame: 1840 }); // { bookmark: '{"path":"home"}', frame: 1840 }
 * readRestored({ bookmark: 1, frame: 1840 }); // undefined
 * ```
 */
function readRestored(value: Json | undefined): Manifest["restored"] {
  const object = objectOf(value);
  const bookmark = object && textOf(object, "bookmark");
  const frame = object && numberOf(object, "frame");
  return bookmark === undefined || frame === undefined ? undefined : { bookmark, frame };
}

/**
 * Reads a manifest (the hub validated it on hello; link checks it again before typing it). A
 * malformed `restored` entry is dropped; the manifest stays.
 *
 * @param value - The `manifest` result.
 * @returns The manifest, or undefined.
 */
export function readManifest(value: Json): Manifest | undefined {
  const object = objectOf(value);
  if (object === undefined) return undefined;

  const game = textOf(object, "game");
  const page = textOf(object, "page");
  const embedded = flagOf(object, "embedded");
  const sources = listOf(object.sources, readSource);
  const commands = listOf(object.commands, readCommand);
  if (game === undefined || page === undefined || embedded === undefined) return undefined;
  if (sources === undefined || commands === undefined) return undefined;

  const restored = readRestored(object.restored);
  const manifest = { game, page, embedded, sources, commands, ...(restored && { restored }) };
  if (object.panels === undefined) return manifest;

  const panels = listOf(object.panels, readPanel);
  return panels === undefined ? undefined : { ...manifest, panels };
}

/**
 * Reads the params of an `editor.hotReload` notification or the answer of `{path}/hmr`.
 *
 * @param value - The params or the parsed answer.
 * @returns A fresh `{ hmr, owner }`, or undefined for any other shape.
 * @example
 * ```ts
 * readHotReload({ hmr: true, owner: "bin" }); // { hmr: true, owner: "bin" }
 * readHotReload({ hmr: true, owner: "cloud" }); // undefined
 * ```
 */
export function readHotReload(value: Json | undefined): HotReload | undefined {
  const object = objectOf(value);
  const hmr = object && flagOf(object, "hmr");
  const owner = object && textOf(object, "owner");
  if (hmr === undefined) return undefined;
  return owner === "bin" || owner === "server" ? { hmr, owner } : undefined;
}

/**
 * Reads one session (R1: exactly five fields; other keys are dropped).
 *
 * @param value - A Json value.
 * @returns The session, or undefined.
 * @example
 * ```ts
 * readSession({ id: "s-1", game: "g", page: "p", embedded: true, connectedAt: 1 });
 * ```
 */
function readSession(value: Json): SessionInfo | undefined {
  const object = objectOf(value);
  if (object === undefined) return undefined;

  const id = textOf(object, "id");
  const game = textOf(object, "game");
  const page = textOf(object, "page");
  const embedded = flagOf(object, "embedded");
  const connectedAt = numberOf(object, "connectedAt");
  if (id === undefined || game === undefined || page === undefined) return undefined;
  if (embedded === undefined || connectedAt === undefined) return undefined;
  return { id, game, page, embedded, connectedAt };
}

/**
 * Reads the params of a `sessions` notification; malformed entries are skipped.
 *
 * @param params - The notification params.
 * @returns The sessions, or undefined when there is no list.
 */
export function readSessions(params: Json | undefined): SessionInfo[] | undefined {
  const list = objectOf(params)?.list;
  if (!Array.isArray(list)) return undefined;

  return list.flatMap(item => readSession(item) ?? []);
}

/**
 * Reads a `run` result: a value and the run state.
 *
 * @param value - The `run` result.
 * @returns The RunResult, or undefined.
 * @example
 * ```ts
 * readRunResult({ value: null, state: { path: "home", frame: 3, tainted: false } });
 * ```
 */
export function readRunResult(value: Json): RunResult | undefined {
  const object = objectOf(value);
  const state = objectOf(object?.state);
  if (object === undefined || state === undefined || object.value === undefined) return undefined;

  const path = textOf(state, "path");
  const frame = numberOf(state, "frame");
  const tainted = flagOf(state, "tainted");
  if (path === undefined || frame === undefined || tainted === undefined) return undefined;
  return { value: object.value, state: { path, frame, tainted } };
}

/**
 * Reads one file entry.
 *
 * @param value - A Json value.
 * @returns The entry, or undefined.
 * @example
 * ```ts
 * readFileEntry({ path: "src", kind: "dir", size: 0 });
 * ```
 */
function readFileEntry(value: Json): FileEntry | undefined {
  const object = objectOf(value);
  if (object === undefined) return undefined;

  const path = textOf(object, "path");
  const kind = textOf(object, "kind");
  const size = numberOf(object, "size");
  const version = textOf(object, "version");
  if (path === undefined || size === undefined || (kind !== "file" && kind !== "dir")) {
    return undefined;
  }
  return version === undefined ? { path, kind, size } : { path, kind, size, version };
}

/**
 * Reads a files `list` result.
 *
 * @param value - The result.
 * @returns The entries, or undefined.
 * @example
 * ```ts
 * readFileEntries([{ path: "a.md", kind: "file", size: 3 }]);
 * ```
 */
export function readFileEntries(value: Json): FileEntry[] | undefined {
  return listOf(value, readFileEntry);
}

/**
 * Reads a files `read` result.
 *
 * @param value - The result.
 * @returns `{ text, version }`, or undefined.
 * @example
 * ```ts
 * readFileText({ text: "# hi", version: "v1" });
 * ```
 */
export function readFileText(value: Json): FileText | undefined {
  const object = objectOf(value);
  const text = object && textOf(object, "text");
  const version = object && textOf(object, "version");
  return text === undefined || version === undefined ? undefined : { text, version };
}

/**
 * Reads a files `readBinary` result.
 *
 * @param value - The result.
 * @returns `{ dataUrl, version }`, or undefined.
 * @example
 * ```ts
 * readFileBinary({ dataUrl: "data:image/png;base64,AA==", version: "v1" });
 * ```
 */
export function readFileBinary(value: Json): FileBinary | undefined {
  const object = objectOf(value);
  const dataUrl = object && textOf(object, "dataUrl");
  const version = object && textOf(object, "version");
  return dataUrl === undefined || version === undefined ? undefined : { dataUrl, version };
}

/**
 * Reads a files `write` / `writeBinary` result.
 *
 * @param value - The result.
 * @returns `{ path, bytes, version }`, or undefined.
 * @example
 * ```ts
 * readWriteResult({ path: "a.md", bytes: 4, version: "v2" });
 * ```
 */
export function readWriteResult(value: Json): WriteResult | undefined {
  const object = objectOf(value);
  if (object === undefined) return undefined;

  const path = textOf(object, "path");
  const bytes = numberOf(object, "bytes");
  const version = textOf(object, "version");
  return path === undefined || bytes === undefined || version === undefined
    ? undefined
    : { path, bytes, version };
}

/**
 * A non-empty string member, or undefined.
 *
 * @param object - A JSON object.
 * @param key - The member.
 * @returns The string.
 * @example
 * ```ts
 * filledOf({ token: "" }, "token"); // undefined
 * ```
 */
function filledOf(object: JsonObject, key: string): string | undefined {
  const value = textOf(object, key);
  return value === "" ? undefined : value;
}

/**
 * Reads the boot JSON (R1/R3): `v: 1`, non-empty `ws` and `token`, and five string fields.
 *
 * @param value - The parsed tag text.
 * @returns A fresh ToolsBoot, or undefined.
 * @example
 * ```ts
 * const boot = readToolsBoot(JSON.parse(tag.textContent));
 * ```
 */
export function readToolsBoot(value: Json): ToolsBoot | undefined {
  const object = objectOf(value);
  if (object?.v !== 1) return undefined;

  const ws = filledOf(object, "ws");
  const token = filledOf(object, "token");
  const path = textOf(object, "path");
  const title = textOf(object, "title");
  const editorUrl = textOf(object, "editorUrl");
  const root = textOf(object, "root");
  const gameUrl = textOf(object, "gameUrl");
  if (ws === undefined || token === undefined || path === undefined || title === undefined) {
    return undefined;
  }
  if (editorUrl === undefined || root === undefined || gameUrl === undefined) return undefined;
  return { v: 1, ws, token, path, title, editorUrl, root, gameUrl };
}

/**
 * Reads the hello body (R1): non-empty `ws` and `token`.
 *
 * @param value - The parsed body.
 * @returns `{ ws, token }`, or undefined.
 * @example
 * ```ts
 * readHelloBody({ ws: "ws://127.0.0.1:3000/__editor/ws", token: "t" });
 * ```
 */
export function readHelloBody(value: Json): HelloBody | undefined {
  const object = objectOf(value);
  const ws = object && filledOf(object, "ws");
  const token = object && filledOf(object, "token");
  return ws === undefined || token === undefined ? undefined : { ws, token };
}

/**
 * Reads a result with a reader, or throws -32600 naming the method.
 *
 * @param value - The result.
 * @param read - The reader.
 * @param method - The method that answered, for the message.
 * @returns The typed result.
 * @throws {Error} A wire error -32600 when the shape is wrong.
 */
export function expectShape<T>(
  value: Json,
  read: (value: Json) => T | undefined,
  method: string
): T {
  const shaped = read(value);
  if (shaped === undefined) {
    throw wireError(errorCode.invalidRequest, `${method} answered an unexpected shape.`, {
      retryable: false
    });
  }
  return shaped;
}
