/**
 * @file Protocol — every wire and channel type of the editor (contracts §2, R1, R6) and the shared
 * wire shapes of the server and the tools page (D-17). Runtime-free: imports nothing. Values that
 * hold readonly arrays (Manifest, SessionInfo[]) are not assignable to the mutable Json: senders
 * pass them through toWireValue first.
 */

/**
 * A JSON value, the way it travels on the wire.
 *
 * @example
 * ```ts
 * const value: Json = { path: "board/awaitIntent", frame: 1840, tainted: false };
 * ```
 */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/**
 * The kind of one input field of a source or a command.
 */
export type InputKind = "string" | "number" | "boolean" | "json";

/**
 * The input of a source or a command: field name to kind; a kind ending in `?` is optional.
 * Structurally identical to the game's InputSchema.
 *
 * @example
 * ```ts
 * const step: InputSchema = { frames: "number", deltaMs: "number?" };
 * ```
 */
export type InputSchema = Readonly<Record<string, InputKind | `${InputKind}?`>>;

/**
 * The TypeScript type of each input kind.
 */
type KindTypes = { string: string; number: number; boolean: boolean; json: Json };

/**
 * The value type of one field kind, optional or not.
 */
type ValueOf<Kind> = Kind extends `${infer Base extends InputKind}?`
  ? KindTypes[Base]
  : Kind extends InputKind
    ? KindTypes[Kind]
    : never;

/**
 * The fields of a schema whose kind has no `?`.
 */
type RequiredKeys<S extends InputSchema> = {
  [K in keyof S]: S[K] extends InputKind ? K : never;
}[keyof S];

/**
 * Shows an intersection in one object type.
 */
type Flat<T> = { [K in keyof T]: T[K] };

/**
 * The input value a schema describes; identical definition to the game's InputOf.
 *
 * @example
 * ```ts
 * type Step = InputOf<{ frames: "number"; deltaMs: "number?" }>; // { frames: number; deltaMs?: number | undefined }
 * ```
 */
export type InputOf<S extends InputSchema> = Flat<
  { -readonly [K in RequiredKeys<S>]: ValueOf<S[K]> } & {
    -readonly [K in Exclude<keyof S, RequiredKeys<S>>]?: ValueOf<S[K]> | undefined;
  }
>;

/**
 * How often a source value changes: every frame, on each commit, on each graph edge.
 */
export type Changes = "frame" | "commit" | "edge";

/**
 * What a command does to the game.
 */
export type Effect = "read" | "route" | "cosmetic" | "cheat" | "raw";

/**
 * A source the way the manifest describes it (no functions).
 */
export type SourceDescriptor = {
  readonly id: string;
  readonly title: string;
  readonly input: InputSchema;
  readonly changes: Changes;
  /**
   * `false` when the game does not have this source: its door threw on the probe (the game plugin
   * behind it is missing). Reads and watches answer -32008 `not_installed`. Absent = available.
   */
  readonly available?: false;
  /** What the door threw on the probe; present only with `available: false`. */
  readonly reason?: string;
};

/**
 * A command the way the manifest describes it (no functions).
 */
export type CommandDescriptor = {
  readonly id: string;
  readonly title: string;
  readonly input: InputSchema;
  readonly effect: Effect;
};

/**
 * What a game page offers the editor: sent by the bridge in `hello`.
 *
 * @example
 * ```ts
 * const manifest: Manifest = { game: "merge-game 0.0.0", page: "http://127.0.0.1:3000/", embedded: true, sources: [], commands: [] };
 * ```
 */
export type Manifest = {
  /** Display name, e.g. "merge-game 0.0.0". */
  readonly game: string;
  /** location.href of the game page. */
  readonly page: string;
  /** True when the page runs inside the tools page frame. */
  readonly embedded: boolean;
  readonly sources: readonly SourceDescriptor[];
  readonly commands: readonly CommandDescriptor[];
  /** Reserved for code-loaded game panels; unused this change. */
  readonly panels?: readonly { readonly id: string; readonly module: string }[];
};

/**
 * Where the game stands after a command.
 */
export type RunState = { readonly path: string; readonly frame: number; readonly tainted: boolean };

/**
 * The answer of a command: its value and the run state.
 */
export type RunResult = { readonly value: Json; readonly state: RunState };

/**
 * One heartbeat of a game page. `heap` is the JS heap of the page in MB, rounded to 0.1, and
 * only present where the browser reports it (Chromium's `performance.memory`).
 *
 * @example
 * ```ts
 * const beat: Heartbeat = { frame: 1840, paused: false, at: 1790000000000, heap: { usedMb: 12.8, limitMb: 4095.8 } };
 * ```
 */
export type Heartbeat = {
  readonly frame: number;
  readonly paused: boolean;
  /** Epoch ms of the beat. */
  readonly at: number;
  readonly heap?: { readonly usedMb: number; readonly limitMb: number };
};

/**
 * Params of the game-channel `tap` notification: one pointerdown on the game page. `x` and `y`
 * are page CSS px of the game document (`clientX`, `clientY`); `at` is the page's
 * `performance.now()`.
 *
 * @example
 * ```ts
 * const tap: Tap = { x: 206, y: 640, at: 15234.5 };
 * ```
 */
export type Tap = { readonly x: number; readonly y: number; readonly at: number };

/**
 * The link state shown everywhere (design-context §6 B1, F3).
 *
 * @example
 * ```ts
 * const status: LinkStatus = { kind: "live", frame: 1840 };
 * ```
 */
export type LinkStatus =
  | { kind: "connecting" }
  | { kind: "live"; frame: number }
  | { kind: "paused"; frame: number }
  | { kind: "silent"; since: number; lastFrame: number }
  | { kind: "lost"; reason: string; lastFrame: number; retryInMs: number }
  | { kind: "empty" };

/**
 * The channel every panel reads through: in process (`app.channel`, the agent channel of the game
 * page) or remote (`app.link`, the tools link to the editor server). The base of `ChannelApi` and
 * `LinkApi`. Errors reject as wire errors: -32601 `unknown_id`, -32602 `invalid_input`, the
 * command's own error; the remote link adds its transport reasons (`timeout`, `link_closed` …).
 */
export type EditorChannel = {
  /**
   * Reads a source now.
   *
   * @param id - The source id, e.g. "game.position".
   * @param input - The source input; omit it for a source without input.
   * @returns A promise of the wire value. It never throws synchronously.
   * @example
   * ```ts
   * // A panel shows where the game stands.
   * await app.channel.read("game.position"); // { path: "home", … }
   * await app.channel.read("game.history", { last: 1 }); // [{ path: "home", outcome: "play", … }]
   * ```
   */
  read(id: string, input?: Json): Promise<Json>;
  /**
   * Follows a source: delivers the current value first, then every change.
   *
   * @param id - The source id.
   * @param input - The source input; `undefined` means none, but the argument is required.
   * @param onValue - Called with each value.
   * @returns An idempotent stop.
   * @example
   * ```ts
   * // The state view follows the position until the view closes.
   * const stop = app.channel.watch("game.position", undefined, position => show(position));
   * stop();
   * ```
   */
  watch(id: string, input: Json | undefined, onValue: (value: Json) => void): () => void;
  /**
   * Runs a command. The in-process channel runs it in a microtask, off the game's frame loop.
   *
   * @param id - The command id, e.g. "game.step".
   * @param input - The command input; omit it for a command without input.
   * @returns A promise of the command's value and where the game stands after it.
   * @example
   * ```ts
   * // The flow view steps one frame.
   * (await app.channel.run("game.step", { frames: 1 })).state; // { path: "home", frame: 1841, tainted: false }
   * ```
   */
  run(id: string, input?: Json): Promise<RunResult>;
  /**
   * The link state now. The in-process channel answers live or paused only.
   *
   * @returns A fresh LinkStatus.
   * @example
   * ```ts
   * app.channel.status(); // { kind: "live", frame: 1840 }
   * ctx.require(linkPlugin).status(); // { kind: "silent", since: 1790000000000, lastFrame: 1840 }
   * ```
   */
  status(): LinkStatus;
};

/**
 * The logical channel of a wire message.
 */
export type Channel = "game" | "files" | "editor";

/**
 * Why a call failed (R1 adds `link_closed`).
 */
export type ErrorReason =
  | "game_reloaded"
  | "no_session"
  | "choose_session"
  | "timeout"
  | "invalid_input"
  | "unknown_id"
  | "command_failed"
  | "not_json"
  | "forbidden_path"
  | "version_conflict"
  | "unauthorized"
  | "not_installed"
  | "link_closed";

/**
 * A JSON-RPC error object with the editor's data fields.
 */
export type WireError = {
  code: number;
  message: string;
  data?: { retryable?: boolean; reason?: ErrorReason; id?: string; field?: string };
};

/**
 * The `data` member of a WireError.
 */
export type WireErrorData = NonNullable<WireError["data"]>;

/**
 * A request: carries an id and gets exactly one response.
 */
export type Request = {
  jsonrpc: "2.0";
  id: number;
  channel: Channel;
  method: string;
  params?: Json;
  session?: string;
};

/**
 * The response to a request: a result or an error.
 */
export type Response =
  | { jsonrpc: "2.0"; id: number; result: Json }
  | { jsonrpc: "2.0"; id: number; error: WireError };

/**
 * A notification: no id, no response.
 */
export type Notification = {
  jsonrpc: "2.0";
  channel: Channel;
  method: string;
  params?: Json;
  session?: string;
};

/**
 * Any wire message.
 */
export type Message = Request | Response | Notification;

/**
 * A subscription id on the wire: a safe integer ≥ 0 on both hops (R6).
 */
export type SubId = number; // eslint-disable-line sonarjs/redundant-type-aliases -- R6 names the wire subscription id

/**
 * Params of the game-channel `read` request.
 */
export type ReadParams = { id: string; input?: Json };

/**
 * Params of the game-channel `watch` request.
 */
export type WatchParams = { sub: SubId; id: string; input?: Json };

/**
 * Params of the game-channel `unwatch` request.
 */
export type UnwatchParams = { sub: SubId };

/**
 * Params of the game-channel `run` request.
 */
export type RunParams = { id: string; input?: Json };

/**
 * Params of the agent's first notification.
 */
export type HelloParams = { manifest: Manifest };

/**
 * Params of a `value` notification.
 */
export type ValueParams = { sub: SubId; value: Json };

/**
 * Params of the editor-channel `session` notification (= the hub's HubSession; also sent to the
 * agent right after its hello, R6).
 */
export type SessionParams = {
  id: string;
  game: string;
  open: boolean;
  reason?: "bye" | "game_reloaded";
};

/**
 * Params of the editor-channel `sessions` notification.
 */
export type SessionsParams = { list: SessionInfo[] };

/**
 * Params of the files-channel `list` request.
 */
export type ListParams = { dir: string };

/**
 * Params of the files-channel `read` and `readBinary` requests.
 */
export type PathParams = { path: string };

/**
 * Params of the files-channel `write` request.
 */
export type WriteParams = { path: string; text: string; version?: string };

/**
 * Params of the files-channel `writeBinary` request (`data` is a data URL, R1).
 */
export type WriteBinaryParams = { path: string; data: string };

/**
 * One game session the way the tools page sees it (R1: exactly these five fields).
 */
export type SessionInfo = {
  readonly id: string;
  readonly game: string;
  readonly page: string;
  readonly embedded: boolean;
  /** Epoch ms. */
  readonly connectedAt: number;
};

/**
 * One child of a folder in the files channel.
 */
export type FileEntry = {
  readonly path: string;
  readonly kind: "file" | "dir";
  readonly size: number;
  readonly version?: string;
};

/**
 * A text file and its version (sha1 of the bytes).
 */
export type FileText = { readonly text: string; readonly version: string };

/**
 * An image read back in a data URL, with its version.
 */
export type FileBinary = { readonly dataUrl: string; readonly version: string };

/**
 * The result of a write.
 */
export type WriteResult = {
  readonly path: string;
  readonly bytes: number;
  readonly version: string;
};

/**
 * Body of `GET {path}/hello`. The socket URL is `{path}/ws?token=<t>&kind=agent|tools` (R1); `ws`
 * carries it without the query.
 */
export type HelloBody = { readonly ws: string; readonly token: string };

/**
 * The JSON of `#moku-editor-boot` in the tools page (R1, R3).
 */
export type ToolsBoot = {
  readonly v: 1;
  /** Socket URL without the query. */
  readonly ws: string;
  readonly token: string;
  /** The hub path, e.g. "/__editor". */
  readonly path: string;
  readonly title: string;
  /** "Open in editor" template, unexpanded. */
  readonly editorUrl: string;
  /** Absolute real project root. */
  readonly root: string;
  /** Same-origin URL of the game page. */
  readonly gameUrl: string;
};

/**
 * A device preset of the tools page (R1).
 */
export type DeviceSpec = {
  readonly id: string;
  readonly name: string;
  readonly w: number;
  readonly h: number;
  readonly safeTop: number;
  readonly safeBottom: number;
  readonly kind: "phone" | "tablet" | "desktop";
};
