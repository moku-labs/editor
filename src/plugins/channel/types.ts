/**
 * @file channel plugin — type definitions: config, state, api, the registry slice it needs and
 * the domain contexts.
 */
import type { Log } from "@moku-labs/common/browser";
import type { Require } from "../../config";
import type { EditorChannel, Heartbeat } from "../registry/protocol";
import type { RegistryApi } from "../registry/types";

/**
 * Channel configuration.
 *
 * @example
 * ```ts
 * createApp({ pluginConfigs: { channel: { heartbeatMs: 500 } } });
 * ```
 */
export type ChannelConfig = {
  /** Milliseconds between two heartbeats. Finite integer ≥ 100. */
  heartbeatMs: number;
};

/**
 * A heartbeat listener (the bridge pushes beats, samples frame sources, flushes its backlog).
 */
export type HeartbeatListener = (beat: Heartbeat) => void;

/**
 * Channel state: the interval, the listeners and every open watch.
 */
export type ChannelState = {
  /** The heartbeat interval, set in onStart, cleared in onStop. */
  timer: ReturnType<typeof setInterval> | undefined;
  /** onHeartbeat listeners, in subscription order. */
  listeners: Set<HeartbeatListener>;
  /** Stop functions of every open watch, so onStop can close them. */
  watches: Set<() => void>;
};

/**
 * The channel api (`app.channel`, `ctx.require(channelPlugin)`): the in-process EditorChannel of
 * the game page plus the heartbeat. `read`, `watch`, `run` and `status` are documented on
 * EditorChannel. Here `watch` delivers the current value before it returns, and an unknown id, an
 * invalid input or a throwing first `onValue` throws synchronously and opens no watch.
 */
export type ChannelApi = EditorChannel & {
  /**
   * A fresh frozen beat now, from the registry clock.
   *
   * @returns `{ frame, paused, at }`, `at` in epoch ms.
   * @example
   * ```ts
   * // The bridge sends a beat right after the socket opens.
   * ctx.require(channelPlugin).heartbeat(); // { frame: 1840, paused: false, at: 1790000000000 }
   * ```
   */
  heartbeat(): Heartbeat;
  /**
   * Adds a listener called on every interval tick (`heartbeatMs`), in subscription order. A
   * throwing listener is logged at warn and the others still run. No beat is sent at start.
   *
   * @param fn - The listener.
   * @returns An idempotent remover.
   * @example
   * ```ts
   * // The bridge pushes every beat to the editor server until it stops.
   * const off = ctx.require(channelPlugin).onHeartbeat(beat => {
   *   socket.send(encode(notification("game", "heartbeat", beat)));
   * });
   * off();
   * ```
   */
  onHeartbeat(fn: HeartbeatListener): () => void;
};

/**
 * The registry members the channel uses.
 */
export type ChannelRegistry = Pick<RegistryApi, "source" | "command" | "clock">;

/**
 * Domain dependencies of the channel modules (unit tests pass fakes).
 */
export type ChannelDeps = {
  readonly config: Readonly<ChannelConfig>;
  readonly state: ChannelState;
  readonly log: Log.LogApi;
  readonly registry: ChannelRegistry;
};

/**
 * Domain context of the channel: the kernel context is assignable to it.
 */
export type ChannelCtx = {
  readonly config: Readonly<ChannelConfig>;
  state: ChannelState;
  readonly log: Log.LogApi;
  readonly require: Require;
};
