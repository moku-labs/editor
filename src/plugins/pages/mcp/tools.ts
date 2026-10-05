/**
 * @file pages/mcp — the tool table of the bridge (M5): the generic `moku_*` tools with fixed input
 * schemas (`additionalProperties: false`) and static annotations (M6), and the runner that turns
 * any failure into an `isError` result. The door tools of the selected session come after them
 * (`door-tools.ts`).
 */
import { reloadTool, startTool, stopTool } from "./editor-tools";
import { filesListTool, filesReadTool, filesWriteTool } from "./file-tools";
import { manifestTool, readTool, runTool, sessionsTool, statusTool, waitTool } from "./game-tools";
import { referenceTool, screenshotTool, seriesTool } from "./picture-tools";
import { failureResult } from "./results";
import { selectionTool, selectTool } from "./selection-tools";
import type { Tool, ToolCall, ToolContext, ToolDefinition, ToolResult } from "./types";

/**
 * Every generic tool, in the order `tools/list` shows them (the door tools follow).
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
  selectionTool,
  selectTool,
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
