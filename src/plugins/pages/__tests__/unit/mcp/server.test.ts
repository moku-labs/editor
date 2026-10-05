/* eslint-disable unicorn/no-null -- JSON-RPC answers a parse error with id null */
import { describe, expect, it, vi } from "vitest";
import { createMcpServer, negotiateVersion, PROTOCOL_VERSIONS } from "../../../mcp/server";
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
// pages/mcp server (M1, M5, M6): initialize negotiation, ping, tools/list,
// tools/call, the error codes, notifications that are never answered,
// cancellation and progress, and the static tool table.
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
 * @param tools - The tools.
 */
function serve(tools: readonly Tool[] = TOOLS) {
  const frames: OutgoingFrame[] = [];
  const context: ToolContext = { editor: idleEditor(), now: Date.now };
  const server = createMcpServer({
    send: frame => frames.push(frame),
    tools,
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
          serverInfo: { name: "moku-editor", version: "9.9.9" }
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

  it("sends tools/list_changed only after notifications/initialized", () => {
    const { server, frames, send } = serve();
    server.toolsChanged();
    expect(frames).toEqual([]);
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    server.toolsChanged();
    expect(frames).toEqual([{ jsonrpc: "2.0", method: "notifications/tools/list_changed" }]);
  });
});

describe("tools/list", () => {
  it("lists the seventeen moku tools with closed object schemas", async () => {
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
