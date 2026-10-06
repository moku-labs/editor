/* eslint-disable unicorn/no-null -- null is a JSON value on the wire */
import type { Mock } from "vitest";
import { vi } from "vitest";
import type { Require } from "../../../config";
import type { FilesApi } from "../../files/types";
import type { Json, Manifest, Message, Request as RpcRequest } from "../../registry/protocol";
import { decode, encode, notification, toWireValue } from "../../registry/protocol";
import { createSocketHandler } from "../sockets/handler";
import { createHubState } from "../state";
import type {
  AgentConn,
  ConnKind,
  HubConfig,
  HubCtx,
  HubServer,
  HubSocket,
  HubWebSocketHandler,
  ToolsConn
} from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Shared fakes of the hub unit tests: a recording socket, a fake Bun server,
// a fake files api, a mock ctx and a harness that drives the socket handler.
// ─────────────────────────────────────────────────────────────────────────────

/** The default config of the plugin (same values as index.ts). */
export const DEFAULT_CONFIG: HubConfig = {
  path: "/__editor",
  allowOrigins: [],
  callTimeoutMs: 5000,
  silentAfterMs: 6000
};

/** The token every harness starts with. */
export const TOKEN = "t".repeat(43);

/** A small manifest: two sources, two commands. */
export const MANIFEST: Manifest = {
  game: "merge-game 0.0.0",
  page: "http://127.0.0.1:3000/",
  embedded: false,
  sources: [
    { id: "game.position", title: "Position", input: {}, changes: "commit" },
    { id: "game.history", title: "History", input: { last: "number?" }, changes: "edge" }
  ],
  commands: [
    {
      id: "game.step",
      title: "Step",
      input: { frames: "number", deltaMs: "number?" },
      effect: "cheat"
    },
    {
      id: "editor.series",
      title: "Series",
      input: { durationMs: "number", intervalMs: "number" },
      effect: "read"
    }
  ]
};

/**
 * A full Log.LogApi made of mocks.
 *
 * @returns The mock log.
 */
export function createLog() {
  return {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(() => []),
    expect: vi.fn(),
    addSink: vi.fn(),
    reset: vi.fn(),
    clearSinks: vi.fn()
  };
}

/** A socket that records what the hub sends and how it closes it. */
export type FakeSocket = HubSocket & {
  readonly sent: string[];
  readonly closes: { code: number | undefined; reason: string | undefined }[];
  /** What send returns: 1 sent, -1 backpressure, 0 dropped. */
  result: number;
  /** Every sent message, decoded. */
  messages(): Message[];
  /** Sent notifications of one channel and method. */
  notes(channel: string, method: string): Message[];
  /** Sent requests (the hub's forwarded calls). */
  requests(): RpcRequest[];
  /** Forgets what was sent. */
  clear(): void;
};

/**
 * A recording socket.
 *
 * @param kind - Agent or tools.
 * @param conn - Connection number.
 * @param page - A tools socket upgraded with `role=page` (the editor page).
 * @returns The fake socket.
 */
export function fakeSocket(kind: ConnKind, conn: number, page = false): FakeSocket {
  const sent: string[] = [];
  const closes: { code: number | undefined; reason: string | undefined }[] = [];
  const socket: FakeSocket = {
    data: page ? { kind, conn, page: true } : { kind, conn },
    sent,
    closes,
    result: 1,
    send(text: string): number {
      sent.push(text);
      return socket.result;
    },
    close(code?: number, reason?: string): void {
      closes.push({ code, reason });
    },
    messages: () => sent.map(text => decode(text)),
    notes: (channel, method) =>
      socket
        .messages()
        .filter(
          message =>
            "method" in message &&
            !("id" in message) &&
            message.channel === channel &&
            message.method === method
        ),
    requests: () =>
      socket
        .messages()
        .filter((message): message is RpcRequest => "method" in message && "id" in message),
    clear: () => {
      sent.length = 0;
    }
  };
  return socket;
}

/** A fake Bun server whose upgrade is a mock. */
export type FakeServer = HubServer & { readonly upgrade: Mock<HubServer["upgrade"]> };

/**
 * A fake Bun server.
 *
 * @param port - The port.
 * @param upgraded - What upgrade returns.
 * @returns The fake server.
 */
export function fakeServer(port = 4000, upgraded = true): FakeServer {
  return { port, upgrade: vi.fn<HubServer["upgrade"]>(() => upgraded) };
}

/**
 * A fake Bun server without a port (a unix socket).
 *
 * @returns The fake server.
 */
export function portlessServer(): FakeServer {
  return { port: undefined, upgrade: vi.fn<HubServer["upgrade"]>(() => true) };
}

/** The files api made of mocks. */
export type FakeFiles = { [K in keyof FilesApi]: Mock<FilesApi[K]> };

/**
 * A fake files api with harmless default answers.
 *
 * @returns The fake files api.
 */
export function fakeFiles(): FakeFiles {
  return {
    list: vi.fn<FilesApi["list"]>(async () => [{ path: "src/a.ts", kind: "file", size: 3 }]),
    read: vi.fn<FilesApi["read"]>(async () => ({ text: "abc", version: "v1" })),
    write: vi.fn<FilesApi["write"]>(async (path, text) => ({
      path,
      bytes: text.length,
      version: "v2"
    })),
    writeBinary: vi.fn<FilesApi["writeBinary"]>(async (path, bytes) => ({
      path,
      bytes: bytes.length,
      version: "v3"
    })),
    writeDataUrl: vi.fn<FilesApi["writeDataUrl"]>(async path => ({
      path,
      bytes: 8,
      version: "v3"
    })),
    readBinary: vi.fn<FilesApi["readBinary"]>(async () => ({
      dataUrl: "data:image/png;base64,AA==",
      version: "v4"
    })),
    resolve: vi.fn<FilesApi["resolve"]>(path => path),
    root: vi.fn<FilesApi["root"]>(() => "/root"),
    find: vi.fn<FilesApi["find"]>(async key => [
      { path: "nodes/merge.ts", binding: "merge", key, line: 17, range: [17, 1, 24, 3], hash: "h1" }
    ]),
    project: vi.fn<FilesApi["project"]>(() => ({ state: "off", reason: "not opened" }))
  };
}

/** A hub ctx whose emit, log and files are mocks. */
export type TestCtx = HubCtx & {
  readonly emit: Mock<HubCtx["emit"]>;
  readonly log: ReturnType<typeof createLog>;
  readonly files: FakeFiles;
};

/**
 * A hub ctx with fresh state (not started: no token).
 *
 * @param overrides - Config fields to change.
 * @returns The ctx.
 */
export function createCtx(overrides: Partial<HubConfig> = {}): TestCtx {
  const config: HubConfig = { ...DEFAULT_CONFIG, ...overrides };
  const files = fakeFiles();
  const require = (() => files) as unknown as Require;

  return {
    config,
    state: createHubState({ config }),
    emit: vi.fn<HubCtx["emit"]>(),
    log: createLog(),
    require,
    files
  };
}

/** A started hub ctx driven through its socket handler. */
export type Harness = {
  readonly ctx: TestCtx;
  readonly handler: HubWebSocketHandler;
  /** Opens a connection of a kind (handler.open). */
  connect(kind: ConnKind): FakeSocket;
  /** Opens a tools connection with the page role (an editor page, `role=page`). */
  page(): FakeSocket;
  /** Sends a message on a socket (handler.message with the encoded text). */
  send(socket: FakeSocket, message: Message): void;
  /** Closes a socket (handler.close). */
  close(socket: FakeSocket, code?: number): void;
  /** Connects an agent and sends its hello; returns the socket and the session id. */
  hello(manifest?: Manifest): { agent: FakeSocket; session: string };
  /** The registered agent conn of a socket. */
  agentConn(socket: FakeSocket): AgentConn;
  /** The registered tools conn of a socket. */
  toolsConn(socket: FakeSocket): ToolsConn;
};

/**
 * The hello notification of an agent.
 *
 * @param manifest - The manifest to send.
 * @returns The notification.
 */
export function helloOf(manifest: Manifest | Json = MANIFEST): Message {
  return notification("game", "hello", { manifest: toWireValue(manifest) });
}

/**
 * A started hub (token set) with its socket handler.
 *
 * @param overrides - Config fields to change.
 * @returns The harness.
 */
export function createHarness(overrides: Partial<HubConfig> = {}): Harness {
  const ctx = createCtx(overrides);
  ctx.state.token = TOKEN;
  const handler = createSocketHandler(ctx);

  const harness: Harness = {
    ctx,
    handler,
    connect(kind) {
      const socket = fakeSocket(kind, ctx.state.nextConn++);
      handler.open(socket);
      return socket;
    },
    page() {
      const socket = fakeSocket("tools", ctx.state.nextConn++, true);
      handler.open(socket);
      return socket;
    },
    send(socket, message) {
      handler.message(socket, encode(message));
    },
    close(socket, code = 1006) {
      handler.close(socket, code, "");
    },
    hello(manifest = MANIFEST) {
      const agent = harness.connect("agent");
      harness.send(agent, helloOf(manifest));
      const note = agent.notes("editor", "session")[0];
      const params = note !== undefined && "params" in note ? note.params : undefined;
      const id =
        typeof params === "object" && params !== null && !Array.isArray(params)
          ? params.id
          : undefined;
      if (typeof id !== "string") throw new Error("no session notification");
      agent.clear();
      return { agent, session: id };
    },
    agentConn(socket) {
      const conn = ctx.state.conns.get(socket.data.conn);
      if (conn?.kind !== "agent") throw new Error("not an agent conn");
      return conn;
    },
    toolsConn(socket) {
      const conn = ctx.state.conns.get(socket.data.conn);
      if (conn?.kind !== "tools") throw new Error("not a tools conn");
      return conn;
    }
  };
  return harness;
}

/**
 * The params of a message as a JSON object, or undefined.
 *
 * @param message - A message.
 * @returns The params object.
 */
export function paramsOf(message: Message | undefined): { [key: string]: Json } | undefined {
  if (message === undefined || !("params" in message)) return undefined;
  const { params } = message;
  return typeof params === "object" && params !== null && !Array.isArray(params)
    ? params
    : undefined;
}

/**
 * The response of a request id among the sent messages.
 *
 * @param socket - The socket.
 * @param id - The request id.
 * @returns The response, or undefined.
 */
export function responseTo(socket: FakeSocket, id: number): Message | undefined {
  return socket.messages().find(message => !("method" in message) && message.id === id);
}

/**
 * The error of the response of a request id.
 *
 * @param socket - The socket.
 * @param id - The request id.
 * @returns The error member, or undefined.
 */
export function errorOf(socket: FakeSocket, id: number) {
  const response = responseTo(socket, id);
  return response !== undefined && "error" in response ? response.error : undefined;
}

/**
 * The result of the response of a request id.
 *
 * @param socket - The socket.
 * @param id - The request id.
 * @returns The result member, or undefined.
 */
export function resultOf(socket: FakeSocket, id: number): Json | undefined {
  const response = responseTo(socket, id);
  return response !== undefined && "result" in response ? response.result : undefined;
}

/**
 * Reads one key of an opaque options object (BunServeOptions is an XOR type).
 *
 * @param options - The options.
 * @param key - The key.
 * @returns The value.
 */
export function field(options: unknown, key: string): unknown {
  return typeof options === "object" && options !== null ? Reflect.get(options, key) : undefined;
}

/**
 * The keys of an opaque record value.
 *
 * @param value - The value.
 * @returns Its keys, or [] for a non-object.
 */
export function keysOf(value: unknown): string[] {
  return typeof value === "object" && value !== null ? Object.keys(value) : [];
}

/** A JSON null for tests. */
export const NULL: Json = null;
