/**
 * @file bridge plugin — type definitions: config, constants, state, api, the structural net and
 * socket seams, the domain deps and the plugin context. No bun or DOM namespace type in an
 * exported shape (skeleton-conventions §3).
 */
import type { Log } from "@moku-labs/common/browser";
import type { EmitFn } from "@moku-labs/core";
import type { AgentEvents, Require } from "../../config";
import type { ChannelApi } from "../channel/types";
import type { Changes, Json, LinkStatus, SubId } from "../registry/protocol";
import type { RegistryApi } from "../registry/types";

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
 * Cap of the durationMs extension of a long call (R1: the same rule in bridge, hub and link).
 */
export const DEADLINE_EXTRA_CAP_MS = 60_000;

/**
 * The one long call.
 */
export const SERIES_ID = "editor.series";

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
  /** Deadline of one hub request in ms; run of editor.series gets + input.durationMs (R1). */
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
 * The network seam (fetch, socket, random), injectable for tests.
 */
export type BridgeNet = {
  fetch(
    url: string,
    init: { cache: "no-store"; credentials: "same-origin"; headers?: Record<string, string> }
  ): Promise<HelloResponse>;
  openSocket(url: string, origin: string | undefined): SocketLike;
  random(): number;
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
  /** Heartbeat listener and page listeners, removed on stop. */
  off: (() => void)[];
};

/**
 * The bridge api (`app.bridge`).
 *
 * @example
 * ```ts
 * editor.bridge.status(); // { kind: "live", frame: 1840 }
 * ```
 */
export type BridgeApi = {
  status(): LinkStatus;
  session(): string | undefined;
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
  readonly registry: Pick<RegistryApi, "manifest" | "source">;
  readonly channel: Pick<ChannelApi, "read" | "watch" | "run" | "heartbeat" | "onHeartbeat">;
  readonly net: BridgeNet;
  readonly page: {
    readonly href: string | undefined;
    readonly document: (EventTarget & { readonly visibilityState?: string }) | undefined;
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
