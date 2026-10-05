/**
 * @file pages/mcp — the tool table of the bridge (M5): fifteen `moku_*` tools with fixed input
 * schemas (`additionalProperties: false`) and static annotations (M6), and the runner that turns
 * any failure into an `isError` result.
 */
import { reloadTool, startTool, stopTool } from "./editor-tools";
import { filesListTool, filesReadTool, filesWriteTool } from "./file-tools";
import { manifestTool, readTool, runTool, sessionsTool, statusTool, waitTool } from "./game-tools";
import { referenceTool, screenshotTool, seriesTool } from "./picture-tools";
import { failureResult } from "./results";
import type { Tool, ToolCall, ToolContext, ToolDefinition, ToolResult } from "./types";

/**
 * Every tool, in the order `tools/list` shows them.
 */
export const TOOLS: readonly Tool[] = [
  statusTool,
  sessionsTool,
  manifestTool,
  readTool,
  waitTool,
  runTool,
  screenshotTool,
  seriesTool,
  referenceTool,
  filesListTool,
  filesReadTool,
  filesWriteTool,
  reloadTool,
  startTool,
  stopTool
];

/**
 * The `tools/list` entry of a tool: its definition without the function.
 *
 * @param tool - The tool.
 * @returns name, title, description, inputSchema and annotations.
 * @example
 * ```ts
 * TOOLS.map(tool => definitionOf(tool).name); // ["moku_status", "moku_sessions", …]
 * ```
 */
export function definitionOf(tool: Tool): ToolDefinition {
  const { name, title, description, inputSchema, annotations } = tool;
  return { name, title, description, inputSchema, annotations };
}

/**
 * Runs a tool; a thrown error becomes an `isError` result (`choose_session` lists the sessions).
 *
 * @param tool - The tool.
 * @param call - The checked arguments, the signal and the progress reporter.
 * @param context - The tool context.
 * @returns The tool's result, or the failure result.
 * @example
 * ```ts
 * const result = await runToolSafely(screenshotTool, { args: {}, signal, progress }, context);
 * result.content[0]; // { type: "text", text: '{ "frame": 1840, … }' }
 * ```
 */
export async function runToolSafely(
  tool: Tool,
  call: ToolCall,
  context: ToolContext
): Promise<ToolResult> {
  try {
    return await tool.run(call, context);
  } catch (error) {
    return failureResult(error, context.editor.connected()?.sessions() ?? []);
  }
}
