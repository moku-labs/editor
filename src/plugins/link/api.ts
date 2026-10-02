/**
 * @file link plugin — api factory: the remote EditorChannel plus sessions, manifest, boot, retry
 * and the files client, composed from the sub-modules.
 */
import { createFilesClient } from "./files/client";
import { gameRequest } from "./rpc/calls";
import { expectShape, readRunResult } from "./rpc/shapes";
import { chooseSession } from "./sessions/choose";
import { addManifestListener, currentManifest } from "./sessions/manifest";
import { retryNow } from "./socket/connect";
import { addWatch } from "./subscriptions/watch";
import type { LinkApi, LinkCtx } from "./types";

/**
 * Creates the link api.
 *
 * @param ctx - Domain context of link.
 * @returns The LinkApi (`app.link`).
 * @example
 * ```ts
 * const link = createLinkApi(ctx);
 * link.watch("game.history", { last: 20 }, history => draw(history));
 * ```
 */
export function createLinkApi(ctx: LinkCtx): LinkApi {
  const { state } = ctx;

  return {
    /**
     * Reads a source of the chosen game. Rejects -32003 `no_session` (not retryable) at once
     * when no game is connected.
     *
     * @param id - Source id.
     * @param input - Source input, omitted when undefined.
     * @returns The value.
     * @example
     * ```ts
     * const graph = await app.link.read("game.graph");
     * ```
     */
    read(id, input) {
      return gameRequest(ctx, "read", input === undefined ? { id } : { id, input });
    },

    /**
     * Watches a source; accepted in every state, also while disconnected, and sent again after
     * every reconnect or session change. The first value is the agent's immediate read.
     *
     * @param id - Source id.
     * @param input - Source input.
     * @param onValue - Called with every value.
     * @returns Unsubscribe.
     * @example
     * ```ts
     * const stop = app.link.watch("game.history", { last: 20 }, history => draw(history));
     * ```
     */
    watch(id, input, onValue) {
      return addWatch(ctx, id, input, onValue);
    },

    /**
     * Runs a command of the chosen game. `editor.series` waits its duration on top (R1).
     *
     * @param id - Command id.
     * @param input - Command input, omitted when undefined.
     * @returns The checked RunResult.
     * @example
     * ```ts
     * const ran = await app.link.run("game.step", { frames: 1 }); // ran.state.frame === 1841
     * ```
     */
    async run(id, input) {
      const result = await gameRequest(ctx, "run", input === undefined ? { id } : { id, input });
      return expectShape(result, readRunResult, "run");
    },

    /**
     * The current link status (a copy).
     *
     * @returns connecting, live, paused, silent, lost or empty.
     * @example
     * ```ts
     * app.link.status(); // { kind: "live", frame: 1840 }
     * ```
     */
    status() {
      return { ...state.status };
    },

    /**
     * The cached manifest of the chosen session.
     *
     * @returns The manifest, undefined before one is attached.
     * @example
     * ```ts
     * app.link.manifest()?.commands;
     * ```
     */
    manifest() {
      return currentManifest(state);
    },

    /**
     * Listens to the manifest: called at once when one exists, then on every attach and with
     * undefined when the session is lost.
     *
     * @param fn - The listener.
     * @returns Unsubscribe.
     * @example
     * ```ts
     * app.link.onManifest(m => palette.index(m?.commands ?? []));
     * ```
     */
    onManifest(fn) {
      return addManifestListener(ctx, fn);
    },

    /**
     * The last session list from the hub (empty while disconnected).
     *
     * @returns A copy of the list.
     * @example
     * ```ts
     * app.link.sessions().map(session => session.id);
     * ```
     */
    sessions() {
      return [...state.sessions];
    },

    /**
     * The chosen session id.
     *
     * @returns The id, undefined when none is chosen.
     * @example
     * ```ts
     * app.link.session(); // "s-7f3a"
     * ```
     */
    session() {
      return state.chosen;
    },

    /**
     * Makes a session the sticky choice and attaches it.
     *
     * @param session - An id from `sessions()`.
     * @returns Its manifest; rejects -32003 `choose_session` for an id that is not open.
     * @example
     * ```ts
     * await app.link.choose("s-7f3a");
     * ```
     */
    choose(session) {
      return chooseSession(ctx, session);
    },

    /**
     * "Retry now": reconnects, re-picks a session or re-reads the boot tag; no-op unless lost.
     *
     * @example
     * ```ts
     * app.link.retry();
     * ```
     */
    retry() {
      retryNow(ctx);
    },

    /**
     * The boot data of the tools page; its token is never to be logged.
     *
     * @returns The ToolsBoot, undefined when the tag was missing or invalid.
     * @example
     * ```ts
     * app.link.boot()?.gameUrl; // "/"
     * ```
     */
    boot() {
      return state.boot;
    },

    files: createFilesClient(ctx)
  };
}
