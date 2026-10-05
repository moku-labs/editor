/**
 * @file pages/mcp — the editor and game tools of the bridge (M5): moku_status, moku_sessions,
 * moku_manifest, moku_read, moku_run and moku_wait. Each goes through the hub exactly as the
 * tools page does: the hub picks the session, checks the id and the input.
 */
import type { Json } from "../../registry/protocol";
import { bareMessage } from "../../registry/protocol";
import type { EditorDiscovery } from "../types";
import { jsonResult, jsonText, textItem } from "./results";
import {
  INPUT_PROPERTY,
  NO_ARGUMENTS,
  numberArgument,
  READ_ONLY,
  SESSION_PROPERTY,
  textArgument
} from "./schema";
import { commandOf, readRunResult } from "./shapes";
import type { HubClient, JsonObject, Tool, ToolCall, ToolContext, ToolResult } from "./types";
import type { WaitRule } from "./wait";
import { waitForValue } from "./wait";

/**
 * The default and the longest wait of moku_wait.
 */
const WAIT_DEFAULT_MS = 10_000;

/**
 * The longest wait of moku_wait (under Claude Code's default tool timeout).
 */
const WAIT_MAX_MS = 25_000;

/**
 * The shortest wait of moku_wait.
 */
const WAIT_MIN_MS = 100;

/**
 * The `id` argument of a source.
 */
const SOURCE_ID = {
  type: "string",
  minLength: 1,
  description: "Source id from moku_manifest, such as game.position."
} as const;

/**
 * The URL of the tools page of a bin: its socket URL without `/ws`, over http.
 *
 * @param bin - The discovery record.
 * @returns `http://127.0.0.1:<port><P>/`.
 * @example
 * ```ts
 * toolsUrl(bin); // "http://127.0.0.1:3000/__editor/"
 * ```
 */
function toolsUrl(bin: EditorDiscovery): string {
  return bin.ws.replace(/^ws/, "http").replace(/\/ws$/, "/");
}

/**
 * The params of a read or a run: the id, and the input when given.
 *
 * @param id - The source or command id.
 * @param input - The input, or undefined.
 * @returns `{ id }` or `{ id, input }`.
 * @example
 * ```ts
 * callParams("game.step", { frames: 1 }); // { id: "game.step", input: { frames: 1 } }
 * ```
 */
function callParams(id: string, input: Json | undefined): JsonObject {
  return input === undefined ? { id } : { id, input };
}

/**
 * moku_status: the bin (running, owned, URLs, root, html), hot reload and the sessions. Answers
 * `running: false` with the hint when no bin runs (never isError).
 *
 * @param _call - The call (no arguments).
 * @param context - The tool context.
 * @returns The status as JSON.
 */
async function status(_call: ToolCall, context: ToolContext): Promise<ToolResult> {
  let hub: HubClient;
  try {
    hub = await context.editor.hub();
  } catch (error) {
    const hint = bareMessage(error instanceof Error ? error.message : String(error));
    return jsonResult({ running: false, owned: context.editor.status().owned, hint });
  }

  const { bin } = hub;
  return jsonResult({
    running: true,
    owned: context.editor.status().owned,
    url: `${bin.url}/`,
    tools: toolsUrl(bin),
    port: bin.port,
    pid: bin.pid,
    root: bin.root,
    html: bin.html,
    hotReload: hub.hotReload() ?? "unknown",
    sessions: hub.sessions()
  });
}

/**
 * moku_run: runs a command; the text starts with its effect from the manifest.
 *
 * @param call - The call: id, input, session.
 * @param context - The tool context.
 * @returns `effect: <effect>` and the envelope (value, frame, state).
 */
async function runCommand(call: ToolCall, context: ToolContext): Promise<ToolResult> {
  const hub = await context.editor.hub();
  const id = textArgument(call.args, "id") ?? "";
  const session = textArgument(call.args, "session");
  const manifest = await hub.request("game", "manifest", {}, session);
  const effect = commandOf(manifest, id)?.effect ?? "unknown";

  const ran = await hub.request("game", "run", callParams(id, call.args.input), session);
  const result = readRunResult(ran);
  const envelope =
    result === undefined
      ? ran
      : { value: result.value, frame: result.state.frame, state: result.state };
  return { content: [textItem(`effect: ${effect}\n${jsonText(envelope)}`)] };
}

/**
 * The rule of a moku_wait call: `until`, else `changedFrom`, else the first change. A JSON null
 * counts as given.
 *
 * @param args - The checked arguments.
 * @returns The rule.
 * @example
 * ```ts
 * ruleOf({ id: "game.position", until: { path: "board" } }); // { kind: "until", value: { path: "board" } }
 * ```
 */
function ruleOf(args: JsonObject): WaitRule {
  const { until, changedFrom } = args;
  if (until !== undefined) return { kind: "until", value: until };
  if (changedFrom !== undefined) return { kind: "changedFrom", value: changedFrom };
  return { kind: "change" };
}

/**
 * moku_wait: watches a source until the rule matches or the time is up.
 *
 * @param call - The call: id, input, until, changedFrom, timeoutMs, session.
 * @param context - The tool context.
 * @returns `{ timedOut, value, waitedMs }`.
 */
async function wait(call: ToolCall, context: ToolContext): Promise<ToolResult> {
  const hub = await context.editor.hub();
  const { args } = call;
  const target = {
    id: textArgument(args, "id") ?? "",
    input: args.input,
    session: textArgument(args, "session")
  };
  const timeoutMs = numberArgument(args, "timeoutMs", WAIT_DEFAULT_MS);
  const outcome = await waitForValue(hub, target, ruleOf(args), {
    timeoutMs,
    call,
    now: context.now
  });
  const value = outcome.value === undefined ? "no value arrived" : outcome.value;
  return jsonResult({ ...outcome, value });
}

/**
 * moku_status.
 */
export const statusTool: Tool = {
  name: "moku_status",
  title: "Editor status",
  description:
    "Whether moku-editor runs and whether this bridge started it, the game and tools page URLs, the hot reload state and the game sessions with their liveness (frame, paused, silent). Call it first.",
  inputSchema: NO_ARGUMENTS,
  annotations: READ_ONLY,
  run: status
};

/**
 * moku_sessions.
 */
export const sessionsTool: Tool = {
  name: "moku_sessions",
  title: "Game sessions",
  description:
    "The connected game pages: id, game, page, embedded (inside the tools page) and heartbeat { frame, paused, silent }. Pass an id as session to the game tools when several games are connected.",
  inputSchema: NO_ARGUMENTS,
  annotations: READ_ONLY,
  run: async (_call, context) => {
    const hub = await context.editor.hub();
    return jsonResult(hub.sessions());
  }
};

/**
 * moku_manifest.
 */
export const manifestTool: Tool = {
  name: "moku_manifest",
  title: "Sources and commands",
  description:
    "What the game offers: its sources (id, title, input kinds, changes) for moku_read and moku_wait, and its commands (id, title, input kinds, effect) for moku_run.",
  inputSchema: {
    type: "object",
    properties: { session: SESSION_PROPERTY },
    additionalProperties: false
  },
  annotations: READ_ONLY,
  run: async (call, context) => {
    const hub = await context.editor.hub();
    return jsonResult(
      await hub.request("game", "manifest", {}, textArgument(call.args, "session"))
    );
  }
};

/**
 * moku_read.
 */
export const readTool: Tool = {
  name: "moku_read",
  title: "Read a source",
  description:
    "Reads a game source now, such as game.position or game.history, and answers its JSON value.",
  inputSchema: {
    type: "object",
    properties: { id: SOURCE_ID, input: INPUT_PROPERTY, session: SESSION_PROPERTY },
    required: ["id"],
    additionalProperties: false
  },
  annotations: READ_ONLY,
  run: async (call, context) => {
    const hub = await context.editor.hub();
    const params = callParams(textArgument(call.args, "id") ?? "", call.args.input);
    return jsonResult(
      await hub.request("game", "read", params, textArgument(call.args, "session"))
    );
  }
};

/**
 * moku_run.
 */
export const runTool: Tool = {
  name: "moku_run",
  title: "Run a command",
  description:
    "Runs a game or editor command, such as game.step, game.pause or game.tap, and answers its value with the frame and the run state. The text starts with the command's effect (read, route, cosmetic, cheat or raw); moku_manifest lists them.",
  inputSchema: {
    type: "object",
    properties: {
      id: {
        type: "string",
        minLength: 1,
        description: "Command id from moku_manifest, such as game.step."
      },
      input: INPUT_PROPERTY,
      session: SESSION_PROPERTY
    },
    required: ["id"],
    additionalProperties: false
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false
  },
  run: runCommand
};

/**
 * moku_wait.
 */
export const waitTool: Tool = {
  name: "moku_wait",
  title: "Wait for a source",
  description:
    "Watches a source until its value deep-equals until, or differs from changedFrom, or (with neither) first changes after the current value. Answers { timedOut, value, waitedMs }; on a timeout the value is the last one seen. Frame sources update about once per second.",
  inputSchema: {
    type: "object",
    properties: {
      id: SOURCE_ID,
      input: INPUT_PROPERTY,
      until: { description: "Resolve when the value deep-equals this JSON value." },
      changedFrom: { description: "Resolve when the value differs from this JSON value." },
      timeoutMs: {
        type: "integer",
        minimum: WAIT_MIN_MS,
        maximum: WAIT_MAX_MS,
        default: WAIT_DEFAULT_MS,
        description: "The longest wait in ms."
      },
      session: SESSION_PROPERTY
    },
    required: ["id"],
    additionalProperties: false
  },
  annotations: READ_ONLY,
  run: wait
};
