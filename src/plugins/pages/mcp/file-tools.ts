/**
 * @file pages/mcp — the files tools (M5, M6): moku_files_list, moku_files_read and
 * moku_files_write through the hub's files channel (the D-09 sandbox and its version check). The
 * bin's own `.moku/editor.json` (it holds the token) and `.moku/editor.log` are hidden from the
 * list and refused. Two tools read the project index (D-38): moku_files_find asks the hub where a
 * key lives (`files.find`), and moku_project reads the index state the hub published
 * (`editor.project`, kept by the hub client), with no request.
 */
import { normalize } from "node:path/posix";
import type { Json, ProjectState } from "../../registry/protocol";
import { errorCode, isWireError } from "../../registry/protocol";
import { DISCOVERY_FILE } from "../discovery";
import { LOG_FILE } from "./launcher";
import { replayed } from "./poll";
import { errorResult, jsonResult, jsonText, textItem } from "./results";
import { READ_ONLY, textArgument } from "./schema";
import type { Place } from "./shapes";
import { dataUrlOf, readFileEntries, readFileText, readPlaces } from "./shapes";
import type {
  HubClient,
  JsonObject,
  JsonShaped,
  PropertySchema,
  Tool,
  ToolCall,
  ToolContext,
  ToolResult
} from "./types";

/**
 * The on variant of the project state: the key maps.
 */
type ProjectIndex = Extract<ProjectState, { readonly state: "on" }>;

/**
 * The longest project-index key moku_files_find takes, in characters.
 */
const KEY_MAX = 512;

/**
 * The namespace of the JSX keys: they never ride the published state (D-39), only `find` reaches
 * them.
 */
const JSX = "jsx";

/**
 * What moku_project answers for a prefix of the JSX keys.
 */
const JSX_NOT_IN_STATE = "jsx keys are not in the index state; use moku_files_find";

/**
 * What moku_project answers before the hub published a project state: the index is still opening,
 * or the bin is older than the project index.
 */
const NOT_PUBLISHED =
  "moku-editor has not published the project index yet. Call moku_project again in a moment.";

/**
 * The error of moku_project with both a path and a prefix.
 */
const ONE_QUESTION = "pass at most one of path (a file) or prefix (keys)";

/**
 * The files of the running bin that MCP never shows: the discovery file and the bin log.
 */
const PRIVATE_FILES: readonly string[] = [DISCOVERY_FILE, LOG_FILE];

/**
 * The `path` argument of a file.
 */
const PATH_PROPERTY: PropertySchema = {
  type: "string",
  minLength: 1,
  description: "A path relative to the project root, such as src/nodes/merge.ts."
};

/**
 * True for the bin's private files and their temp files, whatever the spelling (`./`, `//`,
 * `.` segments, letter case on a case-insensitive disk).
 *
 * @param path - A path relative to the root.
 * @returns Whether MCP must not show, read or write it.
 * @example
 * ```ts
 * isPrivatePath("./.moku//EDITOR.json"); // true
 * isPrivatePath(".moku/captures/claim-f25.md"); // false
 * ```
 */
export function isPrivatePath(path: string): boolean {
  const plain = normalize(path.trim()).toLowerCase();
  return PRIVATE_FILES.some(file => plain === file || plain.startsWith(`${file}.`));
}

/**
 * A picture the editor wrote, such as the crop of a reference card, read through the hub's
 * `files.readBinary`. A private path is never read; a file that cannot be read gives none, so the
 * result keeps its text.
 *
 * @param hub - The hub connection.
 * @param path - The project-relative path.
 * @returns The data URL, or undefined.
 * @example
 * ```ts
 * await readPicture(hub, ".moku/captures/coins-f1840-crop.jpg"); // "data:image/jpeg;base64,/9j/…"
 * ```
 */
export async function readPicture(hub: HubClient, path: string): Promise<string | undefined> {
  if (isPrivatePath(path)) return undefined;
  try {
    return dataUrlOf(await hub.request("files", "readBinary", { path }));
  } catch {
    return undefined;
  }
}

/**
 * The refusal of a private file.
 *
 * @param path - The path asked for.
 * @returns The isError result.
 * @example
 * ```ts
 * return refused(".moku/editor.json");
 * ```
 */
function refused(path: string): ToolResult {
  return errorResult(
    `${path} belongs to the running moku-editor (it holds the session token); MCP does not read or write it`
  );
}

/**
 * moku_files_list: the children of a folder, without the private files.
 *
 * @param call - The call: dir.
 * @param context - The tool context.
 * @returns The entries as JSON.
 */
async function list(call: ToolCall, context: ToolContext): Promise<ToolResult> {
  const hub = await context.editor.hub();
  const entries = readFileEntries(
    await hub.request("files", "list", { dir: textArgument(call.args, "dir") ?? "" })
  );
  return jsonResult(entries.filter(entry => !isPrivatePath(entry.path)));
}

/**
 * moku_files_read: the text of a file and its version.
 *
 * @param call - The call: path.
 * @param context - The tool context.
 * @returns `{ path, version }` then the file text.
 */
async function read(call: ToolCall, context: ToolContext): Promise<ToolResult> {
  const path = textArgument(call.args, "path") ?? "";
  if (isPrivatePath(path)) return refused(path);

  const hub = await context.editor.hub();
  const answer = await hub.request("files", "read", { path });
  const file = readFileText(answer);
  if (file === undefined) return jsonResult(answer);
  return { content: [textItem(jsonText({ path, version: file.version })), textItem(file.text)] };
}

/**
 * moku_files_write: an atomic write with the optional version check.
 *
 * @param call - The call: path, text, version.
 * @param context - The tool context.
 * @returns The write result `{ path, bytes, version }`.
 */
async function write(call: ToolCall, context: ToolContext): Promise<ToolResult> {
  const path = textArgument(call.args, "path") ?? "";
  if (isPrivatePath(path)) return refused(path);

  const hub = await context.editor.hub();
  const version = textArgument(call.args, "version");
  const params: JsonObject = { path, text: textArgument(call.args, "text") ?? "" };
  if (version !== undefined) params.version = version;
  const answer: Json = await hub.request("files", "write", params);
  return jsonResult(answer);
}

/**
 * Asks the project index where a key lives, with the lines read from disk now.
 *
 * @param hub - The hub connection.
 * @param key - A project-index key, such as `node:board/merge`.
 * @returns The places; empty for a key the index does not know.
 * @throws {Error} The hub's error, such as -32008 `project index off: <reason>`, or
 *   `files.find answered no places.` for another shape.
 */
async function findPlaces(hub: HubClient, key: string): Promise<Place[]> {
  const places = readPlaces(await hub.request("files", "find", { key }));
  if (places === undefined) throw new Error("[moku-editor] files.find answered no places.");
  return places;
}

/**
 * The places of a key when the project index is on, for a tool that works without them: no request
 * goes out while the published state says off, and a -32008 of `find` (the index is off, or the
 * bin has none) reads as no places too.
 *
 * @param hub - The hub connection.
 * @param key - A project-index key, such as `node:main/home`.
 * @returns The places, or undefined while the index is off.
 * @throws {Error} Any other failure of `find`.
 * @example
 * ```ts
 * await placesIfIndexed(hub, "node:main/home"); // [{ path: "nodes/home.ts", binding: "home", line: 12, hash: "9c1e" }]
 * ```
 */
export async function placesIfIndexed(hub: HubClient, key: string): Promise<Place[] | undefined> {
  if (hub.project()?.state === "off") return undefined;
  try {
    return await findPlaces(hub, key);
  } catch (error) {
    if (isWireError(error) && error.code === errorCode.notInstalled) return undefined;
    throw error;
  }
}

/**
 * moku_files_find: the places of a project-index key; a key the index does not know is a plain
 * line, and an index that is off is the hub's error.
 *
 * @param call - The call: key.
 * @param context - The tool context.
 * @returns The places as JSON, or "No place for <key>.".
 */
async function find(call: ToolCall, context: ToolContext): Promise<ToolResult> {
  const key = textArgument(call.args, "key") ?? "";
  const hub = await context.editor.hub();
  const places = await findPlaces(hub, key);
  return places.length === 0 ? { content: [textItem(`No place for ${key}.`)] } : jsonResult(places);
}

/**
 * The namespace of a project-index key: its text up to the first colon, with the colon.
 *
 * @param key - A key.
 * @returns The prefix; the key itself when it has no colon.
 * @example
 * ```ts
 * namespaceOf("node:board/merge"); // "node:"
 * namespaceOf("style:features/ui/popup.tsx#popupScreen"); // "style:"
 * ```
 */
function namespaceOf(key: string): string {
  const colon = key.indexOf(":");
  return colon === -1 ? key : key.slice(0, colon + 1);
}

/**
 * How many keys each namespace of the index has, in the order the namespaces first appear.
 *
 * @param index - The project index.
 * @returns Namespace to its key count.
 * @example
 * ```ts
 * namespacesOf(index); // Map { "flow:" => 3, "node:" => 12, "textStyle:" => 8, "style:" => 41 }
 * ```
 */
function namespacesOf(index: ProjectIndex): Map<string, number> {
  const counts = new Map<string, number>();
  for (const key of Object.keys(index.defs)) {
    const namespace = namespaceOf(key);
    counts.set(namespace, (counts.get(namespace) ?? 0) + 1);
  }
  return counts;
}

/**
 * The summary of the index: its revision, the asset manifest when the game has one, how many keys
 * it knows, the broken files with their first parse error, and the key count per namespace.
 *
 * @param index - The project index.
 * @returns `{ state, revision, manifest?, keys, broken, prefixes }`.
 * @example
 * ```ts
 * summaryOf(index);
 * // { state: "on", revision: "9c1e…", manifest: "manifest.json", keys: 64, broken: {}, prefixes: { "flow:": 3, "node:": 12 } }
 * ```
 */
function summaryOf(index: ProjectIndex): JsonShaped {
  const { revision, manifest, defs, broken } = index;
  return {
    state: "on",
    revision,
    ...(manifest === undefined ? {} : { manifest }),
    keys: Object.keys(defs).length,
    broken,
    prefixes: Object.fromEntries(namespacesOf(index))
  };
}

/**
 * The keys that start with a prefix, each with its def paths. The JSX keys are not in the state:
 * their prefix points at moku_files_find. A prefix no key starts with names the namespaces the
 * index has, so a mistyped one is seen.
 *
 * @param index - The project index.
 * @param prefix - The start of the keys, such as `node:` or `node:board/`.
 * @returns Key to def paths as JSON, or a plain line.
 */
function keysResult(index: ProjectIndex, prefix: string): ToolResult {
  const asksJsx = prefix === JSX || prefix.startsWith(`${JSX}:`);
  if (asksJsx) return { content: [textItem(JSX_NOT_IN_STATE)] };

  const keys = Object.entries(index.defs).filter(([key]) => key.startsWith(prefix));
  if (keys.length > 0) return jsonResult(Object.fromEntries(keys));

  const known = [...namespacesOf(index).keys()].join(", ");
  return { content: [textItem(`No key starts with ${prefix}. The index has ${known}.`)] };
}

/**
 * The keys of a key map whose paths hold a file.
 *
 * @param map - Key to paths: the defs or the uses of the index.
 * @param path - A root-relative file.
 * @returns The keys, in map order.
 * @example
 * ```ts
 * keysOf({ "node:board/merge": ["nodes/merge.ts"], "flow:board": ["flows/board.ts"] }, "nodes/merge.ts");
 * // ["node:board/merge"]
 * ```
 */
function keysOf(map: Readonly<Record<string, readonly string[]>>, path: string): string[] {
  return Object.entries(map).flatMap(([key, paths]) => (paths.includes(path) ? [key] : []));
}

/**
 * What a file holds: the keys it defines, the keys it uses and, when it does not parse, its first
 * parse error. The path may be spelled with `./` or doubled slashes.
 *
 * @param index - The project index.
 * @param asked - The root-relative file, as given.
 * @returns `{ defines, uses, broken? }`.
 * @example
 * ```ts
 * fileOf(index, "./flows/board.ts"); // { defines: ["flow:board"], uses: ["node:board/merge"] }
 * ```
 */
function fileOf(index: ProjectIndex, asked: string): JsonShaped {
  const path = normalize(asked.trim());
  const broken = Object.hasOwn(index.broken, path) ? index.broken[path] : undefined;
  return {
    defines: keysOf(index.defs, path),
    uses: keysOf(index.uses, path),
    ...(broken === undefined ? {} : { broken })
  };
}

/**
 * moku_project: the project index the hub published, with no request to the hub. No argument is
 * the summary, `prefix` the keys that start with it, `path` what a file defines and uses. An index
 * that is off answers `{ state: "off", reason }`.
 *
 * @param call - The call: path or prefix, at most one.
 * @param context - The tool context.
 * @returns The JSON of the question, a plain line, or isError for both arguments.
 */
async function project(call: ToolCall, context: ToolContext): Promise<ToolResult> {
  const path = textArgument(call.args, "path");
  const prefix = textArgument(call.args, "prefix");
  if (path !== undefined && prefix !== undefined) return errorResult(ONE_QUESTION);

  // The state the hub keeps; a call that just connected waits a moment for the hub's replay.
  const hub = await context.editor.hub();
  const state = await replayed(() => hub.project());
  if (state === undefined) return { content: [textItem(NOT_PUBLISHED)] };
  if (state.state === "off") return jsonResult({ state: "off", reason: state.reason });

  if (prefix !== undefined) return keysResult(state, prefix);
  return jsonResult(path === undefined ? summaryOf(state) : fileOf(state, path));
}

/**
 * moku_files_list.
 */
export const filesListTool: Tool = {
  name: "moku_files_list",
  title: "List files",
  description:
    "The folders and the editable files (ts, tsx, json, md, css and .moku/) of a folder of the project, with sizes and versions.",
  inputSchema: {
    type: "object",
    properties: {
      dir: { type: "string", description: 'A folder relative to the project root; "" is the root.' }
    },
    additionalProperties: false
  },
  annotations: READ_ONLY,
  run: list
};

/**
 * moku_files_read.
 */
export const filesReadTool: Tool = {
  name: "moku_files_read",
  title: "Read a file",
  description:
    "The text of a project file and its version; pass the version to moku_files_write to make sure nobody changed the file in between.",
  inputSchema: {
    type: "object",
    properties: { path: PATH_PROPERTY },
    required: ["path"],
    additionalProperties: false
  },
  annotations: READ_ONLY,
  run: read
};

/**
 * moku_files_write.
 */
export const filesWriteTool: Tool = {
  name: "moku_files_write",
  title: "Write a file",
  description:
    "Writes a project file atomically, inside the editor's sandbox (ts, tsx, json, md, css and .moku/). With version, the write fails when the file changed since that version. Bun hot reload picks the change up.",
  inputSchema: {
    type: "object",
    properties: {
      path: PATH_PROPERTY,
      text: { type: "string", description: "The whole new text of the file." },
      version: {
        type: "string",
        minLength: 1,
        description: "The version moku_files_read answered."
      }
    },
    required: ["path", "text"],
    additionalProperties: false
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false
  },
  run: write
};

/**
 * moku_files_find: tells an MCP client where a key of the project index lives (file, binding and
 * line), so it opens the right file without a search. The lines are read from disk at the call.
 */
export const filesFindTool: Tool = {
  name: "moku_files_find",
  title: "Find a key in the project",
  description:
    'Where a key of the project index lives: its places as JSON, each with path, binding (the const or function that holds it), line, hash (the version of the file, for moku_files_write) and broken when the file does not parse now. Keys: node:<flow>/<node> (node:board/merge), flow:<flow> (flow:board), jsx:<ui key> (jsx:coins), textStyle:<key> (textStyle:ui.title), style:<file>#<name> (style:features/ui/popup.tsx#popupScreen). A key the index does not know answers "No place for <key>.". moku_project lists the keys.',
  inputSchema: {
    type: "object",
    properties: {
      key: {
        type: "string",
        minLength: 1,
        maxLength: KEY_MAX,
        description: "A project-index key with its prefix, such as node:board/merge or jsx:coins."
      }
    },
    required: ["key"],
    additionalProperties: false
  },
  annotations: READ_ONLY,
  run: find
};

/**
 * moku_project: shows an MCP client the project index the editor keeps: how many keys of which
 * kind, the keys of one kind with their files, or what one file defines and uses.
 */
export const projectTool: Tool = {
  name: "moku_project",
  title: "Project index",
  description:
    'The project index of the game: which file defines which flow, node, text style and style. With no argument: { state, revision, manifest, keys, broken, prefixes }, where keys is the key count, broken the files that do not parse with their first error, and prefixes the key count per prefix (node:, flow:, textStyle:, style:). prefix lists the keys that start with it, each with its files. path answers { defines, uses, broken } for one file. Pass at most one of them. jsx keys are not in this state: find them with moku_files_find. An index that is off answers { state: "off", reason }.',
  inputSchema: {
    type: "object",
    properties: {
      path: PATH_PROPERTY,
      prefix: {
        type: "string",
        minLength: 1,
        description: "The start of the keys to list, such as node: or node:board/."
      }
    },
    additionalProperties: false
  },
  annotations: READ_ONLY,
  run: project
};
