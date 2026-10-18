/**
 * @file channel plugin — type definitions: config, state, api, the registry slice it needs and
 * the domain contexts.
 */
import type { Log } from "@moku-labs/common/browser";
import type { Require } from "../../config";
import type { CommandVia, EditorChannel, Heartbeat, Json, RunResult } from "../registry/protocol";
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
 * the game page plus the heartbeat. `read`, `watch` and `status` are documented on EditorChannel;
 * `run` takes who runs the command as well (still assignable to EditorChannel). Here `watch`
 * delivers the current value before it returns, and an unknown id, an invalid input or a throwing
 * first `onValue` throws synchronously and opens no watch.
 */
export type ChannelApi = Omit<EditorChannel, "run"> & {
  /**
   * Runs a command in a microtask, off the game's frame loop. `via` names who runs it for the
   * registry's `registry:command` event: the overlay's Game tab passes `"overlay"`; the bridge
   * passes the hub's origin, `"tools"` (the tools page), `"mcp"` (an agent) or `"bridge"` (a hub
   * that does not say); absent, the registry records `"local"`. `client` is the agent's MCP client
   * name, which the bridge passes with `"mcp"` only; the command entry gets it (the recorder's
   * `editor.record` names the agent with it).
   *
   * @param id - The command id, e.g. "game.step".
   * @param input - The command input; omit it for a command without input.
   * @param via - Who runs it; omit it for an in-process caller.
   * @param client - The MCP client's name, with `via: "mcp"` only.
   * @returns A promise of the command's value and where the game stands after it.
   * @example
   * ```ts
   * // The bridge runs a hub `run` that an agent named "Claude" sent through MCP.
   * (await ctx.require(channelPlugin).run("editor.record", { on: true }, "mcp", "Claude")).value;
   * // { on: true, file: "perf-20261016-1201-sm-a266b.jsonl", startedBy: { by: "agent", name: "Claude" }, marked: false }
   * ```
   */
  run(id: string, input?: Json, via?: CommandVia, client?: string): Promise<RunResult>;
  /**
   * A fresh frozen beat now, from the registry clock. In Chromium it also carries the page heap
   * from `performance.memory`, in MB rounded to 0.1; elsewhere `heap` is absent.
   *
   * @returns `{ frame, paused, at }` plus `heap` when present, `at` in epoch ms.
   * @example
   * ```ts
   * // The bridge sends a beat right after the socket opens.
   * ctx.require(channelPlugin).heartbeat(); // { frame: 1840, paused: false, at: 1790000000000 } in Bun
   * // In Chromium: { frame: 1840, paused: false, at: 1790000000000, heap: { usedMb: 12.8, limitMb: 4095.8 } }
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
