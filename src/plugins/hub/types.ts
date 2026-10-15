/**
 * @file hub plugin — type definitions: config, the session event payload, the structural Bun
 * seams (socket, server, serve options), routes, state, api, device mode (pairing, the device
 * records, the per-plugin event `hub:device`) and the domain context. `Request` and `Response` here
 * are the fetch types; protocol messages are imported under Rpc* names elsewhere. SessionInfo comes
 * from the protocol (R1); the device-link wire types from hub/protocol.
 */
import type { Log } from "@moku-labs/common/browser";
import type { EmitFn } from "@moku-labs/core";
import type { Require, ServerEvents } from "../../config";
import type { PerfLogLine } from "../perf/protocol";
import type {
  Heartbeat,
  Json,
  Manifest,
  PublishMethod,
  PublishParams,
  SessionInfo,
  SubId
} from "../registry/protocol";
import type { DeviceLinkKind, SessionDevice } from "./protocol";

/**
 * Hub configuration.
 *
 * @example
 * ```ts
 * createApp({ pluginConfigs: { hub: { devicePort: 47600, deviceLan: true } } });
 * ```
 */
export type HubConfig = {
  /** URL prefix of every editor route. Starts with "/", no trailing slash. */
  path: string;
  /**
   * Extra exact origins allowed to upgrade and to call same-origin routes (normal and adb
   * listener; never devices).
   */
  allowOrigins: readonly string[];
  /** Deadline of a forwarded call before it fails with -32002 (retryable). */
  callTimeoutMs: number;
  /** A session with no heartbeat for this long is marked silent (65 s after a paused beat, R6). */
  silentAfterMs: number;
  /** Port of the device listeners (127.0.0.1 and, with deviceLan, the LAN address); 0 = a random free port. */
  devicePort: number;
  /** Also listen on the computer's LAN address (device upgrades only, pairing confirmed by the person). */
  deviceLan: boolean;
  /** The LAN address to bind; undefined picks the first non-internal IPv4 (en*, wl*, eth* first). */
  lanAddress: string | undefined;
  /** Exact Origins a device's WebView sends (scheme + host, lower case). */
  deviceOrigins: readonly string[];
  /** "lan": only LAN phones are asked, an adb phone is confirmed at once; "always": every phone is asked. */
  pairing: "lan" | "always";
  /** How long a pairing waits for the person before it is refused, in ms. */
  pairTimeoutMs: number;
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
 * editor page, which publishes the selection and answers the relayed editor requests (A11).
 * `device` is set for a device upgrade (`kind=agent role=device`): how it came, the peer address,
 * the device id of a valid token, or `unpaired` for a stale token (closed 4401 at open).
 */
export type HubSocketData = {
  readonly kind: ConnKind;
  readonly conn: number;
  readonly page?: true;
  readonly device?: {
    readonly link: DeviceLinkKind;
    readonly address: string;
    readonly id?: string;
    readonly unpaired?: true;
  };
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
  /**
   * The peer address of a request (Bun's `server.requestIP`); the device upgrade reads it.
   *
   * @param req - The request.
   * @returns The address, or null when Bun does not know it.
   */
  requestIP?(req: Request): { readonly address: string } | null;
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
  /**
   * The game's routes, passed to Bun as they are. Structural on purpose: this type ships in the
   * server `.d.mts`, and Bun's `Serve.Routes` is a namespace type the d.ts bundle drops
   * (skeleton-conventions §3); Bun.serve checks the values (HTML imports, files, method maps).
   */
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
  /** The game's routes and the editor's, merged; structural like ServeOptions.routes. */
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
 * The device side of an agent connection that came through a device listener. `id` is set once
 * the device is paired (at once for a token upgrade). `ended` is set when the hub already announced
 * the end of this connection (it was replaced): its close then emits nothing. `deadline` is the
 * first-message timer of a pairing socket (`PAIR_FIRST_MS`), cleared by a valid `pair` or a close.
 */
export type DeviceConn = {
  readonly link: DeviceLinkKind;
  readonly address: string;
  id: string | undefined;
  ended: boolean;
  deadline: ReturnType<typeof setTimeout> | undefined;
};

/**
 * An agent (game page) connection. `device` is present for a phone on a device listener.
 */
export type AgentConn = {
  kind: "agent";
  conn: number;
  socket: HubSocket;
  session: string | undefined;
  bye: boolean;
  invalid: number;
  device?: DeviceConn;
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
  /** The phone of a device session; absent for a game page served by `serve()`. */
  device?: SessionDevice;
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
 * (the relayed editor requests, A3). Only that side may settle it.
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
 * A method `publish` sends to the tools pages (R6, A5): `"hotReload"`, `"selection"`, `"project"`
 * or `"engine"`, the keys of the protocol's PublishParams. The hub publishes `project` (from
 * `files:project`) and `engine` (from `files.engine()`) itself. The protocol's PublishMethod,
 * re-exported under hub's name.
 */
export type { PublishMethod } from "../registry/protocol";

/**
 * What the CLI's pairing callback is asked: the code the phone shows (to compare with what the
 * person types), what the phone is and where it came from.
 *
 * @example
 * ```ts
 * const request: PairRequest = { code: "4821", model: "SM-A266B", address: "192.168.1.23", link: "lan", engine: "0.14.12+9c41e0", build: "debug-20261014T160000Z" };
 * ```
 */
export type PairRequest = {
  /** The code the phone shows, to compare with what the person types. */
  readonly code: string;
  /** The normalized model, e.g. "SM-A266B"; null when the phone sent none. */
  readonly model: string | null;
  /** The phone's address as the hub saw it. */
  readonly address: string;
  readonly link: DeviceLinkKind;
  /** The phone's engine fingerprint, as it reported it. */
  readonly engine: string | null;
  /** The phone's build id, as it reported it. */
  readonly build: string | null;
};

/**
 * Asks the person whether a phone may link. Resolves true to pair it. The signal aborts when the
 * phone leaves, the wait runs out or device mode stops; the answer is then ignored. A throw or a
 * rejection counts as a refusal.
 *
 * @example
 * ```ts
 * const confirm: PairConfirm = async (request, signal) =>
 *   (await ask(`${request.model ?? "A phone"} at ${request.address} asks to link. Type its code: `, signal)) === request.code;
 * ```
 */
export type PairConfirm = (request: PairRequest, signal: AbortSignal) => Promise<boolean>;

/**
 * Options of `listenDevices`.
 *
 * @example
 * ```ts
 * const options: DeviceListenOptions = { confirm: askInTerminal, routes: { "/": new Response("No game is served here.") } };
 * ```
 */
export type DeviceListenOptions = {
  /** The pairing callback (the CLI's terminal prompt). */
  readonly confirm: PairConfirm;
  /**
   * Non-editor routes of the adb listener (e.g. "/" for a page that says no game is served here).
   * Structural like ServeOptions.routes: no Bun namespace type in a shipped shape; Bun.serve
   * checks the values.
   */
  readonly routes?: Readonly<Record<string, unknown>>;
};

/**
 * Where device mode listens.
 *
 * @example
 * ```ts
 * const listen: DeviceListen = { port: 47600, adb: "127.0.0.1:47600", lan: "192.168.1.5:47600" };
 * ```
 */
export type DeviceListen = {
  /** The real port of both listeners (the random one under `devicePort: 0`). */
  readonly port: number;
  /** The loopback listener, `127.0.0.1:<port>`. */
  readonly adb: string;
  /** The LAN listener, `<address>:<port>` (IPv6 in brackets); null without deviceLan. */
  readonly lan: string | null;
};

/**
 * A paired device as the hub reports it: a frozen copy, never the token.
 *
 * @example
 * ```ts
 * const device: LinkedDevice = { id: "d-7f3a", model: "SM-A266B", link: "adb", address: "127.0.0.1", port: 47600, engine: "0.14.12+9c41e0", build: "debug-20261014T160000Z", pairedAt: 1791986083963, online: true };
 * ```
 */
export type LinkedDevice = SessionDevice & {
  /** Epoch ms of the pairing. */
  readonly pairedAt: number;
  /** Whether a connection is open now. */
  readonly online: boolean;
};

/**
 * A paired device (server side only). The token never leaves the hub except in `paired`.
 */
export type DeviceRecord = {
  id: string;
  token: string;
  model: string | null;
  link: DeviceLinkKind;
  address: string;
  engine: string | null;
  build: string | null;
  pairedAt: number;
  /** The live connection, undefined while the phone is away. */
  conn: number | undefined;
  /** Next expected line index per device log (de-duplication across reconnects), oldest first. */
  logs: Map<string, number>;
};

/**
 * A pairing waiting for the person: its socket, the question, the abort of the question and the
 * timer of `pairTimeoutMs`.
 */
export type PairTicket = {
  conn: number;
  request: PairRequest;
  abort: AbortController;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * Structural view of a Bun server the hub started itself (a device listener).
 */
export type DeviceServer = {
  readonly port?: number | undefined;
  stop(closeActiveConnections?: boolean): Promise<void>;
};

/**
 * What a device listener is started with: the bind address, the routes, the 404 fallback and the
 * hub's one websocket handler.
 */
export type DeviceServeOptions = {
  readonly hostname: string;
  readonly port: number;
  /** The CLI's routes and the editor's, merged; structural like ServeOptions.routes. */
  readonly routes: Readonly<Record<string, unknown>>;
  readonly fetch: () => Response;
  readonly websocket: HubWebSocketHandler;
};

/**
 * Starts a device listener: `Bun.serve` in the plugin, a fake in unit tests.
 */
export type DeviceServe = (options: DeviceServeOptions) => DeviceServer;

/**
 * A batch of a device's log, as the hub accepted it.
 *
 * @example
 * ```ts
 * const lines: DeviceLines = { log: "perf-20261014-1532-sm-a266b.jsonl", from: 200, rx: 1791986090000, items: [], gap: 0, rejected: 0 };
 * ```
 */
export type DeviceLines = {
  /** The device log's name ("perf-20261014-1532-sm-a266b.jsonl"). */
  readonly log: string;
  /** Index of the first item in that log (after duplicates were skipped). */
  readonly from: number;
  /** Computer epoch ms when the batch arrived. */
  readonly rx: number;
  /**
   * The accepted PerfLogLine v1 objects, frozen. The hub's shallow guard vouches for `v` (a finite
   * number) and `kind` (1–32 characters) only, not a line's body: a reader switches on `kind` and
   * reads the fields it needs defensively.
   */
  readonly items: readonly PerfLogLine[];
  /** Lines the device lost before sending (from − next). */
  readonly gap: number;
  /** Items dropped as malformed. */
  readonly rejected: number;
};

/**
 * Why a device connection ended: a bye, a lost socket, a newer connection of the same device, or
 * device mode stopping.
 */
export type DeviceCloseReason = "bye" | "lost" | "replaced" | "stopped";

/**
 * Payload of the per-plugin event `hub:device`: device mode listening, a device connected, a log
 * batch, a device left, device mode stopped.
 *
 * @example
 * ```ts
 * const event: HubDeviceEvent = { kind: "connected", device: { id: "d-7f3a", model: "SM-A266B", link: "adb", address: "127.0.0.1", port: 47600, engine: "0.14.12+9c41e0", build: "debug-20261014T160000Z", pairedAt: 1791986083963, online: true } };
 * ```
 */
export type HubDeviceEvent =
  | { readonly kind: "listening"; readonly listen: DeviceListen }
  | { readonly kind: "connected"; readonly device: LinkedDevice }
  | { readonly kind: "lines"; readonly device: LinkedDevice; readonly lines: DeviceLines }
  | { readonly kind: "closed"; readonly device: LinkedDevice; readonly reason: DeviceCloseReason }
  | { readonly kind: "stopped" };

/**
 * The hub's per-plugin events, visible to plugins that list `hubPlugin` in `depends`.
 */
export type HubEvents = { readonly "hub:device": HubDeviceEvent };

/**
 * Hub state (the api returns closures and copies, never these maps).
 */
export type HubState = {
  /** Set in onStart, cleared in onStop. Never logged. */
  token: string | undefined;
  /** serve() ran. */
  served: boolean;
  /** addRoutes refuses once serve() or listenDevices() ran. */
  routesFrozen: boolean;
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
  /** The page connection that published the kept selection: relayed requests go there (A7). */
  selectionConn: number | undefined;
  /** The server port of the last accepted upgrade, for the editor page URL of `no_editor_page`. */
  editorPort: number | undefined;
  /** Normalized config.deviceOrigins, built in onInit. */
  deviceOrigins: ReadonlySet<string>;
  /** The running device listeners; undefined while device mode is off. */
  deviceServers: { adb: DeviceServer; lan: DeviceServer | undefined } | undefined;
  /** What listenDevices answered; undefined while device mode is off. */
  deviceListen: DeviceListen | undefined;
  /** The CLI's pairing callback; undefined while device mode is off. */
  confirm: PairConfirm | undefined;
  /** Paired devices of this device-mode run, by id. Tokens never leave this map except in `paired`. */
  devices: Map<string, DeviceRecord>;
  /** Waiting pairings (FIFO), the one being asked, and the cooldown end per peer address. */
  pairing: { queue: PairTicket[]; asking: PairTicket | undefined; cooldown: Map<string, number> };
  /** The engine id last published as `editor.engine` (the fingerprint itself is files'). */
  engineId: string | undefined;
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
   * heartbeat carries the readout `heartbeat: { frame, paused, silent }`; a device session (a paired
   * phone) carries `device` with the device listener's port. Mutating the result does not change
   * the next call.
   *
   * @returns The open sessions.
   * @example
   * ```ts
   * // After the game page connected its bridge and sent its first heartbeat.
   * app.hub.sessions(); // [{ id: "s-7f3a", game: "merge-game 0.0.0", page: "http://127.0.0.1:3000/", embedded: true, connectedAt: 1790000000000, manifestHash: "4f528e73", heartbeat: { frame: 1840, paused: false, silent: false } }]
   * // A paired phone's session adds: device: { id: "d-7f3a", model: "SM-A266B", link: "adb", address: "127.0.0.1", port: 47600, engine: "0.14.12+9c41e0", build: "debug-20261014T160000Z" }
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
   * Registers editor routes, merged by `serve` and by the adb listener of `listenDevices` (R3).
   * Call it in `onInit`. Keys are checked first, so a refused batch registers nothing.
   *
   * @param routes - Routes keyed by `path` or under `path + "/"`.
   * @throws {Error} `[moku-editor] …` after `serve` or `listenDevices`, on a key registered before,
   * on `{path}/ws`, and on a key outside the editor path.
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
   * @param method - The state: `"hotReload"`, `"selection"`, `"project"` or `"engine"`.
   * @param params - Its value: a HotReload, a SelectionInfo or null for the selection, a
   * ProjectState (the hub publishes `project` itself from `files:project`), or an EngineInfo (the
   * hub publishes `engine` itself from `files.engine()` on start and when a phone pairs).
   * @example
   * ```ts
   * // pages tells every tools page whether Bun reloads the game page on a save.
   * ctx.require(hubPlugin).publish("hotReload", { hmr: true, owner: "bin" });
   * // each tools socket gets {"jsonrpc":"2.0","channel":"editor","method":"hotReload","params":{"hmr":true,"owner":"bin"}}
   * ```
   */
  publish<M extends PublishMethod>(method: M, params: PublishParams[M]): void;

  /**
   * Closes every open socket, agent, tools and device, with one code and reason (a phone reconnects
   * with its device token), and resolves when Bun
   * reported every close (at most 500 ms). The hub keeps running: the token stays, and each
   * connection is forgotten when Bun reports its close, so its session or subscriptions end as on
   * any close. Clients reconnect on their own. Stop a server only after it resolves: a stop before
   * drops the close frame, and the client sees 1006 instead of the code.
   *
   * @param code - The close code: 1012 (service restart) for the bin's restart.
   * @param reason - The close reason the clients see.
   * @returns When every socket closed, or the wait ran out.
   * @example
   * ```ts
   * // The bin, right before Bun's stop on a Hot reload switch (pages serve.ts).
   * await editor.hub.closeAll(1012, "editor restarting");
   * // the bridge and every tools page see close 1012 "editor restarting", log it at info and reconnect
   * ```
   */
  closeAll(code: number, reason: string): Promise<void>;

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

  /**
   * Turns device mode on: listens on 127.0.0.1:<devicePort> (the editor routes, the tools page and
   * the socket) and, with deviceLan, on the LAN address (device upgrades only). Phones connect as
   * `kind=agent role=device` from a deviceOrigins Origin and pair through `confirm`. Freezes the
   * editor routes. Emits `hub:device { kind: "listening" }`.
   *
   * @param options - The pairing callback and extra non-editor routes of the adb listener.
   * @returns The real port and the two addresses.
   * @throws {Error} The two-line `[moku-editor] …` lifecycle errors before start, when device mode
   * is on already, when deviceLan finds no LAN address, on a route under the editor path, and when
   * the port is in use (the error keeps `code: "EADDRINUSE"`).
   * @throws {TypeError} When `options.confirm` is not a function.
   * @example
   * ```ts
   * // moku-editor perf --lan, after await editor.start().
   * const listen = await editor.hub.listenDevices({ confirm: askInTerminal });
   * // { port: 47600, adb: "127.0.0.1:47600", lan: "192.168.1.5:47600" }
   * ```
   */
  listenDevices(options: DeviceListenOptions): Promise<DeviceListen>;

  /**
   * Turns device mode off: pending pairings are refused, device connections close with 1001
   * "device mode off", device tokens are forgotten, both listeners stop. Emits `closed` per
   * connected device, then `stopped`. A call while device mode is off does nothing. The editor
   * routes stay frozen.
   *
   * @returns When both listeners stopped (at most 500 ms).
   * @example
   * ```ts
   * // The perf command's Ctrl+C turns phones off before it stops the editor.
   * await editor.hub.stopDevices();
   * editor.hub.devices(); // []
   * ```
   */
  stopDevices(): Promise<void>;

  /**
   * The paired devices of this device-mode run, ordered by pairedAt, as fresh frozen copies
   * without tokens.
   *
   * @returns The devices; [] while device mode is off.
   * @example
   * ```ts
   * // After a Galaxy A26 paired over adb reverse.
   * editor.hub.devices(); // [{ id: "d-7f3a", model: "SM-A266B", link: "adb", address: "127.0.0.1", port: 47600, engine: "0.14.12+9c41e0", build: "debug-20261014T160000Z", pairedAt: 1791986083963, online: true }]
   * ```
   */
  devices(): LinkedDevice[];
};

/**
 * The hooks of the hub: the files plugin's project state, published as `editor.project`.
 */
export type HubHooks = {
  readonly "files:project": (state: ServerEvents["files:project"]) => void;
};

/**
 * Domain context of the hub: the kernel context is assignable to it.
 */
export type HubCtx = {
  readonly config: Readonly<HubConfig>;
  state: HubState;
  readonly emit: EmitFn<Pick<ServerEvents, "hub:session"> & HubEvents>;
  readonly log: Log.LogApi;
  readonly require: Require;
};
