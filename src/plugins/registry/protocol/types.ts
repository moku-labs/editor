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
  /**
   * Set by the bridge in its hello when it restored the checkpoint it stored before Bun's full
   * reload (R6): `bookmark` is the JSON text of the restored `game.bookmark` value, `frame` the
   * frame of the page that took it. Absent on every other hello.
   */
  readonly restored?: { readonly bookmark: string; readonly frame: number };
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
 * The link state shown everywhere (design-context §6 B1, F3). A `lost` with `reloading: true` is
 * an expected reload (U7): a server restart (close 1012), a reload the editor started, or a game
 * that said bye before its reload. The views show it in a neutral tone until the game is back, or
 * as a plain `lost` once link's `reloadGraceMs` ran out.
 *
 * @example
 * ```ts
 * const status: LinkStatus = { kind: "live", frame: 1840 };
 * const reloading: LinkStatus = { kind: "lost", reason: "socket_closed", lastFrame: 1825, retryInMs: 1000, reloading: true };
 * ```
 */
export type LinkStatus =
  | { kind: "connecting" }
  | { kind: "live"; frame: number }
  | { kind: "paused"; frame: number }
  | { kind: "silent"; since: number; lastFrame: number }
  | { kind: "lost"; reason: string; lastFrame: number; retryInMs: number; reloading?: true }
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
 * Why a call failed (R1 adds `link_closed`). The selection relay adds `no_editor_page` (-32003: no
 * tools page with `role=page` is open) and `page_closed` (-32001, retryable: the page closed before
 * it answered).
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
  | "link_closed"
  | "no_editor_page"
  | "page_closed";

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
 * Params of the files-channel `find` request: one project-index key.
 */
export type FindParams = { key: string };

/**
 * A graph node by flow and node name: the `node:<flow>/<node>` key of the project index.
 *
 * @example
 * ```ts
 * // filesView's Used by card lists the nodes a file defines.
 * const ref: NodeRef = { flow: "board", node: "merge" }; // node:board/merge
 * ```
 */
export type NodeRef = { readonly flow: string; readonly node: string };

/**
 * One game session the way a tools client sees it: the five R1 fields, the hub's liveness readout
 * once the game has sent a heartbeat (M4), and the hash of the session's command doors (D-37).
 * Old clients ignore `heartbeat` and `manifestHash`.
 *
 * @example
 * ```ts
 * // A paused game in the editor pane, as moku_sessions lists it.
 * const info: SessionInfo = {
 *   id: "s-7f3a",
 *   game: "merge-game 0.0.0",
 *   page: "http://127.0.0.1:3000/",
 *   embedded: true,
 *   connectedAt: 1790000000000,
 *   heartbeat: { frame: 1840, paused: true, silent: false },
 *   manifestHash: "4f528e73"
 * };
 * ```
 */
export type SessionInfo = {
  readonly id: string;
  readonly game: string;
  readonly page: string;
  readonly embedded: boolean;
  /** Epoch ms. */
  readonly connectedAt: number;
  /**
   * Frame and paused of the last heartbeat, and the hub's silent flag. Absent before the first
   * heartbeat. The hub re-sends the list when paused or silent flips, not on every frame.
   */
  readonly heartbeat?: {
    readonly frame: number;
    readonly paused: boolean;
    readonly silent: boolean;
  };
  /**
   * `commandsHash` of the session's manifest, set by the hub on hello. The MCP bridge compares it
   * to rebuild its door tools only when the commands change. Absent from an old hub.
   */
  readonly manifestHash?: string;
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
 * Where a project-index key is defined or used, without a line: the file and what in it holds the
 * key. Mirrors the game's `Anchor` (`@moku-labs/game/project`) field by field.
 *
 * @example
 * ```ts
 * // node:board/merge, defined by the const `merge` of nodes/merge.ts.
 * const anchor: ProjectAnchor = { path: "nodes/merge.ts", binding: "merge" };
 * ```
 */
export type ProjectAnchor = {
  /** The file, root-relative POSIX. */
  readonly path: string;
  /** The const, function or export the definition is bound to. */
  readonly binding?: string;
  /** The property or attribute key: a text style key, the `name` of a projection, a JSX key. */
  readonly key?: string;
  /** JSX: the component an `id=` prop sits on, or the component an `{id}` pattern is written in. */
  readonly component?: string;
  /** JSX only: how the key is written. */
  readonly kind?: "literal" | "template" | "idProp" | "ident";
  /** JSX templates and identifiers: the literal head of the pattern, `card` for `card*Picture`. */
  readonly stem?: string;
};

/**
 * One answer of the files-channel `find`: the anchor with its line read from disk at the call.
 * Mirrors the game's `Found`.
 *
 * @example
 * ```ts
 * // The JSX key settingsBoard: the line of its attribute, the whole element as the range.
 * const found: ProjectFound = {
 *   path: "features/settings/settings.tsx",
 *   key: "settingsBoard",
 *   component: "Signboard",
 *   kind: "idProp",
 *   line: 301,
 *   range: [300, 5, 318, 7],
 *   hash: "0f3c9a…"
 * };
 * ```
 */
export type ProjectFound = ProjectAnchor & {
  /** The line, 1-based. */
  readonly line: number;
  /** Start line, start column, end line, end column; 1-based, the end column exclusive. */
  readonly range: readonly [
    startLine: number,
    startColumn: number,
    endLine: number,
    endColumn: number
  ];
  /** sha1 hex of the bytes the line was read from; equals the files `version` of those bytes. */
  readonly hash: string;
  /** The file does not parse now; the line comes from its last good parse. Write no style edit. */
  readonly broken?: true;
};

/**
 * A project-index key that left one file for another in one watch batch.
 *
 * @example
 * ```ts
 * const move: ProjectMove = {
 *   key: "node:board/catchUp",
 *   from: "nodes/catch-up.ts",
 *   to: "nodes/board/catch-up.ts"
 * };
 * ```
 */
export type ProjectMove = { readonly key: string; readonly from: string; readonly to: string };

/**
 * What one watch batch of the project index changed. The game's `ProjectChange` without its
 * `revision`, which `ProjectState` carries.
 *
 * @example
 * ```ts
 * // An agent moved nodes/catch-up.ts into nodes/board/ and fixed the import of the board flow.
 * const change: ProjectChange = {
 *   files: ["flows/board.ts", "nodes/board/catch-up.ts", "nodes/catch-up.ts"],
 *   moved: [{ key: "node:board/catchUp", from: "nodes/catch-up.ts", to: "nodes/board/catch-up.ts" }],
 *   removed: []
 * };
 * ```
 */
export type ProjectChange = {
  /** The root-relative paths whose bytes changed, appeared or vanished, sorted. */
  readonly files: readonly string[];
  readonly moved: readonly ProjectMove[];
  /** Keys gone from every file. */
  readonly removed: readonly string[];
};

/**
 * The project index as the server publishes it (`editor.project`): `off` with the reason, or
 * `on` with the key → path maps. JSX keys never ride the state; only `find` reaches them.
 *
 * @example
 * ```ts
 * const off: ProjectState = { state: "off", reason: "disabled" };
 * const on: ProjectState = {
 *   state: "on",
 *   revision: "9c1e…",
 *   manifest: "manifest.json",
 *   defs: { "flow:board": ["flows/board.ts"], "node:board/merge": ["nodes/merge.ts"] },
 *   uses: { "node:board/merge": ["flows/board.ts"] },
 *   broken: {}
 * };
 * ```
 */
export type ProjectState =
  | { readonly state: "off"; readonly reason: string }
  | {
      readonly state: "on";
      readonly revision: string;
      /** Revision before this batch; absent on the first state after open. */
      readonly previous?: string;
      /** The asset manifest, root-relative, when that file exists. */
      readonly manifest?: string;
      /** Every key except `jsx:` → its def paths, in def order (a conflict lists both). */
      readonly defs: Readonly<Record<string, readonly string[]>>;
      /** `node:` and `style:` keys that have uses → the paths of the uses. */
      readonly uses: Readonly<Record<string, readonly string[]>>;
      /** Broken files → the first parse error (`<path>:<line>:<col> <message>`). */
      readonly broken: Readonly<Record<string, string>>;
      /** What the batch behind this state changed; absent on the first state after open. */
      readonly change?: ProjectChange;
    };

/**
 * What a view drops when a new project state arrives: `all` after a revision gap (reconnect, the
 * first state, off), otherwise the files, moves and removed keys of the batch.
 *
 * @example
 * ```ts
 * const delta: ProjectDelta = { all: false, files: ["nodes/merge.ts"], moved: [], removed: [] };
 * ```
 */
export type ProjectDelta = {
  readonly all: boolean;
  readonly files: readonly string[];
  readonly moved: readonly ProjectMove[];
  readonly removed: readonly string[];
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
 * The hot reload state of the game server (R6): Bun HMR on or off, and who owns the server. The
 * hub sends it to every tools page as the editor-channel notification `hotReload`, and again
 * after each tools connection opens.
 *
 * @example
 * ```ts
 * const state: HotReload = { hmr: true, owner: "bin" };
 * ```
 */
export type HotReload = {
  /** True when Bun reloads the game page on a source change. */
  readonly hmr: boolean;
  /** "bin" when the moku-editor bin serves the game, "server" for a game's own Bun.serve. */
  readonly owner: "bin" | "server";
};

/**
 * A selected element: a ui element by its path, or a world entity by id. The same shape as the
 * scene's `ElementRef` (panels/shared/scene), declared here so the wire module imports nothing.
 *
 * @example
 * ```ts
 * const ref: SelectionRef = { kind: "ui", path: "column#0/hudRow/coins" };
 * ```
 */
export type SelectionRef =
  | { readonly kind: "ui"; readonly path: string }
  | { readonly kind: "entity"; readonly id: number };

/**
 * A rect in CSS px of the game page (the iframe viewport). The same shape as the scene's `PageRect`.
 *
 * @example
 * ```ts
 * const rect: SelectionRect = { x: 12, y: 40, w: 96, h: 24 };
 * ```
 */
export type SelectionRect = {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
};

/**
 * One element of an area selection (U9): the group roots that lie in the area, in page order.
 *
 * @example
 * ```ts
 * const item: SelectionItem = {
 *   ref: { kind: "ui", path: "column#0/hudRow/coins" },
 *   key: "coins",
 *   name: "coins",
 *   type: "text",
 *   rect: { x: 12, y: 40, w: 96, h: 24 },
 *   source: { path: "src/ui/hud.ts", line: 42 }
 * };
 * ```
 */
export type SelectionItem = {
  readonly ref: SelectionRef;
  /** The ui node's `key`, when it has one. */
  readonly key?: string;
  readonly name: string;
  readonly type: string;
  /** Where it is drawn, in page CSS px. Absent: not placed. */
  readonly rect?: SelectionRect;
  /** The style source line of the element, once found. */
  readonly source?: { readonly path: string; readonly line: number };
};

/**
 * The element selected in the editor page, as the page publishes it (editor-channel notification
 * `selection`) and as the hub answers `editor.selection` and `editor.select`. Check a received
 * value with `parseSelectionInfo`. Its readonly `items` make it not assignable to the mutable
 * Json: senders pass it through `toWireValue`, like a Manifest.
 *
 * @example
 * ```ts
 * // The picker landed on the coins label; the card and the crop are written.
 * const info: SelectionInfo = {
 *   ref: { kind: "ui", path: "column#0/hudRow/coins" },
 *   key: "coins",
 *   projection: "hud",
 *   name: "coins",
 *   type: "text",
 *   rect: { x: 12, y: 40, w: 96, h: 24 },
 *   source: { path: "src/ui/hud.ts", line: 42 },
 *   card: ".moku/captures/2026-10-05/coins-f1840.md",
 *   crop: ".moku/captures/2026-10-05/coins-f1840-crop.jpg",
 *   line: "@moku coins text · src/ui/hud.ts:42 · .moku/captures/2026-10-05/coins-f1840.md",
 *   session: "s-7f3a",
 *   frame: 1840,
 *   at: 1790000000000
 * };
 * ```
 */
export type SelectionInfo = {
  readonly ref: SelectionRef;
  /** The ui node's `key`, when it has one. */
  readonly key?: string;
  /** The projection the element belongs to, e.g. "hud". */
  readonly projection?: string;
  readonly name: string;
  readonly type: string;
  /** Where it is drawn, in page CSS px (as `SceneNode.rect`). Absent: not placed. */
  readonly rect?: SelectionRect;
  /** The style source line of the element, once found. */
  readonly source?: { readonly path: string; readonly line: number };
  /** The capture card, project-relative under `capturesDir`. Set after a pick. */
  readonly card?: string;
  /** The element crop picture, project-relative under `capturesDir`. Set after a pick. */
  readonly crop?: string;
  /** The one-line `@moku …` reference of the element. */
  readonly line?: string;
  /** The game session the element belongs to. */
  readonly session?: string;
  /** The scene frame; after a pick the frame of the pick. */
  readonly frame?: number;
  /**
   * The area of an area selection (U9), in page CSS px. An area selection has `type: "area"`,
   * `name: "area"`, `rect` = the area and `ref` = the first item's ref (`{ kind: "ui", path: "" }`
   * when no element is inside).
   */
  readonly area?: SelectionRect;
  /** The elements of an area selection, top to bottom then left to right; at most 40. */
  readonly items?: readonly SelectionItem[];
  /** Epoch ms of the publish (`Date.now()`). */
  readonly at: number;
};

/**
 * The value of each method `publish` sends to the tools pages (A5): the hub keeps the last one
 * per method and replays it to every tools connection that opens.
 *
 * @example
 * ```ts
 * const kept: PublishParams = {
 *   hotReload: { hmr: true, owner: "bin" },
 *   selection: null,
 *   project: { state: "off", reason: "not opened" }
 * };
 * ```
 */
export type PublishParams = {
  readonly hotReload: HotReload;
  /** `null`: nothing is selected. */
  readonly selection: SelectionInfo | null;
  /** The project index of the files root (`files:project`). */
  readonly project: ProjectState;
};

/**
 * A method `publish` sends to the tools pages (R6): `"hotReload"`, `"selection"` or `"project"`.
 */
export type PublishMethod = keyof PublishParams;

/**
 * The format a picture travels in on the wire (editor.capture, editor.sheet, a crop): `"jpeg"`
 * (the default, D-34) or `"png"` (lossless).
 *
 * @example
 * ```ts
 * const format: PictureFormat = "jpeg";
 * ```
 */
export type PictureFormat = "jpeg" | "png";

/**
 * Params of the editor-channel request `select`: an area by `rect`, the element by `key` (a ui
 * node key, projection-qualified like `"hud/infoBar"` allowed) or by `ref`. `rect` wins over `key`
 * and `ref`. `card` (the page treats absent
 * as true) asks for the capture card and the crop as after a picker click.
 *
 * @example
 * ```ts
 * const params: SelectParams = { key: "hud/infoBar", card: true };
 * const areaParams: SelectParams = { rect: { x: 0, y: 30, w: 200, h: 60 } }; // every element inside
 * ```
 */
export type SelectParams = {
  readonly key?: string;
  readonly ref?: SelectionRef;
  /** An area in page CSS px, picked like a Reference-mode drag (U9). It wins over key and ref. */
  readonly rect?: SelectionRect;
  readonly card?: boolean;
};

/**
 * The editor-channel notifications by method, with their params. `session` goes to agents and
 * tools, the rest to tools connections. `selection` is also sent by the editor page (a tools
 * connection with `role=page`) to the hub.
 *
 * @example
 * ```ts
 * const note: EditorNotifications["selection"] = null; // nothing is selected
 * ```
 */
export type EditorNotifications = {
  readonly session: SessionParams;
  readonly sessions: SessionsParams;
} & PublishParams;

/**
 * The name of an editor-channel notification.
 */
export type EditorNotificationMethod = keyof EditorNotifications;

/**
 * The editor-channel requests by method: `selection` (answered by the hub with the last published
 * selection) and `select` (relayed by the hub to the editor page, which answers the selection).
 *
 * @example
 * ```ts
 * const answer: EditorRequests["select"]["result"] = info; // the element after the select
 * ```
 */
export type EditorRequests = {
  readonly selection: {
    readonly params: Readonly<Record<string, never>>;
    readonly result: SelectionInfo | null;
  };
  readonly select: { readonly params: SelectParams; readonly result: SelectionInfo };
};

/**
 * The name of an editor-channel request.
 */
export type EditorRequestMethod = keyof EditorRequests;

/**
 * The size and corner radius of one screen of a foldable device, in CSS px.
 */
export type FoldScreen = { readonly w: number; readonly h: number; readonly radius: number };

/**
 * A device preset of the tools page (R1, R4): the screen in CSS px, its pixel ratio, safe insets,
 * corner radius, the `<optgroup>` it is listed under and the frame drawn around it (R9). A foldable
 * adds its two screens; its top-level size is the cover screen.
 *
 * @example
 * ```ts
 * const iphone15: DeviceSpec = {
 *   id: "iphone-15", name: "iPhone 15", w: 393, h: 852, safeTop: 59, safeBottom: 34, kind: "phone",
 *   dpr: 3, radius: 55, group: "iphone", frame: "modern"
 * };
 * ```
 */
export type DeviceSpec = {
  readonly id: string;
  readonly name: string;
  readonly w: number;
  readonly h: number;
  readonly safeTop: number;
  readonly safeBottom: number;
  readonly kind: "phone" | "tablet" | "desktop";
  /** Device pixel ratio of the screen. */
  readonly dpr: number;
  /** Corner radius of the screen in CSS px (0 for a desktop). */
  readonly radius: number;
  /** The `<optgroup>` the preset is listed under. */
  readonly group: "iphone" | "android" | "foldable" | "tablet" | "desktop";
  /**
   * The frame drawn around the screen (R9): "modern" is the thin bezel every current device has;
   * "home-button" is the iPhone SE look, with 64 px bands above and below the screen and a round
   * home button in the bottom one.
   */
  readonly frame: "modern" | "home-button";
  /** Set when a value of the preset is an estimate, not a published figure. */
  readonly approx?: true;
  /** The two screens of a foldable: folded (cover) and unfolded (inner). */
  readonly fold?: { readonly cover: FoldScreen; readonly inner: FoldScreen };
};

/**
 * The twenty-one device presets (round 2 R4, round 2b R10), in display order.
 */
export type DevicePresetId =
  | "iphone-se"
  | "iphone-15"
  | "iphone-17e"
  | "iphone-air"
  | "iphone-18-pro"
  | "iphone-18-pro-max"
  | "iphone-15-pro-max"
  | "iphone-16-pro"
  | "iphone-16-pro-max"
  | "galaxy-s24"
  | "galaxy-a55"
  | "redmi-note-13"
  | "pixel-8"
  | "xperia-1-v"
  | "galaxy-z-fold-6"
  | "galaxy-z-flip-6"
  | "pixel-9-pro-fold"
  | "iphone-duo"
  | "ipad-mini"
  | "ipad-air-11"
  | "desktop";

/**
 * Device orientation.
 */
export type Orientation = "portrait" | "landscape";

/**
 * Size and safe insets of a preset in an orientation (resolveDevice, R8).
 */
export type DeviceSize = {
  w: number;
  h: number;
  safe: { top: number; right: number; bottom: number; left: number };
};
