/**
 * @file hub plugin — type definitions: config, the session event payload, the structural Bun
 * seams (socket, server, serve options), routes, state, api and the domain context. `Request` and
 * `Response` here are the fetch types; protocol messages are imported under Rpc* names elsewhere.
 * SessionInfo comes from the protocol (R1).
 */
import type { Log } from "@moku-labs/common/browser";
import type { EmitFn } from "@moku-labs/core";
import type { Require, ServerEvents } from "../../config";
import type {
  Heartbeat,
  Json,
  Manifest,
  PublishMethod,
  PublishParams,
  SessionInfo,
  SubId
} from "../registry/protocol";

/**
 * Hub configuration.
 *
 * @example
 * ```ts
 * createApp({ pluginConfigs: { hub: { allowOrigins: ["http://192.168.1.4:3000"] } } });
 * ```
 */
export type HubConfig = {
  /** URL prefix of every editor route. Starts with "/", no trailing slash. */
  path: string;
  /** Extra exact origins allowed to upgrade and to call same-origin routes. */
  allowOrigins: readonly string[];
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
 * Data attached to a socket at upgrade. `page` is set for a tools upgrade with `role=page`: the
 * editor page, which publishes the selection and answers `editor.select` (A11).
 */
export type HubSocketData = {
  readonly kind: ConnKind;
  readonly conn: number;
  readonly page?: true;
};

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
 * The one websocket handler of the server (Bun allows one), exposed as `app.hub.websocket`.
 * `hub.serve()` mounts it; a game with its own `Bun.serve` passes it on.
 *
 * @example
 * ```ts
 * Bun.serve({
 *   port: 3000,
 *   fetch: (req, server) => app.hub.fetch(req, server) ?? new Response("upgraded"),
 *   websocket: app.hub.websocket
 * });
 * ```
 */
export type HubWebSocketHandler = {
  /**
   * Registers the connection of the upgrade's kind; a tools page gets `sessions {list}` at
   * once, then every published value. A socket that opens after stop is closed with 1001.
   *
   * @param ws - The socket.
   */
  open(ws: HubSocket): void;
  /**
   * Handles one frame: a binary frame closes the socket with 1003, an undecodable text counts a
   * strike, a message goes to the agent or the tools side of the connection.
   *
   * @param ws - The socket.
   * @param message - Text or binary frame.
   */
  message(ws: HubSocket, message: string | Uint8Array): void;
  /**
   * Forgets the connection, then ends the agent's session or the tools subscriptions.
   *
   * @param ws - The socket.
   * @param code - The close code.
   * @param reason - The close reason.
   */
  close(ws: HubSocket, code: number, reason: string): void;
  /**
   * Flushes the tools backlog once the socket can take more.
   *
   * @param ws - The socket.
   */
  drain(ws: HubSocket): void;
  /** 32 MiB: captures travel as data URLs. */
  readonly maxPayloadLength: number;
  /** 60 s; Bun sends pings. */
  readonly idleTimeout: number;
  /** Off: frames are not compressed. */
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
 * A tools page connection. `page` is true for the editor page (`role=page`); a plain tools client
 * (the MCP bridge) has false.
 */
export type ToolsConn = {
  kind: "tools";
  conn: number;
  socket: HubSocket;
  page: boolean;
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
 * One game session. lastBeatAt stays private; frame and paused of the heartbeat and the silent
 * flag reach the wire only as the SessionInfo heartbeat readout (M4). manifestHash is the
 * `commandsHash` of the manifest, computed once on hello (D-37).
 */
export type Session = {
  id: string;
  conn: number;
  manifest: Manifest;
  manifestHash: string;
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
 * Who answers a forwarded call: the agent of a session (game calls) or one editor page connection
 * (`editor.select`, A3). Only that side may settle it.
 */
export type CallTarget =
  | { readonly kind: "agent"; readonly session: string }
  | { readonly kind: "page"; readonly conn: number };

/**
 * A forwarded call in flight.
 */
export type PendingCall = {
  id: number;
  target: CallTarget;
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
 * A method `publish` sends to the tools pages (R6, A5): `"hotReload"` or `"selection"`, the keys of
 * the protocol's PublishParams. The protocol's PublishMethod, re-exported under hub's name.
 */
export type { PublishMethod } from "../registry/protocol";

/**
 * Hub state (the api returns closures and copies, never these maps).
 */
export type HubState = {
  /** Set in onStart, cleared in onStop. Never logged. */
  token: string | undefined;
  /** serve() ran; routes are frozen after it. */
  served: boolean;
  routes: Map<string, Response | RouteHandler>;
  /** Normalized config.allowOrigins, built in onInit. */
  origins: ReadonlySet<string>;
  conns: Map<number, Conn>;
  nextConn: number;
  sessions: Map<string, Session>;
  pending: Map<number, PendingCall>;
  nextCallId: number;
  shared: Map<string, SharedSub>;
  silentTimer: ReturnType<typeof setInterval> | undefined;
  /** The last value of each published method, replayed to every tools connection that opens. */
  published: Map<PublishMethod, Json>;
  /** The page connection that published the kept selection: `editor.select` goes there (A7). */
  selectionConn: number | undefined;
  /** The server port of the last accepted upgrade, for the editor page URL of `no_editor_page`. */
  editorPort: number | undefined;
};

/**
 * The hub api (`app.hub`, `ctx.require(hubPlugin)`).
 *
 * @example
 * ```ts
 * Bun.serve(app.hub.serve({ port: 3000, routes: { "/": index }, fetch: serveAsset }));
 * ```
 */
export type HubApi = {
  /**
   * Wraps the game's `Bun.serve` options: `127.0.0.1` forced, then the game's routes, the routes
   * from `addRoutes` and `{path}/ws` merged, and the websocket handler added. Without a game
   * `fetch` the fallback answers 404. Unknown option keys pass through to Bun.
   *
   * @param options - The game's serve options.
   * @returns Options ready for `Bun.serve`.
   * @throws {Error} `[moku-editor] …` before start, on a second call, with a `websocket`, `unix` or
   * `tls` option, with a hostname other than `127.0.0.1` / `localhost`, and with a game route
   * under the editor path.
   * @example
   * ```ts
   * // The game's dev server: one Bun.serve for the game and the editor, after await app.start().
   * Bun.serve(app.hub.serve({ port: 3000, routes: { "/": index }, fetch: serveAsset }));
   * ```
   */
  serve(options: ServeOptions): BunServeOptions;

  /**
   * The token of this start: 32 random bytes, base64url, 43 characters. A new one on every
   * start. Never logged.
   *
   * @returns The token.
   * @throws {Error} `[moku-editor] hub.token() needs a started app.` before start and after stop.
   * @example
   * ```ts
   * // pages puts the token into the tools boot JSON on every page request.
   * const hub = ctx.require(hubPlugin);
   * const token = hub.token(); // 43 characters, e.g. "Hk3…"
   * ```
   */
  token(): string;

  /**
   * A fresh list of the open game sessions ordered by `connectedAt`. Each carries `manifestHash`,
   * the `commandsHash` of its manifest computed on hello (D-37). A session that has sent a
   * heartbeat carries the readout `heartbeat: { frame, paused, silent }`; mutating the result does
   * not change the next call.
   *
   * @returns The open sessions.
   * @example
   * ```ts
   * // After the game page connected its bridge and sent its first heartbeat.
   * app.hub.sessions(); // [{ id: "s-7f3a", game: "merge-game 0.0.0", page: "http://127.0.0.1:3000/", embedded: true, connectedAt: 1790000000000, manifestHash: "4f528e73", heartbeat: { frame: 1840, paused: false, silent: false } }]
   * ```
   */
  sessions(): SessionInfo[];

  /**
   * The `{path}/ws` upgrade handler; `serve` already mounts it. Checks the path (404), the start
   * (503), the upgrade request (426), `guard(…, "upgrade")` (403), the token (401), the kind and
   * the role (400: `role=page` only with `kind=tools`), then upgrades.
   *
   * @param req - The request.
   * @param server - The Bun server.
   * @returns `undefined` after an upgrade, else the plain-text refusal.
   * @example
   * ```ts
   * // A game with its own Bun.serve mounts the upgrade itself.
   * Bun.serve({
   *   fetch: (req, server) => app.hub.fetch(req, server) ?? new Response("upgraded"),
   *   websocket: app.hub.websocket
   * });
   * ```
   */
  fetch(req: Request, server: HubServer): Response | undefined;

  /**
   * The one websocket handler of the server: 32 MiB frames, 60 s idle, no deflate.
   *
   * @example
   * ```ts
   * // A game's own Bun.serve passes the editor's handler on.
   * Bun.serve({
   *   fetch: (req, server) => app.hub.fetch(req, server) ?? new Response("upgraded"),
   *   websocket: app.hub.websocket
   * });
   * ```
   */
  readonly websocket: HubWebSocketHandler;

  /**
   * Registers editor routes, merged by `serve` (R3). Call it in `onInit`. Keys are checked first,
   * so a refused batch registers nothing.
   *
   * @param routes - Routes keyed by `path` or under `path + "/"`.
   * @throws {Error} `[moku-editor] …` after `serve`, on a key registered before, on `{path}/ws`,
   * and on a key outside the editor path.
   * @example
   * ```ts
   * // pages registers its routes in onInit, before hub.serve() freezes them.
   * const hub = ctx.require(hubPlugin);
   * hub.addRoutes({ [`${hub.path()}/hello`]: helloRoute });
   * ```
   */
  addRoutes(routes: EditorRoutes): void;

  /**
   * The shared Host / Origin / Sec-Fetch-Site check (R3). `upgrade` requires an allowed Origin;
   * `same-origin` and `navigate` check it when present; `same-origin` also wants Sec-Fetch-Site
   * `same-origin` or `none` when present. The origin `null` never matches.
   *
   * @param req - The request.
   * @param server - The Bun server (its port).
   * @param mode - Which rules apply.
   * @returns A 403 response, or `undefined` when allowed.
   * @example
   * ```ts
   * // A pages route refuses a cross-site request before it answers.
   * const refused = ctx.require(hubPlugin).guard(req, server, "same-origin");
   * if (refused) return refused; // 403 "forbidden"
   * ```
   */
  guard(req: Request, server: HubServer, mode: GuardMode): Response | undefined;

  /**
   * Sends server state to every tools page as the editor-channel notification `<method>` and
   * keeps it: a tools page that connects later gets the last value right after its
   * `sessions {list}`. Works before start too; the value waits for the first tools page. The value
   * is stored through `toWireValue`. A `null` selection goes out as a `selection` notification
   * without params (the wire refuses null params).
   *
   * @param method - The state: `"hotReload"` or `"selection"`.
   * @param params - Its value: a HotReload, or a SelectionInfo or null for the selection.
   * @example
   * ```ts
   * // pages tells every tools page whether Bun reloads the game page on a save.
   * ctx.require(hubPlugin).publish("hotReload", { hmr: true, owner: "bin" });
   * // each tools socket gets {"jsonrpc":"2.0","channel":"editor","method":"hotReload","params":{"hmr":true,"owner":"bin"}}
   * ```
   */
  publish<M extends PublishMethod>(method: M, params: PublishParams[M]): void;

  /**
   * Closes every open socket, agent and tools, with one code and reason. The hub keeps running:
   * the token stays, and each connection is forgotten when Bun reports its close, so its session
   * or subscriptions end as on any close. Clients reconnect on their own.
   *
   * @param code - The close code: 1012 (service restart) for the bin's restart.
   * @param reason - The close reason the clients see.
   * @example
   * ```ts
   * // The bin, right before Bun's stop on a Hot reload switch (pages serve.ts).
   * editor.hub.closeAll(1012, "editor restarting");
   * // the bridge and every tools page see close 1012 "editor restarting", log it at info and reconnect
   * ```
   */
  closeAll(code: number, reason: string): void;

  /**
   * The editor path, `config.path` (R3).
   *
   * @returns The URL prefix of every editor route.
   * @example
   * ```ts
   * // pages keys its routes under the hub path.
   * ctx.require(hubPlugin).path(); // "/__editor"
   * ```
   */
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
