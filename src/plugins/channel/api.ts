/**
 * @file channel plugin — api factory: read, watch (delegated to watch.ts), run in a microtask,
 * status, heartbeat, onHeartbeat.
 */
import type { Json, LinkStatus, RunResult } from "../registry/protocol";
import { commandOf, depsOf, rawOf, sourceOf } from "./deps";
import { beatOf } from "./heartbeat";
import type { ChannelApi, ChannelCtx, ChannelDeps, HeartbeatListener } from "./types";
import { openWatch } from "./watch";

/**
 * Builds the channel api over domain deps (unit tests pass a fake registry).
 *
 * @param deps - Domain deps of the channel.
 * @returns The channel api.
 * @example
 * ```ts
 * const channel = buildChannelApi(deps);
 * await channel.read("game.history", { last: 1 }); // [{ path: "home", outcome: "play", … }]
 * ```
 */
export function buildChannelApi(deps: ChannelDeps): ChannelApi {
  const { registry, state } = deps;

  return {
    /**
     * Reads a source now and returns a settled promise; never throws synchronously.
     *
     * @param id - The source id.
     * @param input - The source input.
     * @returns The value; rejects -32601 for an unknown id or with the entry's error.
     * @example
     * ```ts
     * await channel.read("game.history", { last: 1 }); // [{ path: "home", outcome: "play", … }]
     * ```
     */
    read: async (id: string, input?: Json): Promise<Json> =>
      sourceOf(registry, id).read(rawOf(input)),
    /**
     * Delivers the current value before it returns, then every change the door reports.
     *
     * @param id - The source id.
     * @param input - The source input; `undefined` means none.
     * @param onValue - Called with each value.
     * @returns An idempotent stop.
     * @example
     * ```ts
     * const stop = channel.watch("game.position", undefined, p => show(p)); // show() runs once now
     * stop();
     * ```
     */
    watch: (id: string, input: Json | undefined, onValue: (value: Json) => void): (() => void) =>
      openWatch(deps, id, input, onValue),
    /**
     * Runs a command in a microtask, off the game's frame loop.
     *
     * @param id - The command id.
     * @param input - The command input.
     * @returns The run result; rejects -32601 for an unknown id or with the command's error.
     * @example
     * ```ts
     * (await channel.run("game.step", { frames: 1 })).state; // { path: "board/awaitIntent", frame: 1841, tainted: false }
     * ```
     */
    run: (id: string, input?: Json): Promise<RunResult> =>
      new Promise<RunResult>((resolve, reject) => {
        queueMicrotask(() => {
          try {
            commandOf(registry, id).run(rawOf(input)).then(resolve, reject);
          } catch (error) {
            reject(error);
          }
        });
      }),
    /**
     * The in-process link: the game itself, live or paused.
     *
     * @returns `{ kind: "live" | "paused", frame }`.
     * @example
     * ```ts
     * channel.status(); // { kind: "live", frame: 1840 }
     * ```
     */
    status: (): LinkStatus => {
      const { frame, paused } = registry.clock();
      return paused ? { kind: "paused", frame } : { kind: "live", frame };
    },
    /**
     * A fresh frozen beat now.
     *
     * @returns `{ frame, paused, at }`.
     * @example
     * ```ts
     * channel.heartbeat(); // { frame: 1840, paused: true, at: 1790000000000 }
     * ```
     */
    heartbeat: () => beatOf(registry, Date.now()),
    /**
     * Adds a listener called on every interval tick, in subscription order.
     *
     * @param fn - The listener.
     * @returns An idempotent remover.
     * @example
     * ```ts
     * const off = channel.onHeartbeat(beat => send("heartbeat", beat));
     * off();
     * ```
     */
    onHeartbeat: (fn: HeartbeatListener): (() => void) => {
      /**
       * Wraps the caller's function, so each subscription has its own remover.
       *
       * @param beat - The beat of this tick.
       * @example
       * ```ts
       * listener({ frame: 1840, paused: false, at: 1790000000000 }); // fn(beat)
       * ```
       */
      const listener: HeartbeatListener = beat => {
        fn(beat);
      };
      state.listeners.add(listener);
      return () => {
        state.listeners.delete(listener);
      };
    }
  };
}

/**
 * Creates the channel api over `ctx.require(registryPlugin)`.
 *
 * @param ctx - Domain context of the channel.
 * @returns The channel api.
 * @example
 * ```ts
 * (await createChannelApi(ctx).run("game.step", { frames: 1 })).state; // { path, frame: 1841, tainted }
 * ```
 */
export function createChannelApi(ctx: ChannelCtx): ChannelApi {
  return buildChannelApi(depsOf(ctx));
}
