/**
 * @file link plugin — type definitions: config, private constants, the remote channel api (with
 * taps, the page heap and hot reload), the files client, state and the domain context. Wire shapes come from the protocol (R1).
 */
import type { Log } from "@moku-labs/common/browser";
import type { EmitFn } from "@moku-labs/core";
import type { ToolsEvents } from "../../config";
import type {
  EditorChannel,
  FileBinary,
  FileEntry,
  FileText,
  HotReload,
  Json,
  LinkStatus,
  Manifest,
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
 * Cap of the durationMs extension of a long call (R1).
 */
export const LONG_CALL_CAP_MS = 60_000;

/**
 * Link configuration.
 *
 * @example
 * ```ts
 * createApp({ pluginConfigs: { link: { retryMs: 500 } } });
 * ```
 */
export type Config = {
  /** Base delay of the reconnect backoff, in ms. Default 1000. */
  retryMs: number;
  /** CSS selector of the JSON script tag pages injects. Default "#moku-editor-boot". */
  boot: string;
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
};

/**
 * The link api (`app.link`): the remote EditorChannel plus sessions, manifest, boot and the files
 * client. On link the channel members behave so:
 *
 * - `read` and `run` reject -32003 `no_session` (not retryable) at once when no game is connected.
 * - `watch` is accepted in every state, also while disconnected, and is sent again after every
 * reconnect or session change. The first value is the agent's immediate read.
 * - `run` checks the RunResult shape; `editor.series` waits its `durationMs` on top of the call
 * timeout (R1).
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
   * parameter; one random id per tools page). workspace loads its game frame from the tagged URL,
   * so the session of that frame is this page's own: the session choice prefers it and never
   * picks the game frame of another tools tab on its own.
   *
   * @param url - The game page URL, absolute or relative to the tools page.
   * @returns The absolute tagged URL; the URL unchanged when it does not parse.
   * @example
   * ```ts
   * // workspace loads its game frame from the boot's game URL.
   * ctx.require(linkPlugin).frameUrl("http://127.0.0.1:3000/");
   * // "http://127.0.0.1:3000/?__editorFrame=3f9a1c2b7d4e"
   * ```
   */
  frameUrl(url: string): string;

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
   * token. Takes the state the server answers. Bun 1.3.14 cannot switch HMR on a running server,
   * so a change answers false and the state stays; asking for the current value answers true.
   * Never rejects: no boot, a refusal or a network failure answer false.
   *
   * @param on - The asked value.
   * @returns Whether hot reload is `on` afterwards.
   * @example
   * ```ts
   * // The bin serves with HMR on; the user flips the switch off.
   * await ctx.require(linkPlugin).setHotReload(false); // false: restart the bin to change it
   * ```
   */
  setHotReload(on: boolean): Promise<boolean>;
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
  readonly emit: EmitFn<Pick<ToolsEvents, "link:status">>;
  readonly log: Log.LogApi;
};
