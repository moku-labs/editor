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
 */
export function buildChannelApi(deps: ChannelDeps): ChannelApi {
  const { registry, state } = deps;

  return {
    read: async (id: string, input?: Json): Promise<Json> =>
      sourceOf(registry, id).read(rawOf(input)),

    watch: (id: string, input: Json | undefined, onValue: (value: Json) => void): (() => void) =>
      openWatch(deps, id, input, onValue),

    // Runs in a microtask, off the game's frame loop.
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

    // The in-process link is the game itself: live or paused.
    status: (): LinkStatus => {
      const { frame, paused } = registry.clock();
      return paused ? { kind: "paused", frame } : { kind: "live", frame };
    },

    heartbeat: () => beatOf(registry, Date.now()),

    onHeartbeat: (fn: HeartbeatListener): (() => void) => {
      // A wrapper per subscription, so each one has its own remover.
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
 */
export function createChannelApi(ctx: ChannelCtx): ChannelApi {
  return buildChannelApi(depsOf(ctx));
}
