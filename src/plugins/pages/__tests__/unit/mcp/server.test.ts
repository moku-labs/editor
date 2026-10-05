/* eslint-disable unicorn/no-null -- JSON-RPC answers a parse error with id null */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMcpServer,
  INSTRUCTIONS,
  negotiateVersion,
  PROTOCOL_VERSIONS
} from "../../../mcp/server";
import { TOOLS } from "../../../mcp/tools";
import type {
  EditorLink,
  OutgoingFrame,
  Tool,
  ToolCall,
  ToolContext,
  ToolResult
} from "../../../mcp/types";

// ─────────────────────────────────────────────────────────────────────────────
// pages/mcp server (M1, M5, M6): initialize negotiation and instructions, ping,
// tools/list (read per request; the first waits for the door tools at most
// 3 s), tools/call (a retired door answers isError), the error codes,
// notifications that are never answered, a tools change kept until
// initialized, cancellation and progress, and the static tool table.
// ─────────────────────────────────────────────────────────────────────────────

/** An EditorLink that never connects. */
function idleEditor(): EditorLink {
  return {
    start: () => Promise.resolve(),
    hub: () => Promise.reject(new Error("[moku-editor] not running")),
    connected: () => undefined,
    status: () => ({ running: false, owned: false, bin: undefined }),
    launch: vi.fn(),
    stopOwned: vi.fn(),
    shutdown: () => Promise.resolve()
  };
}

/** A stub tool that runs `run`. */
function stubTool(run: (call: ToolCall) => Promise<ToolResult>): Tool {
  return {
    name: "stub",
    title: "Stub",
    description: "A stub.",
    inputSchema: {
      type: "object",
      properties: { n: { type: "integer", minimum: 0, maximum: 9, description: "n" } },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: call => run(call)
  };
}

/**
 * A server over stub tools that records its frames.
 *
 * @param tools - The tools, or the getter of the tools now.
 * @param doors - The door set seams: ready and the retired names (default: ready, none).
 * @param doors.ready - What the first tools/list waits for.
 * @param doors.retired - The names that are gone.
 */
function serve(
  tools: readonly Tool[] | (() => readonly Tool[]) = TOOLS,
  doors: { ready?: () => Promise<void>; retired?: () => ReadonlySet<string> } = {}
) {
  const frames: OutgoingFrame[] = [];
  const context: ToolContext = { editor: idleEditor(), now: Date.now };
  const server = createMcpServer({
    send: frame => frames.push(frame),
    tools: typeof tools === "function" ? tools : () => tools,
    ready: doors.ready ?? (() => Promise.resolve()),
    retired: doors.retired ?? (() => new Set()),
    context,
    version: "9.9.9"
  });
  /** Sends one message as a line. */
  const send = (message: object): void => server.handleLine(JSON.stringify(message));
  return { server, frames, send };
}

describe("initialize", () => {
  it.each(PROTOCOL_VERSIONS)("echoes the supported version %s", async version => {
    const { server, frames, send } = serve();
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: version } });
    await server.idle();
    expect(frames).toEqual([
      {
        jsonrpc: "2.0",
        id: 1,
        result: {
          protocolVersion: version,
          capabilities: { tools: { listChanged: true }, logging: {} },
          serverInfo: { name: "moku-editor", version: "9.9.9" },
          instructions: INSTRUCTIONS
        }
      }
    ]);
  });

  it("answers the newest version for an unknown one", async () => {
    expect(negotiateVersion("2024-11-05")).toBe("2025-11-25");
    const { server, frames, send } = serve();
    send({
      jsonrpc: "2.0",
      id: 2,
      method: "initialize",
      params: { protocolVersion: "1999-01-01" }
    });
    await server.idle();
    expect(frames[0]).toMatchObject({ result: { protocolVersion: "2025-11-25" } });
  });

  it("answers -32602 without a protocolVersion", async () => {
    const { server, frames, send } = serve();
    send({ jsonrpc: "2.0", id: 3, method: "initialize", params: {} });
    await server.idle();
    expect(frames[0]).toMatchObject({ id: 3, error: { code: -32_602 } });
  });
});

describe("requests and notifications", () => {
  it("answers ping and logging/setLevel with {}", async () => {
    const { server, frames, send } = serve();
    send({ jsonrpc: "2.0", id: "p", method: "ping" });
    send({ jsonrpc: "2.0", id: 9, method: "logging/setLevel", params: { level: "debug" } });
    await server.idle();
    expect(frames).toEqual([
      { jsonrpc: "2.0", id: "p", result: {} },
      { jsonrpc: "2.0", id: 9, result: {} }
    ]);
  });

  it("answers -32601 for an unknown method and -32700 for a line that is not JSON", async () => {
    const { server, frames, send } = serve();
    send({ jsonrpc: "2.0", id: 4, method: "resources/list" });
    server.handleLine("{oops");
    await server.idle();
    expect(frames).toContainEqual({
      jsonrpc: "2.0",
      id: 4,
      error: { code: -32_601, message: "method not found: resources/list" }
    });
    expect(frames).toContainEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32_700, message: "parse error" }
    });
  });

  it("never answers a notification or a response", async () => {
    const { server, frames, send } = serve();
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", method: "notifications/whatever", params: { a: 1 } });
    send({ jsonrpc: "2.0", method: "ping" });
    send({ jsonrpc: "2.0", id: 1, result: {} });
    await server.idle();
    expect(frames).toEqual([]);
  });

  it("keeps a tools change from before notifications/initialized and sends it once after", () => {
    const { server, frames, send } = serve();
    server.toolsChanged();
    server.toolsChanged();
    expect(frames).toEqual([]);
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    const changed = { jsonrpc: "2.0", method: "notifications/tools/list_changed" };
    expect(frames).toEqual([changed]);
    server.toolsChanged();
    expect(frames).toEqual([changed, changed]);
  });

  it("sends nothing on notifications/initialized without a change before it", () => {
    const { frames, send } = serve();
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(frames).toEqual([]);
  });
});

describe("tools/list", () => {
  it("lists the generic moku tools with closed object schemas", async () => {
    const { server, frames, send } = serve();
    send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    await server.idle();
    const frame = frames[0];
    const tools = frame !== undefined && "result" in frame ? frame.result : undefined;
    expect(tools).toMatchSnapshot();
    expect(TOOLS.map(tool => tool.name)).toEqual([
      "moku_status",
      "moku_sessions",
      "moku_manifest",
      "moku_read",
      "moku_wait",
      "moku_run",
      "moku_screenshot",
      "moku_series",
      "moku_reference",
      "moku_selection",
      "moku_select",
      "moku_files_list",
      "moku_files_read",
      "moku_files_write",
      "moku_reload",
      "moku_start",
      "moku_stop"
    ]);
    for (const tool of TOOLS) {
      expect(tool.inputSchema).toMatchObject({ type: "object", additionalProperties: false });
      expect(tool.name).toMatch(/^moku_[a-z_]+$/);
    }
  });

  it("carries static annotations: read-only tools, and the worst case of the others (M6)", () => {
    const annotations = Object.fromEntries(TOOLS.map(tool => [tool.name, tool.annotations]));
    const readOnly = { readOnlyHint: true, openWorldHint: false };
    expect(annotations).toEqual({
      moku_status: readOnly,
      moku_sessions: readOnly,
      moku_manifest: readOnly,
      moku_read: readOnly,
      moku_wait: readOnly,
      moku_run: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false
      },
      moku_screenshot: readOnly,
      moku_series: readOnly,
      moku_reference: readOnly,
      moku_selection: readOnly,
      moku_select: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      },
      moku_files_list: readOnly,
      moku_files_read: readOnly,
      moku_files_write: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false
      },
      moku_reload: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      },
      moku_start: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      },
      moku_stop: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false
      }
    });
  });
});

describe("tools/call", () => {
  it("runs the tool with its checked arguments", async () => {
    const run = vi.fn((call: ToolCall) =>
      Promise.resolve({ content: [{ type: "text" as const, text: JSON.stringify(call.args) }] })
    );
    const { server, frames, send } = serve([stubTool(run)]);
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "stub", arguments: { n: 2 } }
    });
    await server.idle();
    expect(frames).toEqual([
      { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: '{"n":2}' }] } }
    ]);
  });

  it("answers -32602 without a name or for an unknown tool", async () => {
    const { server, frames, send } = serve([]);
    send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: {} });
    send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "moku_eval" } });
    await server.idle();
    expect(frames).toContainEqual({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32_602, message: "tools/call needs a tool name" }
    });
    expect(frames).toContainEqual({
      jsonrpc: "2.0",
      id: 2,
      error: { code: -32_602, message: "unknown tool: moku_eval" }
    });
  });

  it("answers bad arguments and a throwing tool as isError results", async () => {
    const tool = stubTool(() => Promise.reject(new Error("[moku-editor] boom")));
    const { server, frames, send } = serve([tool]);
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "stub", arguments: { n: 99 } }
    });
    send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "stub" } });
    await server.idle();
    expect(frames).toContainEqual({
      jsonrpc: "2.0",
      id: 1,
      result: { content: [{ type: "text", text: "n must be at most 9" }], isError: true }
    });
    expect(frames).toContainEqual({
      jsonrpc: "2.0",
      id: 2,
      result: { content: [{ type: "text", text: "boom" }], isError: true }
    });
  });

  it("sends notifications/progress only when the request carries a progressToken", async () => {
    const tool = stubTool(call => {
      call.progress(0, 100);
      call.progress(50);
      return Promise.resolve({ content: [] });
    });
    const { server, frames, send } = serve([tool]);
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "stub", _meta: { progressToken: "tok" } }
    });
    send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "stub" } });
    await server.idle();
    expect(frames.filter(frame => "method" in frame)).toEqual([
      {
        jsonrpc: "2.0",
        method: "notifications/progress",
        params: { progressToken: "tok", progress: 0, total: 100 }
      },
      {
        jsonrpc: "2.0",
        method: "notifications/progress",
        params: { progressToken: "tok", progress: 50 }
      }
    ]);
  });

  it("aborts a cancelled call and sends no response for it", async () => {
    let signal: AbortSignal | undefined;
    const tool = stubTool(
      call =>
        new Promise(resolve => {
          signal = call.signal;
          call.signal.addEventListener("abort", () => resolve({ content: [] }));
        })
    );
    const { server, frames, send } = serve([tool]);
    send({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "stub" } });
    send({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 7 } });
    await server.idle();
    expect(signal?.aborted).toBe(true);
    expect(frames).toEqual([]);
  });

  it("cancelAll aborts every call in flight", async () => {
    const signals: AbortSignal[] = [];
    const tool = stubTool(
      call =>
        new Promise(resolve => {
          signals.push(call.signal);
          call.signal.addEventListener("abort", () => resolve({ content: [] }));
        })
    );
    const { server, frames, send } = serve([tool]);
    send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "stub" } });
    send({ jsonrpc: "2.0", id: "two", method: "tools/call", params: { name: "stub" } });
    server.cancelAll();
    await server.idle();
    expect(signals.map(signal => signal.aborted)).toEqual([true, true]);
    expect(frames).toEqual([]);
  });
});

/** A stub tool with another name. */
function named(name: string): Tool {
  return { ...stubTool(() => Promise.resolve({ content: [] })), name };
}

/** The names of a tools/list answer. */
function listed(frame: OutgoingFrame | undefined): string[] {
  const result = frame !== undefined && "result" in frame ? frame.result : undefined;
  const tools =
    typeof result === "object" && result !== null && "tools" in result ? result.tools : [];
  return Array.isArray(tools) ? tools.map(tool => String(tool?.name)) : [];
}

describe("door tools in the server (D-35)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads the tools getter on every tools/list and tools/call", async () => {
    let tools: readonly Tool[] = [named("moku_status")];
    const { server, frames, send } = serve(() => tools);
    send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    await server.idle();
    tools = [named("moku_status"), named("game_tap")];
    send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "game_tap" } });
    await server.idle();
    expect(listed(frames[0])).toEqual(["moku_status"]);
    expect(listed(frames[1])).toEqual(["moku_status", "game_tap"]);
    expect(frames[2]).toEqual({ jsonrpc: "2.0", id: 3, result: { content: [] } });
  });

  it("answers the first tools/list once ready settles", async () => {
    const ready = Promise.withResolvers<void>();
    let tools: readonly Tool[] = [named("moku_status")];
    const { server, frames, send } = serve(() => tools, { ready: () => ready.promise });
    send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    await Promise.resolve();
    expect(frames).toEqual([]);
    tools = [named("moku_status"), named("game_tap")];
    ready.resolve();
    await server.idle();
    expect(listed(frames[0])).toEqual(["moku_status", "game_tap"]);
  });

  it("waits for ready at most 3 s on the first tools/list; later lists do not wait", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const never = new Promise<void>(() => undefined);
    const { server, frames, send } = serve([named("moku_status")], { ready: () => never });
    send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    await vi.advanceTimersByTimeAsync(2999);
    expect(frames).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await server.idle();
    expect(listed(frames[0])).toEqual(["moku_status"]);

    send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    await server.idle();
    expect(frames[1]).toMatchObject({ id: 2 });
  });

  it("answers a retired door tool with isError, not -32602", async () => {
    const { server, frames, send } = serve([named("moku_status")], {
      retired: () => new Set(["game_tap"])
    });
    send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "game_tap" } });
    send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "game_nope" } });
    await server.idle();
    expect(frames).toContainEqual({
      jsonrpc: "2.0",
      id: 1,
      result: {
        content: [
          {
            type: "text",
            text: "game_tap is gone: the game changed. Call moku_manifest, or moku_run { id }."
          }
        ],
        isError: true
      }
    });
    expect(frames).toContainEqual({
      jsonrpc: "2.0",
      id: 2,
      error: { code: -32_602, message: "unknown tool: game_nope" }
    });
  });

  it("explains the door tools in the initialize instructions", () => {
    expect(INSTRUCTIONS).toBe(
      "moku_* tools work on any game. game_*, editor_* and <game>_* tools are command doors of the connected game, with typed input; cheat_* and raw_* change the game outside its rules. The list changes when the game reloads. Sources are read with moku_read."
    );
  });
});
