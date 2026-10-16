/**
 * @file link plugin — type definitions: config, private constants, the remote channel api (with
 * taps, the page heap, hot reload, the editor page's selection and request handlers, the project
 * index, the published values, the session listeners, the own frame's session, session-targeted
 * runs and editor-method calls), the files client, state and the domain context. Wire shapes come
 * from the protocol (R1).
 */
import type { Log } from "@moku-labs/common/browser";
import type { EmitFn } from "@moku-labs/core";
import type { ToolsEvents } from "../../config";
import type {
  EditorChannel,
  EditorRequests,
  FileBinary,
  FileEntry,
  FileText,
  HotReload,
  Json,
  LinkStatus,
  Manifest,
  ProjectFound,
  ProjectState,
  PublishMethod,
  PublishParams,
  RelayedEditorMethod,
  Request as RpcRequest,
  Response as RpcResponse,
  RunResult,
  SelectionInfo,
  SelectParams,
  SessionInfo,
  SubId,
  Tap,
  ToolsBoot,
  WriteResult
} from "../registry/protocol";

/**
 * No heartbeat of the chosen session for this long → silent (R6).
 */
export const SILENT_AFTER_MS = 6000;

/**
 * Used instead of SILENT_AFTER_MS when the last heartbeat said paused (R6).
 */
export const SILENT_AFTER_PAUSED_MS = 65_000;

/**
 * Interval of the silence check.
 */
export const SILENCE_CHECK_MS = 1000;

/**
 * Cap of the reconnect backoff.
 */
export const MAX_RETRY_MS = 8000;

/**
 * After the chosen session closed, lost turns into empty when no session appeared for this long.
 */
export const EMPTY_AFTER_LOST_MS = 10_000;

/**
 * Local guard on every request; link's callTimeoutMs in the R1 long-call rule.
 */
export const CALL_TIMEOUT_MS = 10_000;

/**
 * Cap of the extension of a long call (R1): durationMs of editor.series, frames × everyMs of
 * editor.sheet.
 */
export const LONG_CALL_CAP_MS = 60_000;

/**
 * How long `setHotReload` waits, after its POST failed on the network, for the reconnect to deliver
 * the hot reload state (A1): the bin restarts the server, so the socket drops and comes back.
 */
export const HOT_RELOAD_CONFIRM_MS = 10_000;

/**
 * Link configuration.
 *
 * @example
 * ```ts
 * // A headless e2e client connects as a plain tools client, not as the editor page.
 * createApp({ pluginConfigs: { link: { retryMs: 500, role: "tools" } } });
 * ```
 */
export type Config = {
  /** Base delay of the reconnect backoff, in ms. Default 1000. */
  retryMs: number;
  /** CSS selector of the JSON script tag pages injects. Default "#moku-editor-boot". */
  boot: string;
  /**
   * "page": the editor page (`&role=page` on the upgrade, D-33): the hub takes its selection and
   * relays the editor requests `select`, `device`, `show` and `node` to it. "tools": a plain tools
   * client (no role sent). Default "page".
   */
  role: "page" | "tools";
  /**
   * How long an expected reload (U7) reads neutral: a server restart (close 1012), a reload the
   * editor started, a game that said bye. Without a heartbeat of the game by then, the status is a
   * plain `lost`. A positive number of ms. Default 8000: the bin's restart keeps its port closed
   * for up to 6 s (D-57) and the reconnects land 1 s, 3 s and 7 s after the close, so the window
   * outlasts the one at 7 s. No upper bound: a window still open EMPTY_AFTER_LOST_MS (10 s) after
   * a session loss ends as `empty` when no session came back, with no plain `lost` before it.
   */
  reloadGraceMs: number;
};

/**
 * An expected reload in progress (U7): until the game beats again after a loss, or the grace
 * timer ends it, a `lost` status carries `reloading: true`.
 */
export type ReloadWindow = {
  /** The frame of the last heartbeat before the reload; kept across the reconnect. */
  lastFrame: number;
  /** Set once a loss happened in the window: from then on a heartbeat ends it. A renewal clears it. */
  lost: boolean;
  /** Ends the window after `reloadGraceMs`. */
  readonly timer: ReturnType<typeof setTimeout>;
};

/**
 * An editor-channel notification the editor page sends to the hub.
 */
export type NotifyMethod = "selection";

/**
 * The handler of the editor-channel request `select` the hub relays to the editor page.
 */
export type SelectHandler = (params: SelectParams) => Promise<SelectionInfo>;

/**
 * The handler of an editor-channel request the hub relays to the editor page (`select`, `device`,
 * `show` or `node`). It gets the checked params of its method and answers the result of that
 * method, at once or as a promise. An error it throws is the failure the caller gets.
 *
 * @example
 * ```ts
 * // A view answers `show`: it opens the asked workspace, then reads the rail back.
 * const answerShow: RequestHandler<"show"> = params => {
 *   if (params.workspace !== undefined) open(params.workspace);
 *   return { workspace: active(), workspaces: WORKSPACE_NAMES };
 * };
 * const remove = ctx.require(linkPlugin).handle("show", answerShow);
 * ```
 */
export type RequestHandler<M extends RelayedEditorMethod> = (
  params: EditorRequests[M]["params"]
) => EditorRequests[M]["result"] | Promise<EditorRequests[M]["result"]>;

/**
 * A handler `handle` added, bound to the params parser of its method: it answers one request of
 * that method. Bad params are the -32602 response, a throwing handler its failure; it never
 * rejects.
 */
export type RequestEntry = (ctx: LinkCtx, request: RpcRequest) => Promise<RpcResponse>;

/**
 * A `setHotReload` call whose POST may fail while the bin restarts the server (A1). `before` is the
 * socket at the call; a hot reload state delivered on another socket (the reconnect) confirms it.
 */
export type HotReloadWaiter = {
  readonly before: WebSocket | undefined;
  /** Set once a reconnect delivered the hot reload state. */
  delivered: boolean;
  /** Ends the bounded wait; set only while the call waits. */
  settle: ((delivered: boolean) => void) | undefined;
};

/**
 * The files channel as the tools views use it (R1, R4). No session: it works without a game. Each
 * method sends one files-channel request and checks the result shape. A bad shape rejects -32600;
 * server errors (`version_conflict`, `forbidden_path` …) reject as wire errors.
 *
 * @example
 * ```ts
 * // The files view saves a Markdown tab while no game is connected.
 * await app.link.files.write("docs/plan.md", "# Plan\n");
 * ```
 */
export type FilesClient = {
  /**
   * Lists a folder.
   *
   * @param dir - Folder path relative to the root ("" for the root).
   * @returns The entries.
   * @example
   * ```ts
   * // gameView lists the captures folder before it names a new capture.
   * await app.link.files.list(".moku/captures");
   * // [{ path: ".moku/captures/a.png", kind: "file", size: 3, version: "v" }]
   * ```
   */
  list(dir: string): Promise<readonly FileEntry[]>;

  /**
   * Reads a text file.
   *
   * @param path - File path relative to the root.
   * @returns `{ text, version }`.
   * @example
   * ```ts
   * // The files view opens a source tab.
   * await app.link.files.read("src/a.ts"); // { text: "x", version: "v1" }
   * ```
   */
  read(path: string): Promise<FileText>;

  /**
   * Writes a text file. With `version`, the write is checked against the version the edit started
   * from.
   *
   * @param path - File path relative to the root.
   * @param text - The new content.
   * @param version - The version the edit started from; omit to overwrite.
   * @returns `{ path, bytes, version }`.
   * @throws {Error} Rejects -32005 `version_conflict` when the file changed since `version`.
   * @example
   * ```ts
   * // The files view saves a tab it read at version "v1".
   * await app.link.files.write("a.md", "hi", "v1"); // { path: "a.md", bytes: 2, version: "v3" }
   * ```
   */
  write(path: string, text: string, version?: string): Promise<WriteResult>;

  /**
   * Writes an image from a data URL (R1).
   *
   * @param path - Image path relative to the root.
   * @param dataUrl - `data:image/png;base64,…`.
   * @returns `{ path, bytes, version }`.
   * @example
   * ```ts
   * // gameView saves a capture of the game frame.
   * await app.link.files.writeBinary(".moku/captures/a.png", "data:image/png;base64,iVBORw0KGgo=");
   * // { path: ".moku/captures/a.png", bytes: 8, version: "v" }
   * ```
   */
  writeBinary(path: string, dataUrl: string): Promise<WriteResult>;

  /**
   * Reads an image back as a data URL (R1).
   *
   * @param path - Image path relative to the root.
   * @returns `{ dataUrl, version }`.
   * @example
   * ```ts
   * // The contact sheet shows a saved capture.
   * await app.link.files.readBinary(".moku/captures/a.png");
   * // { dataUrl: "data:image/png;base64,iVBORw0KGgo=", version: "v" }
   * ```
   */
  readBinary(path: string): Promise<FileBinary>;

  /**
   * Asks the project index where a key lives. Lines are read from disk at the call, and each
   * answer's `hash` equals the files `version` of its path. Rejects -32008 `not_installed` while
   * the index is off.
   *
   * @param key - A project-index key, e.g. `"node:board/merge"` or `"jsx:settingsBoard"`.
   * @returns Every place the key is defined; empty for a key the index does not know.
   * @example
   * ```ts
   * // The Flow inspector opens the Code tab of the selected node.
   * await ctx.require(linkPlugin).files.find("node:board/merge");
   * // [{ path: "nodes/merge.ts", binding: "merge", line: 17, range: [17, 1, 30, 3], hash: "a1" }]
   * ```
   */
  find(key: string): Promise<readonly ProjectFound[]>;
};

/**
 * The link api (`app.link`): the remote EditorChannel plus sessions, manifest, boot and the files
 * client. On link the channel members behave so:
 *
 * - `read` and `run` reject -32003 `no_session` (not retryable) at once when no game is connected.
 * - `watch` is accepted in every state, also while disconnected, and is sent again after every
 * reconnect or session change. The first value is the agent's immediate read.
 * - `run` checks the RunResult shape; `editor.series` waits its `durationMs` and `editor.sheet`
 * its `frames × everyMs` on top of the call timeout (R1).
 * - `status` returns a copy.
 *
 * @example
 * ```ts
 * // Step the attached game by one frame.
 * const ran = await app.link.run("game.step", { frames: 1 }); // ran.state.frame === 1841
 * ```
 */
export type LinkApi = EditorChannel & {
  /**
   * The cached manifest of the chosen session.
   *
   * @returns The manifest, undefined before one is attached.
   * @example
   * ```ts
   * // Which game is attached?
   * app.link.manifest()?.game; // "merge-game 0.0.0"
   * ```
   */
  manifest(): Manifest | undefined;

  /**
   * Listens to the manifest: called at once when one exists, then on every attach, and with
   * undefined when the session is lost. A throwing listener is logged and does not stop the others.
   *
   * @param fn - The listener.
   * @returns Unsubscribe.
   * @example
   * ```ts
   * // Count the sources of whichever game is attached.
   * const stop = app.link.onManifest(manifest => console.log(manifest?.sources.length)); // logs 2
   * stop();
   * ```
   */
  onManifest(fn: (manifest: Manifest | undefined) => void): () => void;

  /**
   * The last session list from the hub (empty while disconnected).
   *
   * @returns A copy of the list.
   * @example
   * ```ts
   * // The session chip lists the open games.
   * app.link.sessions().map(session => session.id); // ["s-1"]
   * ```
   */
  sessions(): readonly SessionInfo[];

  /**
   * The chosen session id.
   *
   * @returns The id, undefined when none is chosen.
   * @example
   * ```ts
   * // The session chip marks the game the tools are attached to.
   * app.link.session(); // "s-1"
   * ```
   */
  session(): string | undefined;

  /**
   * Makes a session the sticky choice and attaches it. Choosing the attached session only makes
   * it sticky.
   *
   * @param session - An id from `sessions()`.
   * @returns The manifest of the session.
   * @throws {Error} Rejects -32003 `choose_session` (not retryable) for an id that is not open.
   * @example
   * ```ts
   * // The user picks the second open game in the session chip.
   * await app.link.choose("s-2"); // its manifest; app.link.session() is now "s-2"
   * ```
   */
  choose(session: string): Promise<Manifest>;

  /**
   * "Retry now": reconnects at once, re-picks a session when only the session was lost, or re-reads
   * the boot tag after `no_boot`. A no-op unless lost, and after stop.
   *
   * @example
   * ```ts
   * // The status card shows "Lost · retry in 8s"; the user clicks Retry now.
   * app.link.retry(); // reconnects without waiting for the backoff timer
   * ```
   */
  retry(): void;

  /**
   * Tells link that the game page is about to reload on purpose (U7). Until the game beats again,
   * or for `reloadGraceMs`, the loss that follows reads `lost` with `reloading: true`, which the
   * views show in a neutral tone; after that it is a plain `lost`. A loss that happened before the
   * call stays as it is. A no-op after stop.
   *
   * @example
   * ```ts
   * // workspace reloads the docked game frame from the palette.
   * const link = ctx.require(linkPlugin);
   * link.expectReload();
   * iframe.src = link.frameUrl("http://127.0.0.1:3000/");
   * // the session close that follows:
   * link.status(); // { kind: "lost", reason: "game_reloaded", lastFrame: 1825, retryInMs: 1000, reloading: true }
   * ```
   */
  expectReload(): void;

  /**
   * The boot data of the tools page; its token is never to be logged.
   *
   * @returns The ToolsBoot, undefined when the tag was missing or invalid.
   * @example
   * ```ts
   * // The game frame loads the game page from the boot data.
   * app.link.boot()?.gameUrl; // "/"
   * ```
   */
  boot(): ToolsBoot | undefined;

  /**
   * Tags a game page URL with the frame id of this tools page (the `__editorFrame` query
   * parameter; one random id per tools page) and, with `opts.player`, the dev page's scenario.
   * workspace loads its game frame from the tagged URL, so the session of that frame is this
   * page's own: the session choice prefers it and never picks the game frame of another tools tab
   * on its own.
   *
   * @param url - The game page URL, absolute or relative to the tools page.
   * @param opts - The scenario to start from (dev only).
   * @returns The absolute tagged URL; the URL unchanged when it does not parse.
   * @example
   * ```ts
   * // workspace loads its game frame from the scenario the person picked.
   * ctx.require(linkPlugin).frameUrl("http://127.0.0.1:3000/", { player: "full" });
   * // "http://127.0.0.1:3000/?player=full&__editorFrame=3f9a1c2b7d4e"
   * ```
   */
  frameUrl(url: string, opts?: FrameUrlOptions): string;

  /**
   * True when a page URL (`Manifest.page`, `SessionInfo.page`) is the game frame of another tools
   * tab: it carries a frame id that is not this page's. A page without a frame id is not.
   *
   * @param page - A page URL.
   * @returns Whether the page belongs to another tools tab.
   * @example
   * ```ts
   * // workspace's D-07 reload skips the manifest of a second tools tab's game.
   * const link = ctx.require(linkPlugin);
   * link.isOtherTab("http://127.0.0.1:3000/?__editorFrame=aaaaaaaaaaaa"); // true
   * link.isOtherTab(link.frameUrl("http://127.0.0.1:3000/")); // false: this page's own frame
   * ```
   */
  isOtherTab(page: string): boolean;

  /**
   * Listens to the taps of the attached game: every `pointerdown` on the game page, in page CSS
   * px of the game document (device px of the frame) and the page's `performance.now()`. Taps of
   * other sessions are dropped. The game page sends at most one tap per 50 ms. Each listener gets
   * the same frozen tap; a throwing listener is logged and does not stop the others.
   *
   * @param listener - Called with each tap.
   * @returns An idempotent unsubscribe.
   * @example
   * ```ts
   * // workspace draws a ripple where a click lands in the docked game frame.
   * const stop = ctx.require(linkPlugin).onTap(tap => ripple(tap.x, tap.y)); // { x: 206, y: 640, at: 15234.5 }
   * stop();
   * ```
   */
  onTap(listener: (tap: Tap) => void): () => void;

  /**
   * The JS heap of the attached game page from its last heartbeat, in MB rounded to 0.1. Only
   * Chromium reports it.
   *
   * @returns A copy of `{ usedMb, limitMb }`; undefined until the page reports one, when its last
   * beat had none, and after a session change.
   * @example
   * ```ts
   * // The Render view shows the heap tile on each game.render change.
   * ctx.require(linkPlugin).heap(); // { usedMb: 12.8, limitMb: 4095.8 } in Chromium, undefined elsewhere
   * ```
   */
  heap(): { usedMb: number; limitMb: number } | undefined;

  /**
   * The hot reload state of the game server (R6): whether Bun reloads the game page on a source
   * change, and who owns the server. The hub sends it after the socket opens and on each change.
   *
   * @returns A copy of `{ hmr, owner }`; undefined until the hub sent one.
   * @example
   * ```ts
   * // The moku-editor bin serves the game with Bun HMR on.
   * ctx.require(linkPlugin).hotReload(); // { hmr: true, owner: "bin" }
   * ```
   */
  hotReload(): HotReload | undefined;
  /**
   * Listens to the hot reload state: called at once when it is known, then on each change. Each
   * listener gets the same frozen state; a throwing listener is logged and does not stop the
   * others.
   *
   * @param listener - Called with each state.
   * @returns An idempotent unsubscribe.
   * @example
   * ```ts
   * // workspace shows the Hot reload switch as read-only for a game's own server.
   * const stop = ctx.require(linkPlugin).onHotReload(state => show(state.hmr, state.owner === "bin"));
   * stop();
   * ```
   */
  onHotReload(listener: (state: HotReload) => void): () => void;
  /**
   * Asks the server for hot reload on or off: `POST {path}/hmr` on the page origin with the boot
   * token. Takes the state the server answers. The bin accepts a change and restarts its server
   * (D-32); a game's own server refuses it. The restart can cut the answer off: after a network
   * failure the call waits up to 10 s for the reconnect to deliver the hot reload state and
   * answers whether its `hmr` equals `on` (A1). Never rejects: no boot, a refusal, a failed restart
   * or no reconnect in time answer false.
   *
   * @param on - The asked value.
   * @returns True when the bin owns the server and its HMR now equals `on`; false otherwise.
   * @example
   * ```ts
   * // The bin serves with HMR on; the user flips the switch off in workspace.
   * await ctx.require(linkPlugin).setHotReload(false); // true: the bin restarted without HMR
   * ```
   */
  setHotReload(on: boolean): Promise<boolean>;
  /**
   * The selection of the editor, as the hub last sent it (`editor.selection`): this page's own
   * publish echoed back, or the one of another editor page tab.
   *
   * @returns A fresh copy; undefined when nothing is selected or the hub sent none yet.
   * @example
   * ```ts
   * // The hub echoed the coins label the picker landed on.
   * ctx.require(linkPlugin).selection()?.key; // "coins"
   * ```
   */
  selection(): SelectionInfo | undefined;
  /**
   * Sends an editor-channel notification to the hub: `selection` publishes what the editor page
   * selected (`null`: nothing). The hub takes it only from a `role: "page"` link. Dropped while
   * the socket is closed; the last value is sent again each time the socket opens.
   *
   * @param method - "selection".
   * @param params - The selection, or null when nothing is selected.
   * @example
   * ```ts
   * // gameView publishes the element the picker landed on.
   * ctx.require(linkPlugin).notify("selection", {
   *   ref: { kind: "ui", path: "column#0/hudRow/coins" },
   *   key: "coins",
   *   name: "coins",
   *   type: "text",
   *   at: Date.now()
   * }); // MCP moku_selection now answers the coins label
   * ```
   */
  notify(method: NotifyMethod, params: PublishParams["selection"]): void;
  /**
   * Handles an editor-channel request the hub relays to this page: `select` (MCP `moku_select`),
   * `device`, `show` or `node`. One handler per method: a later handler replaces the earlier one
   * of the same method and leaves the other methods alone. The params are checked first with the
   * parser of the method (-32602 `invalid_input`); the handler's result is the answer, a thrown
   * error the failure. Without a handler of the method the hub gets -32601.
   *
   * @param method - "select", "device", "show" or "node".
   * @param handler - Gets the checked params of the method; returns or resolves its result.
   * @returns An idempotent remover; it removes only this handler.
   * @example
   * ```ts
   * // gameView answers `select` with a promise; flowView answers `node` at once.
   * const link = ctx.require(linkPlugin);
   * const offSelect = link.handle("select", params => selectByKey(params));
   * // editor.select { key: "coins" } → { key: "coins", name: "coins", card: ".moku/captures/2026-10-05/coins-f1840.md", … }
   * const offNode = link.handle("node", ({ id }) => ({ id, selected: id }));
   * // editor.node { id: "main/home" } → { id: "main/home", selected: "main/home" }
   * ```
   */
  handle<M extends RelayedEditorMethod>(method: M, handler: RequestHandler<M>): () => void;
  /**
   * The project index the hub last sent (`editor.project`): on with its key maps, or off with the
   * reason. Kept across reconnects. Each new state is also the tools event `link:project`, with
   * the delta a view drops by.
   *
   * @returns The frozen state; undefined until the hub sent one.
   * @example
   * ```ts
   * // filesView lists the flows that use the open node file.
   * const project = ctx.require(linkPlugin).project();
   * project?.state === "on" ? project.uses["node:board/merge"] : []; // ["flows/board.ts"]
   * ```
   */
  project(): ProjectState | undefined;
  /**
   * The fingerprint id of the engine the computer serves: the project's installed
   * `@moku-labs/game` (version + dist hash, the recipe of the page's `__MOKU_GAME_ENGINE__`), as
   * the hub published it (`editor.engine`). Kept across reconnects.
   *
   * @returns The id; undefined until the hub sent one, or when it has none ("unknown").
   * @example
   * ```ts
   * // renderView marks a phone that runs another engine than the computer.
   * ctx.require(linkPlugin).engine(); // "0.14.13+1ab7f2"
   * ```
   */
  engine(): string | undefined;
  /**
   * Listens to the computer's engine fingerprint: called at once when it is known, then on each
   * change. The replay of the same id after a reconnect calls nothing; a change from a known id
   * to "unknown" calls it with `undefined` (`engine()` answers undefined from then on). A
   * throwing listener is logged and does not stop the others.
   *
   * @param listener - Called with the id; with undefined when the hub no longer knows one.
   * @returns An idempotent unsubscribe.
   * @example
   * ```ts
   * // workspace re-renders the top bar when the fingerprint arrives.
   * const stop = ctx.require(linkPlugin).onEngine(() => state.ui.bump());
   * stop();
   * ```
   */
  onEngine(listener: (engine: string | undefined) => void): () => void;
  /**
   * The last value the server published for a method, kept across reconnects (the hub replays it
   * on every socket open). `devices` and `deviceTelemetry` (connect's device directory and wired
   * telemetry) are checked whole with the `connect/protocol` guards before link keeps them: a
   * malformed value is the warning `link:bad-published` and the held one stays. `engine`,
   * `project`, `hotReload` and `selection` answer the values link already keeps for `engine()`,
   * `project()`, `hotReload()` and `selection()`; `selection` answers undefined also while
   * nothing is selected. Frozen: a reader never changes what the next one sees.
   *
   * @param method - A publish method: "devices", "deviceTelemetry", "engine", "project",
   *   "hotReload" or "selection".
   * @returns The value; undefined before the first.
   * @example
   * ```ts
   * // activeSource checks whether device mode is on before it offers "By wire".
   * const directory = ctx.require(linkPlugin).published("devices");
   * directory?.mode.on; // true
   * directory?.linked[0]?.session; // "s-9": the Galaxy A26 (SM-A266B) linked as d-7f3a
   * ```
   */
  published<M extends PublishMethod>(method: M): PublishParams[M] | undefined;
  /**
   * Listens to a published method: called with every new value, never at once (read
   * `published(method)` for the current one). A replay of an equal value calls nothing, so a
   * reconnect does not repaint a panel; a malformed value calls nothing. Each listener gets the
   * same frozen value; a throwing listener is logged as `link:published-listener-failed` and the
   * others still run.
   *
   * @param method - A publish method.
   * @param fn - Called with each new value; `selection` passes null when the selection clears.
   * @returns An idempotent unsubscribe.
   * @example
   * ```ts
   * // activeSource shows the wired telemetry of the phone that is the source, once a second.
   * const off = ctx.require(linkPlugin).onPublished("deviceTelemetry", record => {
   *   if (record.device === "d-7f3a" && record.gpu.available) show(record.gpu.value.mhz); // 221
   * });
   * off();
   * ```
   */
  onPublished<M extends PublishMethod>(
    method: M,
    fn: (value: PublishParams[M]) => void
  ): () => void;
  /**
   * Listens to the session list: called after every `sessions` notification of the hub is
   * applied, so `session()` already answers the new pick. A socket close calls nothing (the list
   * the hub sends after the reconnect does), nor does a malformed list. Each listener gets the
   * same frozen list; a throwing listener is logged as `link:sessions-listener-failed` and the
   * others still run.
   *
   * @param fn - Called with each applied list.
   * @returns An idempotent unsubscribe.
   * @example
   * ```ts
   * // activeSource notices the phone linking: a session with a device appears.
   * const off = ctx.require(linkPlugin).onSessions(list => {
   *   const phone = list.find(session => session.device !== undefined);
   *   phone?.device?.id; // "d-7f3a"
   * });
   * off();
   * ```
   */
  onSessions(fn: (list: readonly SessionInfo[]) => void): () => void;
  /**
   * This page's own game frame session (the local preview): the newest open embedded session
   * whose page carries this page's frame id (`frameUrl`). The game frame of another tools tab, or
   * the frame URL opened outside an iframe, is never own. While the frame reloads, the newer of
   * its two sessions wins.
   *
   * @returns The id; undefined when the frame has no session (not mounted yet, reloading, or no
   *   frame on this page).
   * @example
   * ```ts
   * // activeSource pauses the local preview before the phone becomes the source.
   * const link = ctx.require(linkPlugin);
   * const own = link.ownSession(); // "s-1"
   * if (own !== undefined) await link.runIn(own, "game.pause");
   * ```
   */
  ownSession(): string | undefined;
  /**
   * Runs a command on a named open session without changing the choice: `session()`, the watches
   * and the manifest stay with the chosen session. The result shape is checked like `run`, and
   * the long-call rule of `run` applies.
   *
   * @param session - An open session id from `sessions()`.
   * @param id - The command id.
   * @param input - The command input; omitted when undefined.
   * @returns The RunResult.
   * @throws {Error} Rejects -32003 `no_session` (not retryable) at once for an id that is not open,
   *   also while disconnected; the command's own wire error otherwise; -32600 for an answer that
   *   is not a RunResult.
   * @example
   * ```ts
   * // The phone is the source; the local preview holds while it is.
   * const paused = await ctx.require(linkPlugin).runIn("s-1", "game.pause");
   * paused.value; // true
   * ```
   */
  runIn(session: string, id: string, input?: Json): Promise<RunResult>;
  /**
   * Calls a server editor-channel method another server plugin registered on the hub
   * (`hub.addEditorMethods`), such as connect's `connect.wire`. No session: it works without a
   * game. link adds no rule of its own: the hub answers what it knows.
   *
   * @param method - The method, `<plugin>.<verb>`.
   * @param params - Its params; omitted when undefined.
   * @returns The method's result.
   * @throws {Error} Rejects -32002 `link_closed` (retryable) at once while disconnected; the
   *   method's wire error otherwise (-32601 for a method nobody registered).
   * @example
   * ```ts
   * // The Connect panel's "By wire" turns device mode on.
   * await ctx.require(linkPlugin).callEditor("connect.wire");
   * // { listen: { port: 47600, adb: "127.0.0.1:47600", lan: null } }
   * ```
   */
  callEditor(method: string, params?: Json): Promise<Json>;
  /**
   * The files channel client.
   *
   * @example
   * ```ts
   * // Another plugin saves a file through link.
   * await ctx.require(linkPlugin).files.read("src/a.ts"); // { text: "x", version: "v1" }
   * ```
   */
  files: FilesClient;
};

/**
 * Options of `frameUrl`.
 *
 * @example
 * ```ts
 * const opts: FrameUrlOptions = { player: "full" };
 * ```
 */
export type FrameUrlOptions = {
  /**
   * A scenario of the engine dev page (`tests/scenarios/<name>.ts`): sets the `player` query
   * parameter, which `startPage` reads (`?player=<name>`). Dev only. Absent or "": the URL's own
   * `player` parameter is left as it is.
   */
  readonly player?: string;
};

/**
 * One watch record; kept while disconnected and re-sent after every attach (R4).
 */
export type Subscription = {
  /** Local id, never sent. */
  readonly key: number;
  readonly id: string;
  readonly input: Json | undefined;
  readonly onValue: (value: Json) => void;
  /** Numeric wire sub while attached (R6), else undefined. */
  wireSub: SubId | undefined;
  /** The session that answered -32008 `not_installed`: the watch is not sent to it again. */
  refusedBy?: string | undefined;
};

/**
 * One request in flight.
 */
export type PendingCall = {
  readonly resolve: (value: Json) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
};

/**
 * The publish methods whose values link keeps only for `published` (connect's): the other
 * methods live in their own state fields (`engine`, `project`, `hotReload`, `selection`).
 */
export type HeldMethod = "devices" | "deviceTelemetry";

/**
 * The last valid value of each held publish method, frozen; undefined before the first.
 */
export type HeldPublished = { [M in HeldMethod]: PublishParams[M] | undefined };

/**
 * The onPublished listeners of every publish method (wrappers: the same function added twice is
 * two entries).
 */
export type PublishedListeners = {
  readonly [M in PublishMethod]: Set<(value: PublishParams[M]) => void>;
};

/**
 * Inputs of the pure status reducer.
 */
export type StatusInput =
  | { type: "socket-open" }
  | { type: "socket-closed"; reason: string; retryInMs: number }
  | { type: "no-boot" }
  | { type: "sessions"; attached: boolean; count: number }
  | { type: "attached" }
  | { type: "heartbeat"; frame: number; paused: boolean }
  | { type: "silence"; since: number }
  | { type: "session-closed"; reason: string; retryInMs: number }
  | { type: "lost-expired" };

/**
 * Link state.
 */
export type LinkState = {
  status: LinkStatus;
  boot: ToolsBoot | undefined;
  socket: WebSocket | undefined;
  open: boolean;
  attempt: number;
  nextId: number;
  pending: Map<number, PendingCall>;
  sessions: readonly SessionInfo[];
  chosen: string | undefined;
  sticky: boolean;
  manifests: Map<string, Manifest>;
  manifestListeners: Set<(manifest: Manifest | undefined) => void>;
  /** onTap listeners (wrappers: the same function added twice is two entries). */
  tapListeners: Set<(tap: Tap) => void>;
  /** The last hot reload state the hub sent or the route answered (R6). */
  hotReload: HotReload | undefined;
  /** onHotReload listeners (wrappers, like tapListeners). */
  hotReloadListeners: Set<(state: HotReload) => void>;
  /** setHotReload calls that wait for the reconnect to confirm them (A1). */
  hotReloadWaiters: Set<HotReloadWaiter>;
  /** The selection the hub last sent (`editor.selection`); undefined for none or null. */
  selection: SelectionInfo | undefined;
  /** The project index the hub last sent (`editor.project`), frozen; kept across reconnects. */
  project: ProjectState | undefined;
  /**
   * The computer-side engine the hub published (`editor.engine`), frozen; kept across reconnects.
   * The id "unknown" is held too: `engine()` answers undefined for it.
   */
  engine: PublishParams["engine"] | undefined;
  /** onEngine listeners (wrappers, like hotReloadListeners). */
  engineListeners: Set<(engine: string | undefined) => void>;
  /** connect's published values (`editor.devices`, `editor.deviceTelemetry`); kept across reconnects. */
  published: HeldPublished;
  /** onPublished listeners, per publish method. */
  publishedListeners: PublishedListeners;
  /** onSessions listeners (wrappers, like tapListeners). */
  sessionsListeners: Set<(list: readonly SessionInfo[]) => void>;
  /** The last wire value this page notified, per method; sent again on every socket open. */
  notified: Map<NotifyMethod, Json>;
  /**
   * The handlers of the editor-channel requests the hub relays to this page, one per method, each
   * with the params parser of its method.
   */
  handlers: Map<RelayedEditorMethod, RequestEntry>;
  subs: Map<number, Subscription>;
  wire: Map<SubId, Subscription>;
  /** Only grows: a sub number is never reused, so late values of an old sub are dropped. */
  nextSub: SubId;
  /** Bumped on every attach; an answer of an older attach is ignored. */
  generation: number;
  nextKey: number;
  /** The last heartbeat of the chosen session; cleared on every attach and session loss. */
  heartbeat:
    | {
        frame: number;
        paused: boolean;
        receivedAt: number;
        heap?: { readonly usedMb: number; readonly limitMb: number };
      }
    | undefined;
  lostAt: number | undefined;
  retryTimer: ReturnType<typeof setTimeout> | undefined;
  silenceTimer: ReturnType<typeof setInterval> | undefined;
  /** The expected reload in progress (U7), undefined when none. */
  reload: ReloadWindow | undefined;
  /** Set by onStop; every callback returns early when true. */
  stopped: boolean;
  /** The frame id of this tools page, made once: its game frame URL carries it (`frameUrl`). */
  readonly frame: string;
};

/**
 * Domain context of link: the kernel context is assignable to it.
 */
export type LinkCtx = {
  readonly config: Readonly<Config>;
  state: LinkState;
  readonly emit: EmitFn<Pick<ToolsEvents, "link:status" | "link:project">>;
  readonly log: Log.LogApi;
};
