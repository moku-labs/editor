/**
 * @file pages/mcp — the files tools (M5, M6): moku_files_list, moku_files_read and
 * moku_files_write through the hub's files channel (the D-09 sandbox and its version check). The
 * bin's own `.moku/editor.json` (it holds the token) and `.moku/editor.log` are hidden from the
 * list and refused.
 */
import { normalize } from "node:path/posix";
import type { Json } from "../../registry/protocol";
import { DISCOVERY_FILE } from "../discovery";
import { LOG_FILE } from "./launcher";
import { errorResult, jsonResult, jsonText, textItem } from "./results";
import { READ_ONLY, textArgument } from "./schema";
import { readFileEntries, readFileText } from "./shapes";
import type { JsonObject, PropertySchema, Tool, ToolCall, ToolContext, ToolResult } from "./types";

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
