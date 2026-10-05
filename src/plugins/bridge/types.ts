/**
 * @file bridge plugin — type definitions: config, constants, state, api, the structural net,
 * socket, tap window and reload seams, the domain deps and the plugin context. No bun or DOM namespace type in an
 * exported shape (skeleton-conventions §3).
 */
import type { Log } from "@moku-labs/common/browser";
import type { EmitFn } from "@moku-labs/core";
import type { AgentEvents, Require } from "../../config";
import type { ChannelApi } from "../channel/types";
import type { Changes, Json, LinkStatus, SubId } from "../registry/protocol";
import type { RegistryApi } from "../registry/types";

/**
 * Default first reconnect delay (config `retryMs`).
 */
export const DEFAULT_RETRY_MS = 1000;

/**
 * Default deadline of one hub request (config `callTimeoutMs`).
 */
export const DEFAULT_CALL_TIMEOUT_MS = 5000;

/**
 * Cap of the reconnect backoff.
 */
export const MAX_RETRY_MS = 30_000;

/**
 * Backoff jitter: ±20 %.
 */
export const JITTER = 0.2;

/**
 * Buffered bytes above which the socket counts as congested (1 MiB).
 */
export const HIGH_WATER = 1_048_576;

/**
 * Buffered bytes below which the backlog is flushed (256 KiB).
 */
export const LOW_WATER = 262_144;

/**
 * Cap of the extension of a long call (R1: the same rule in bridge, hub and link).
 */
export const DEADLINE_EXTRA_CAP_MS = 60_000;

/**
 * The long call that waits its `durationMs` on top.
 */
export const SERIES_ID = "editor.series";

/**
 * The long call that waits its `frames × everyMs` on top (the contact sheet).
 */
export const SHEET_ID = "editor.sheet";

/**
 * The command the bridge adds to the registry: store the checkpoint and reload the page.
 */
export const RELOAD_ID = "editor.reload";

/**
 * Bridge configuration.
 *
 * @example
 * ```ts
 * createApp({ plugins: [bridgePlugin], pluginConfigs: { bridge: { retryMs: 500 } } });
 * ```
 */
export type BridgeConfig = {
  /** Hello route of the editor server: same-origin path or absolute URL. */
  hello: string;
  /** First reconnect delay in ms; doubles per failure up to MAX_RETRY_MS. Integer ≥ 100. */
  retryMs: number;
  /** Deadline of one hub request in ms; a run of editor.series or editor.sheet waits longer (R1). */
  callTimeoutMs: number;
};

/**
 * Connection phase.
 */
export type Phase = "idle" | "connecting" | "open" | "lost" | "stopped";

/**
 * One hub subscription served by the bridge.
 */
export type Subscription = {
  readonly sub: SubId;
  readonly id: string;
  readonly input: Json | undefined;
  /** "frame" → throttled re-read per heartbeat (R6); "edge" | "commit" → channel.watch. */
  readonly changes: Changes;
  stop: (() => void) | undefined;
  /** JSON text of the last value sent (dedupe). */
  lastSent: string | undefined;
};

/**
 * The websocket as the bridge uses it (browser WebSocket or Bun's client).
 */
export type SocketLike = {
  /** 1 = OPEN. */
  readonly readyState: number;
  /** Missing → treated as 0. */
  readonly bufferedAmount?: number;
  send(text: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open", fn: () => void): void;
  addEventListener(type: "message", fn: (event: { readonly data: unknown }) => void): void;
  addEventListener(
    type: "close",
    fn: (event: { readonly code: number; readonly reason: string }) => void
  ): void;
  addEventListener(type: "error", fn: () => void): void;
};

/**
 * The hello answer as the bridge reads it.
 */
export type HelloResponse = {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
};

/**
 * The network seam (fetch, socket, random), injectable for tests. `defaultNet(globalThis)` is the
 * real one.
 *
 * @example
 * ```ts
 * // A unit test answers the hello with a fixed body and never opens a real socket.
 * const net: BridgeNet = {
 *   fetch: async () => ({ ok: true, status: 200, json: async () => ({ ws: "/__editor/ws", token: "t1" }) }),
 *   openSocket: () => fakeSocket,
 *   random: () => 0.5
 * };
 * ```
 */
export type BridgeNet = {
  /** Fetches the hello route: cache, credentials and optional headers (the Origin outside a browser). */
  fetch(
    url: string,
    init: { cache: "no-store"; credentials: "same-origin"; headers?: Record<string, string> }
  ): Promise<HelloResponse>;
  /**
   * Opens a websocket. The real seam passes `{ headers: { origin } }` only when an origin is
   * given: Bun reads it as client headers, a browser would read it as a sub-protocol.
   */
  openSocket(url: string, origin: string | undefined): SocketLike;
  /** A number in [0, 1) for the backoff jitter (`Math.random` in the real seam). */
  random(): number;
};

/**
 * The sessionStorage of the game page as the checkpoint uses it (a browser `Storage` is one).
 */
export type CheckpointStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

/**
 * The page seam of the checkpoint across Bun's full reload (R6) and of `editor.reload`,
 * injectable for tests. `defaultReload()` is the real one.
 *
 * @example
 * ```ts
 * // A unit test fires bun:beforeFullReload itself, reads a Map-backed storage and spies on the reload.
 * const reload: ReloadSeam = {
 *   storage,
 *   doc: 5000,
 *   onBeforeFullReload: listener => listeners.add(listener),
 *   reloadPage: vi.fn()
 * };
 * ```
 */
export type ReloadSeam = {
  /** The page's sessionStorage; undefined outside a browser or when the page refuses it. */
  readonly storage: CheckpointStorage | undefined;
  /** `performance.timeOrigin`: tells this document from the one that stored a checkpoint. */
  readonly doc: number;
  /**
   * Listens to Bun's `bun:beforeFullReload` (`import.meta.hot.on`); a no-op without Bun HMR.
   *
   * @returns The remover.
   */
  onBeforeFullReload(listener: () => void): () => void;
  /** Reloads the page (`location.reload()`); a no-op outside a browser page. */
  reloadPage(): void;
};

/**
 * A checkpoint read back from sessionStorage: the bookmark, its frame and the pause flag.
 */
export type TakenCheckpoint = {
  readonly frame: number;
  readonly paused: boolean;
  readonly bookmark: Json;
};

/**
 * Bridge state.
 */
export type BridgeState = {
  phase: Phase;
  /** Last published status (kind + session change → event). */
  status: LinkStatus;
  /** From the hub's `session` notification after hello (R6). */
  session: string | undefined;
  socket: SocketLike | undefined;
  attempt: number;
  retryTimer: ReturnType<typeof setTimeout> | undefined;
  /** First failure of a streak logged at warn, the rest at debug. */
  failureLogged: boolean;
  lastFrame: number;
  subs: Map<SubId, Subscription>;
  /** Coalesced values while congested (latest wins). */
  pending: Map<SubId, Json>;
  /** Request id → deadline timer. */
  inflight: Map<number, ReturnType<typeof setTimeout>>;
  /** Heartbeat listener, page listeners (visibility, taps, reload) and a scheduled reload, removed on stop. */
  off: (() => void)[];
  /** The checkpoint restored at start, sent once in the next hello (R6). */
  restored: { readonly bookmark: string; readonly frame: number } | undefined;
};

/**
 * The bridge api (`app.bridge`): the state of the dev link from the game page to the editor
 * server. Both methods read state only.
 */
export type BridgeApi = {
  /**
   * The link status: connecting before the socket opens, live or paused from the channel
   * heartbeat while open, lost with the reason and the retry delay after a failure, lost
   * "stopped" after stop. Never `silent` or `empty`: those are tools-side kinds.
   *
   * @returns A fresh LinkStatus.
   * @example
   * ```ts
   * // A dev entry shows the editor link next to the fps counter.
   * app.bridge.status(); // { kind: "connecting" } right after start, then { kind: "live", frame: 12 }
   * ```
   */
  status(): LinkStatus;
  /**
   * The session id the hub gave this page after its hello (R6).
   *
   * @returns The id, or undefined before it arrives and after the socket closes.
   * @example
   * ```ts
   * // Wait for the editor server to accept the page.
   * app.bridge.session(); // "s-7f3a" once the hub answered; undefined before and after stop
   * ```
   */
  session(): string | undefined;
};

/**
 * A pointerdown as the tap watch reads it: the point in page CSS px and the event path.
 */
export type TapEvent = {
  readonly clientX: number;
  readonly clientY: number;
  composedPath(): EventTarget[];
};

/**
 * Listener options of the tap watch.
 */
export type TapOptions = { readonly capture: boolean; readonly passive: boolean };

/**
 * The window of the game page as the tap watch uses it (a browser `Window` is one).
 */
export type TapWindow = {
  addEventListener(type: "pointerdown", fn: (event: TapEvent) => void, options: TapOptions): void;
  removeEventListener(
    type: "pointerdown",
    fn: (event: TapEvent) => void,
    options: TapOptions
  ): void;
};

/**
 * Domain dependencies of every bridge module (unit tests pass fakes).
 */
export type BridgeDeps = {
  readonly config: Readonly<BridgeConfig>;
  readonly state: BridgeState;
  readonly log: Log.LogApi;
  /** ctx.emit("bridge:status", payload). */
  readonly emit: (payload: AgentEvents["bridge:status"]) => void;
  readonly registry: Pick<RegistryApi, "manifest" | "source" | "command" | "clock" | "envelope">;
  readonly channel: Pick<ChannelApi, "read" | "watch" | "run" | "heartbeat" | "onHeartbeat">;
  readonly net: BridgeNet;
  /** sessionStorage, the document id and Bun's beforeFullReload (R6). */
  readonly reload: ReloadSeam;
  readonly page: {
    readonly href: string | undefined;
    readonly document: (EventTarget & { readonly visibilityState?: string }) | undefined;
    /** The page window for the tap watch; undefined outside a browser. */
    readonly window: TapWindow | undefined;
  };
};

/**
 * Plugin context of the bridge: the kernel context is assignable to it.
 */
export type BridgeCtx = {
  readonly config: Readonly<BridgeConfig>;
  state: BridgeState;
  readonly emit: EmitFn<Pick<AgentEvents, "bridge:status">>;
  readonly log: Log.LogApi;
  readonly require: Require;
};
