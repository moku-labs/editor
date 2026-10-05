/**
 * @file pages/mcp — the types of the stdio MCP bridge (D-31): MCP messages, tool definitions and
 * results, the hub session view, the launcher seam and the deps of `runBridge`. Plain modules,
 * no plugin: the bridge is a hub tools client in its own process.
 */
import type { BrandConsole } from "@moku-labs/common/cli";
import type { Json, SessionInfo } from "../../registry/protocol";
import type { EditorDiscovery } from "../types";

/**
 * A decoded JSON object.
 */
export type JsonObject = { [key: string]: Json };

/**
 * A value JSON.stringify writes as JSON: Json, readonly lists and objects with optional members.
 */
export type JsonShaped =
  | Json
  | readonly JsonShaped[]
  | { readonly [key: string]: JsonShaped | undefined };

/**
 * The id of an MCP request: a string or a number, never null.
 */
export type McpId = string | number;

/**
 * An MCP request: it gets exactly one response.
 */
export type McpRequest = {
  readonly id: McpId;
  readonly method: string;
  readonly params: JsonObject | undefined;
};

/**
 * An MCP notification: no id, never answered.
 */
export type McpNotification = {
  readonly method: string;
  readonly params: JsonObject | undefined;
};

/**
 * One line read from stdin, classified.
 */
export type Incoming =
  | { readonly kind: "request"; readonly request: McpRequest }
  | { readonly kind: "notification"; readonly notification: McpNotification }
  | { readonly kind: "response" }
  | {
      readonly kind: "invalid";
      readonly id: McpId | undefined;
      readonly code: number;
      readonly message: string;
    };

/**
 * One frame the bridge writes to stdout: a response or a notification.
 */
export type OutgoingFrame =
  | { readonly jsonrpc: "2.0"; readonly id: McpId; readonly result: JsonShaped }
  | {
      readonly jsonrpc: "2.0";
      readonly id: McpId | null;
      readonly error: { readonly code: number; readonly message: string };
    }
  | { readonly jsonrpc: "2.0"; readonly method: string; readonly params?: JsonObject };

/**
 * One content item of a tool result.
 */
export type Content =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image"; readonly data: string; readonly mimeType: string };

/**
 * The result of `tools/call`: the text item first, then images; `isError` for a tool failure.
 */
export type ToolResult = { readonly content: readonly Content[]; readonly isError?: true };

/**
 * One property of a tool input schema (a JSON Schema subset). A property without `type` takes any
 * JSON value.
 */
export type PropertySchema =
  | { readonly type: "string"; readonly description: string; readonly minLength?: number }
  | {
      readonly type: "integer";
      readonly description: string;
      readonly minimum: number;
      readonly maximum: number;
      readonly default?: number;
    }
  | { readonly type: "boolean"; readonly description: string; readonly default?: boolean }
  | { readonly description: string };

/**
 * The input schema of a tool: an object with known properties and nothing else.
 */
export type ToolInputSchema = {
  readonly type: "object";
  readonly properties: Readonly<Record<string, PropertySchema>>;
  readonly required?: readonly string[];
  readonly additionalProperties: false;
};

/**
 * The static MCP annotations of a tool (M6): the worst case of what it may do.
 */
export type ToolAnnotations = {
  readonly readOnlyHint: boolean;
  readonly destructiveHint?: boolean;
  readonly idempotentHint?: boolean;
  readonly openWorldHint: false;
};

/**
 * A tool the way `tools/list` describes it.
 */
export type ToolDefinition = {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: ToolInputSchema;
  readonly annotations: ToolAnnotations;
};

/**
 * One call of a tool: its checked arguments, the cancel signal and the progress reporter (a no-op
 * when the request carries no `_meta.progressToken`).
 */
export type ToolCall = {
  readonly args: JsonObject;
  readonly signal: AbortSignal;
  readonly progress: (progress: number, total?: number) => void;
};

/**
 * A tool: its definition and what it does.
 */
export type Tool = ToolDefinition & {
  readonly run: (call: ToolCall, context: ToolContext) => Promise<ToolResult>;
};

/**
 * The liveness readout of a session: the hub's `heartbeat` merged with the forwarded heartbeats.
 */
export type Liveness = {
  readonly frame: number;
  readonly paused: boolean;
  readonly silent: boolean;
};

/**
 * A session the way the bridge shows it: the five wire fields and the live heartbeat, when known.
 */
export type SessionView = Omit<SessionInfo, "heartbeat"> & { readonly heartbeat?: Liveness };

/**
 * Where a watch points: a source, its input and the session.
 */
export type WatchTarget = {
  readonly id: string;
  readonly input: Json | undefined;
  readonly session: string | undefined;
};

/**
 * The hub tools connection of the bridge (`hub-client.ts`).
 */
export type HubClient = {
  /** The bin this connection talks to. */
  readonly bin: EditorDiscovery;
  /** Sends one game or files request; resolves with its result, rejects with a ProtocolError. */
  request(
    channel: "game" | "files",
    method: string,
    params?: Json,
    session?: string
  ): Promise<Json>;
  /** Watches a source; resolves with the stop once the hub accepted the watch. */
  watch(target: WatchTarget, onValue: (value: Json) => void): Promise<() => void>;
  /** The sessions now, with their live heartbeat. */
  sessions(): SessionView[];
  /** The last `editor.hotReload` the hub sent, if any. */
  hotReload(): Json | undefined;
  /** Calls `listener` on every `sessions` notification; returns the remover. */
  onSessions(listener: (list: readonly SessionView[]) => void): () => void;
  /** True until the socket closed. */
  isOpen(): boolean;
  /** Closes the socket; pending calls fail `link_closed`. */
  close(): void;
};

/**
 * A spawned process the launcher keeps: its pid, its exit and a way to signal it.
 */
export type ChildProcess = {
  readonly pid: number;
  readonly exited: Promise<number>;
  kill(signal: "SIGTERM" | "SIGKILL"): void;
  unref(): void;
};

/**
 * Starts a process detached, stdin ignored, stdout and stderr to a file descriptor.
 */
export type SpawnProcess = (
  cmd: readonly string[],
  options: { readonly cwd: string; readonly logFd: number }
) => ChildProcess;

/**
 * The status of the bin the bridge knows.
 */
export type EditorStatus = {
  readonly running: boolean;
  readonly owned: boolean;
  readonly bin: EditorDiscovery | undefined;
};

/**
 * The bin side of the bridge (`connection.ts`): the hub connection, the bin it started, start
 * and stop.
 */
export type EditorLink = {
  /** Discovery, connect, or start the bin when an html is known. Never rejects. */
  start(): Promise<void>;
  /** The open hub connection; connects once to a live bin first. */
  hub(): Promise<HubClient>;
  /** The connection when one is open, without connecting. */
  connected(): HubClient | undefined;
  /** Running, owned and the bin. */
  status(): EditorStatus;
  /** Starts the bin when none runs and connects. */
  launch(input: { readonly html?: string; readonly port?: number }): Promise<EditorStatus>;
  /** Stops the bin this bridge started; a bin it did not start is left alone. */
  stopOwned(): Promise<{ readonly stopped: boolean; readonly status: EditorStatus }>;
  /** Closes the connection and stops an owned bin (stdin end). */
  shutdown(): Promise<void>;
};

/**
 * What every tool gets: the bin side and the clock.
 */
export type ToolContext = {
  readonly editor: EditorLink;
  readonly now: () => number;
};

/**
 * The deps of `runBridge`: stdio, the stderr console, the process seams, the clock and the
 * signals.
 */
export type BridgeDeps = {
  /** stdin: newline-delimited JSON-RPC. */
  readonly input: AsyncIterable<Uint8Array | string>;
  /** Writes one protocol frame to stdout. Nothing else goes there. */
  readonly write: (text: string) => void;
  /** The branded console on stderr. */
  readonly ui: BrandConsole;
  /** Starts the bin. */
  readonly spawn: SpawnProcess;
  /** True while a pid runs. */
  readonly isAlive: (pid: number) => boolean;
  /** The runtime and the bin script the launcher runs (`process.execPath`, `Bun.main`). */
  readonly command: readonly string[];
  /** Epoch ms. */
  readonly now: () => number;
  /** Calls `stop` on every SIGINT or SIGTERM until the returned remover runs. */
  readonly onSignal: (stop: () => void) => () => void;
  /** Lets go of stdin after a signal, so the process exits while the client keeps the pipe open. */
  readonly releaseInput: () => void;
};
