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
 * The channel api: the in-process EditorChannel plus the heartbeat.
 *
 * @example
 * ```ts
 * const stop = editor.channel.watch("game.position", undefined, position => show(position));
 * ```
 */
export type ChannelApi = EditorChannel & {
  /** A fresh frozen beat now. */
  heartbeat(): Heartbeat;
  /** Adds a listener called on every interval tick; returns an idempotent remover. */
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
