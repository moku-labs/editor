/**
 * @file hub plugin — type definitions: config, the session event payload, the structural Bun
 * seams (socket, server, serve options), routes, state, api and the domain context. `Request` and
 * `Response` here are the fetch types; protocol messages are imported under Rpc* names elsewhere.
 * SessionInfo comes from the protocol (R1).
 */
import type { Log } from "@moku-labs/common/browser";
import type { EmitFn } from "@moku-labs/core";
import type { Require, ServerEvents } from "../../config";
import type { Heartbeat, Json, Manifest, SessionInfo, SubId } from "../registry/protocol";

/**
 * Hub configuration.
 *
 * @example
 * ```ts
 * createApp({ pluginConfigs: { hub: { allow: ["http://192.168.1.4:3000"] } } });
 * ```
 */
export type HubConfig = {
  /** URL prefix of every editor route. Starts with "/", no trailing slash. */
  path: string;
  /** Extra exact origins allowed to upgrade and to call same-origin routes. */
  allow: readonly string[];
  /** Deadline of a forwarded call before it fails with -32002 (retryable). */
  callTimeoutMs: number;
  /** A session with no heartbeat for this long is marked silent (65 s after a paused beat, R6). */
  silentAfterMs: number;
};

/**
 * Payload of the global server event `hub:session`, and params of the `session` notification.
 */
export type HubSession = {
  readonly id: string;
  readonly game: string;
  readonly open: boolean;
  readonly reason?: "bye" | "game_reloaded";
};

/**
 * The kind of a websocket connection (from the upgrade URL, R1).
 */
export type ConnKind = "agent" | "tools";

/**
 * Data attached to a socket at upgrade.
 */
export type HubSocketData = { readonly kind: ConnKind; readonly conn: number };

/**
 * Structural view of Bun's ServerWebSocket that the hub uses.
 */
export type HubSocket = {
  readonly data: HubSocketData;
  send(text: string): number;
  close(code?: number, reason?: string): void;
};

/**
 * Structural view of Bun's Server that the hub uses.
 */
export type HubServer = {
  readonly port?: number | undefined;
  upgrade(req: Request, options: { data: HubSocketData }): boolean;
};

/**
 * A route handler of an editor route.
 */
export type RouteHandler = (
  req: Request,
  server: HubServer
) => Response | Promise<Response> | undefined;

/**
 * Editor routes registered through addRoutes (pages) and merged by serve.
 */
export type EditorRoutes = Readonly<Record<string, Response | RouteHandler>>;

/**
 * Which request check guard applies (R3).
 */
export type GuardMode = "upgrade" | "same-origin" | "navigate";

/**
 * The guard check that refused a request (named in the `hub:refused` log line).
 */
export type GuardCheck = "port" | "host" | "origin" | "fetch-site";

/**
 * What the game passes to serve(). Unknown keys pass through to Bun untouched.
 */
export type ServeOptions = {
  readonly port?: number;
  readonly hostname?: string;
  readonly development?: boolean | { readonly hmr?: boolean; readonly console?: boolean };
  readonly routes?: Readonly<Record<string, unknown>>;
  readonly fetch?: (req: Request, server: HubServer) => Response | Promise<Response>;
  /** Refused at runtime too: the editor owns the one websocket handler. */
  readonly websocket?: undefined;
  readonly [key: string]: unknown;
};

/**
 * What Bun.serve accepts. The only place the hub names a Bun type.
 */
export type BunServeOptions = Bun.Serve.Options<HubSocketData, string>;

/**
 * The options serve() builds before its one cast to BunServeOptions: the game's options with
 * the hostname forced, the routes merged, a fetch and the hub websocket handler.
 */
export type MergedServeOptions = {
  readonly [key: string]: unknown;
  readonly hostname: "127.0.0.1";
  readonly routes: Readonly<Record<string, unknown>>;
  readonly fetch: (req: Request, server: HubServer) => Response | Promise<Response>;
  readonly websocket: HubWebSocketHandler;
};

/**
 * The one websocket handler of the server.
 */
export type HubWebSocketHandler = {
  open(ws: HubSocket): void;
  message(ws: HubSocket, message: string | Uint8Array): void;
  close(ws: HubSocket, code: number, reason: string): void;
  drain(ws: HubSocket): void;
  /** 32 MiB: captures travel as data URLs. */
  readonly maxPayloadLength: number;
  /** 60 s; Bun sends pings. */
  readonly idleTimeout: number;
  readonly perMessageDeflate: false;
};

/**
 * An agent (game page) connection.
 */
export type AgentConn = {
  kind: "agent";
  conn: number;
  socket: HubSocket;
  session: string | undefined;
  bye: boolean;
  invalid: number;
};

/**
 * A tools page connection.
 */
export type ToolsConn = {
  kind: "tools";
  conn: number;
  socket: HubSocket;
  subs: Map<SubId, string>;
  pending: number;
  congested: boolean;
  backlog: Map<SubId, { session: string; value: Json }>;
  invalid: number;
};

/**
 * Any open connection.
 */
export type Conn = AgentConn | ToolsConn;

/**
 * One game session (private: heartbeat, lastBeatAt and silent never reach the wire, R1).
 */
export type Session = {
  id: string;
  conn: number;
  manifest: Manifest;
  connectedAt: number;
  heartbeat: Heartbeat | null;
  lastBeatAt: number;
  silent: boolean;
  nextSub: SubId;
};

/**
 * Where the answer of a forwarded call goes.
 */
export type Reply =
  | { kind: "tools"; conn: number; toolsId: number }
  | { kind: "watch"; key: string }
  | { kind: "discard" };

/**
 * A forwarded call in flight.
 */
export type PendingCall = {
  id: number;
  session: string;
  timer: ReturnType<typeof setTimeout>;
  reply: Reply;
};

/**
 * One agent-side watch shared by every tools subscriber of the same (session, source, input).
 */
export type SharedSub = {
  key: string;
  session: string;
  agentSub: SubId;
  sourceId: string;
  input: Json | null;
  ready: boolean;
  waiting: { conn: number; toolsId: number }[];
  subscribers: Map<number, Set<SubId>>;
  last: Json | undefined;
};

/**
 * Hub state (the api returns closures and copies, never these maps).
 */
export type HubState = {
  /** Set in onStart, cleared in onStop. Never logged. */
  token: string | undefined;
  /** serve() ran; routes are frozen after it. */
  served: boolean;
  routes: Map<string, Response | RouteHandler>;
  /** Normalized config.allow, built in onInit. */
  origins: ReadonlySet<string>;
  conns: Map<number, Conn>;
  nextConn: number;
  sessions: Map<string, Session>;
  pending: Map<number, PendingCall>;
  nextCallId: number;
  shared: Map<string, SharedSub>;
  silentTimer: ReturnType<typeof setInterval> | undefined;
};

/**
 * The hub api (`app.hub`, `ctx.require(hubPlugin)`).
 *
 * @example
 * ```ts
 * Bun.serve(editor.hub.serve({ port: 3000, routes: { "/": index }, fetch: serveAsset }));
 * ```
 */
export type HubApi = {
  /** Wraps Bun.serve options: 127.0.0.1 forced, editor routes and the websocket handler added. */
  serve(options: ServeOptions): BunServeOptions;
  /** The token of this start. Throws before start and after stop. */
  token(): string;
  /** Fresh SessionInfo list ordered by connectedAt. */
  sessions(): SessionInfo[];
  /** The `{path}/ws` upgrade handler. */
  fetch(req: Request, server: HubServer): Response | undefined;
  /** The one websocket handler. */
  readonly websocket: HubWebSocketHandler;
  /** Registers editor routes (pages, in onInit), merged by serve (R3). */
  addRoutes(routes: EditorRoutes): void;
  /** The shared Host / Origin / Sec-Fetch-Site check (R3). */
  guard(req: Request, server: HubServer, mode: GuardMode): Response | undefined;
  /** config.path (R3). */
  path(): string;
};

/**
 * Domain context of the hub: the kernel context is assignable to it.
 */
export type HubCtx = {
  readonly config: Readonly<HubConfig>;
  state: HubState;
  readonly emit: EmitFn<Pick<ServerEvents, "hub:session">>;
  readonly log: Log.LogApi;
  readonly require: Require;
};
