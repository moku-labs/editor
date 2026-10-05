/**
 * @file pages/mcp — the MCP dispatcher (M1): `initialize` with version negotiation,
 * `notifications/initialized`, `ping`, `tools/list`, `tools/call`, `logging/setLevel` and
 * `notifications/cancelled`. A message without an id is never answered; an unknown request is
 * -32601, bad params -32602, a line that is not JSON -32700.
 */
import type { Json } from "../../registry/protocol";
import { errorResult } from "./results";
import { errorFrame, isObject, notificationFrame, parseLine, resultFrame, rpcCode } from "./rpc";
import { checkArguments } from "./schema";
import { definitionOf, runToolSafely } from "./tools";
import type {
  JsonObject,
  JsonShaped,
  McpNotification,
  McpRequest,
  OutgoingFrame,
  Tool,
  ToolCall,
  ToolContext
} from "./types";

/**
 * The MCP protocol versions the bridge speaks, newest first.
 */
export const PROTOCOL_VERSIONS: readonly string[] = ["2025-11-25", "2025-06-18", "2025-03-26"];

/**
 * The name Claude Code shows for the server.
 */
const SERVER_NAME = "moku-editor";

/**
 * What the dispatcher needs: the frame writer, the tools, their context and the version.
 */
export type McpServerOptions = {
  /** Writes one frame to stdout. */
  readonly send: (frame: OutgoingFrame) => void;
  readonly tools: readonly Tool[];
  readonly context: ToolContext;
  /** `serverInfo.version`: the package version. */
  readonly version: string;
};

/**
 * The dispatcher of one stdio session.
 */
export type McpServer = {
  /** Handles one stdin line. */
  handleLine(line: string): void;
  /** Sends `notifications/tools/list_changed` once the client is initialized. */
  toolsChanged(): void;
  /** Aborts every tool call in flight (stdin end); their responses are not sent. */
  cancelAll(): void;
  /** Resolves when every request in flight settled. */
  idle(): Promise<void>;
};

/**
 * A request that is answered with a JSON-RPC error.
 */
class RpcError extends Error {
  /** The JSON-RPC error code. */
  readonly code: number;

  /**
   * Builds the error.
   *
   * @param code - The JSON-RPC error code.
   * @param message - What is wrong.
   * @example
   * ```ts
   * throw new RpcError(-32_602, "tools/call needs a tool name");
   * ```
   */
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * The protocol version to answer: the client's when the bridge speaks it, else the newest.
 *
 * @param requested - The client's `protocolVersion`.
 * @returns The negotiated version.
 * @example
 * ```ts
 * negotiateVersion("2025-06-18"); // "2025-06-18"
 * negotiateVersion("2024-11-05"); // "2025-11-25"
 * ```
 */
export function negotiateVersion(requested: string): string {
  return PROTOCOL_VERSIONS.includes(requested) ? requested : (PROTOCOL_VERSIONS[0] ?? requested);
}

/**
 * The key of a request id in the in-flight map (a string id and a number id never collide).
 *
 * @param id - The request id.
 * @returns The key.
 * @example
 * ```ts
 * idKey(7); // "number:7"
 * ```
 */
function idKey(id: Json | undefined): string {
  return `${typeof id}:${String(id)}`;
}

/**
 * The `_meta.progressToken` of a request's params, when there is one.
 *
 * @param params - The request params.
 * @returns The token.
 * @example
 * ```ts
 * progressTokenOf({ name: "moku_wait", _meta: { progressToken: "w-1" } }); // "w-1"
 * ```
 */
function progressTokenOf(params: JsonObject | undefined): string | number | undefined {
  const meta = params?._meta;
  const token = isObject(meta) ? meta.progressToken : undefined;
  return typeof token === "string" || typeof token === "number" ? token : undefined;
}

/**
 * Creates the dispatcher.
 *
 * @param options - Frame writer, tools, tool context and version.
 * @returns The dispatcher.
 * @example
 * ```ts
 * const server = createMcpServer({ send: frame => process.stdout.write(frameText(frame)), tools: TOOLS, context, version: VERSION });
 * await readLines(process.stdin, line => server.handleLine(line));
 * ```
 */
export function createMcpServer(options: McpServerOptions): McpServer {
  const { send, tools, context, version } = options;
  const inflight = new Map<string, AbortController>();
  const running = new Set<Promise<void>>();
  let initialized = false;

  /**
   * The `initialize` result: the negotiated version, the capabilities and the server info.
   *
   * @param params - The request params.
   * @returns The result.
   */
  function initialize(params: JsonObject | undefined): JsonShaped {
    const requested = params?.protocolVersion;
    if (typeof requested !== "string") {
      throw new RpcError(rpcCode.invalidParams, "initialize needs a protocolVersion string");
    }
    return {
      protocolVersion: negotiateVersion(requested),
      capabilities: { tools: { listChanged: true }, logging: {} },
      serverInfo: { name: SERVER_NAME, version }
    };
  }

  /**
   * A `tools/call`: the tool, its checked arguments, then the run with a cancel signal and a
   * progress reporter. Bad arguments are an `isError` result the model can correct.
   *
   * @param request - The request.
   * @returns The tool result.
   */
  async function callTool(request: McpRequest): Promise<JsonShaped> {
    const { params } = request;
    const name = params?.name;
    if (typeof name !== "string")
      throw new RpcError(rpcCode.invalidParams, "tools/call needs a tool name");
    const tool = tools.find(entry => entry.name === name);
    if (tool === undefined) throw new RpcError(rpcCode.invalidParams, `unknown tool: ${name}`);
    const args = checkArguments(tool.inputSchema, params?.arguments);
    if (typeof args === "string") return errorResult(args);

    const controller = new AbortController();
    inflight.set(idKey(request.id), controller);
    const token = progressTokenOf(params);
    const progress: ToolCall["progress"] = (done, total) => {
      if (token === undefined || controller.signal.aborted) return;
      const counts = total === undefined ? { progress: done } : { progress: done, total };
      send(notificationFrame("notifications/progress", { progressToken: token, ...counts }));
    };
    return runToolSafely(tool, { args, signal: controller.signal, progress }, context);
  }

  /**
   * The result of one request by method.
   *
   * @param request - The request.
   * @returns The result.
   * @throws {RpcError} -32601 for an unknown method, -32602 for bad params.
   */
  async function dispatch(request: McpRequest): Promise<JsonShaped> {
    switch (request.method) {
      case "initialize": {
        return initialize(request.params);
      }
      case "ping":
      case "logging/setLevel": {
        return {};
      }
      case "tools/list": {
        return { tools: tools.map(tool => definitionOf(tool)) };
      }
      case "tools/call": {
        return callTool(request);
      }
      default: {
        throw new RpcError(rpcCode.methodNotFound, `method not found: ${request.method}`);
      }
    }
  }

  /**
   * Answers one request, unless it was cancelled meanwhile.
   *
   * @param request - The request.
   */
  async function answer(request: McpRequest): Promise<void> {
    const key = idKey(request.id);
    let frame: OutgoingFrame;
    try {
      frame = resultFrame(request.id, await dispatch(request));
    } catch (error) {
      const code = error instanceof RpcError ? error.code : rpcCode.internalError;
      frame = errorFrame(request.id, code, error instanceof Error ? error.message : String(error));
    }
    const cancelled = inflight.get(key)?.signal.aborted === true;
    inflight.delete(key);
    if (!cancelled) send(frame);
  }

  /**
   * Handles a notification: initialized, cancelled; every other one is ignored.
   *
   * @param note - The notification.
   */
  function onNotification(note: McpNotification): void {
    if (note.method === "notifications/initialized") {
      initialized = true;
      return;
    }
    if (note.method === "notifications/cancelled") {
      inflight.get(idKey(note.params?.requestId))?.abort();
    }
  }

  /**
   * Tracks a request until it settled.
   *
   * @param work - The answer in flight.
   */
  function track(work: Promise<void>): void {
    running.add(work);
    work.finally(() => running.delete(work)).catch(ignore);
  }

  return {
    handleLine: line => {
      const incoming = parseLine(line);
      switch (incoming.kind) {
        case "invalid": {
          send(errorFrame(incoming.id, incoming.code, incoming.message));
          break;
        }
        case "notification": {
          onNotification(incoming.notification);
          break;
        }
        case "request": {
          track(answer(incoming.request));
          break;
        }
        case "response": {
          // The bridge sends no requests: a response has nothing to settle.
          break;
        }
      }
    },
    toolsChanged: () => {
      if (initialized) send(notificationFrame("notifications/tools/list_changed"));
    },
    cancelAll: () => {
      for (const controller of inflight.values()) controller.abort();
    },
    idle: async () => {
      await Promise.allSettled(running);
    }
  };
}

/**
 * Ignores a rejection already handled where it happened.
 */
function ignore(): void {
  // answer() never rejects.
}
