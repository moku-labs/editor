/**
 * @file link plugin — the computer's engine fingerprint on the tools page. The hub publishes the
 * `EngineInfo` of the project's installed `@moku-labs/game` as the editor notification
 * `editor.engine` after each tools socket opens and on change (spec 01 C7). link keeps the id
 * across reconnects; the replay of the same id calls no listener. The id "unknown" (the hub found
 * no installed game) is held as unknown: `engine()` answers undefined for it, so a STALE mark
 * never fires on it.
 */
import type { Json } from "../../registry/protocol";
import { objectOf, textOf } from "../rpc/shapes";
import type { LinkCtx } from "../types";

/**
 * The id the hub sends when it found no installed game under the root.
 */
const UNKNOWN_ENGINE = "unknown";

/**
 * Reads the params of an `editor.engine` notification: an `EngineInfo` object with a non-empty
 * string `id`.
 *
 * @param params - The notification params.
 * @returns The id; null for "unknown" (held as unknown); undefined for a malformed value.
 * @example
 * ```ts
 * readEngine({ id: "0.14.13+1ab7f2", version: "0.14.13", dist: "1ab7f2…" }); // "0.14.13+1ab7f2"
 * ```
 */
export function readEngine(params: Json | undefined): string | null | undefined {
  const object = objectOf(params);
  const id = object && textOf(object, "id");
  if (id === undefined || id === "") return undefined;

  // eslint-disable-next-line unicorn/no-null -- null is the spec's "held as unknown" marker
  return id === UNKNOWN_ENGINE ? null : id;
}

/**
 * Calls one engine listener; a throw is logged as `link:engine-listener-failed`, so the next
 * listener still runs.
 *
 * @param ctx - Domain context of link.
 * @param listener - The listener.
 * @param engine - The id.
 */
function callListener(ctx: LinkCtx, listener: (engine: string) => void, engine: string): void {
  try {
    listener(engine);
  } catch (error) {
    ctx.log.error("link:engine-listener-failed", {}, error instanceof Error ? error : undefined);
  }
}

/**
 * Handles the params of an `editor.engine` notification. A malformed value is the warning
 * `link:bad-engine` and keeps the held id; the held id again (the replay after a reconnect) calls
 * nothing; a new id is stored and given to every listener in subscription order. A change to
 * "unknown" clears the id and calls no listener (a listener takes an id).
 *
 * @param ctx - Domain context of link.
 * @param params - The notification params.
 */
export function onEngineNote(ctx: LinkCtx, params: Json | undefined): void {
  const read = readEngine(params);
  if (read === undefined) {
    ctx.log.warn("link:bad-engine", {});
    return;
  }

  const { state } = ctx;
  const next = read ?? undefined;
  if (next === state.engine) return;

  state.engine = next;
  if (next === undefined) return;
  for (const listener of state.engineListeners) callListener(ctx, listener, next);
}

/**
 * Adds an engine listener; it is called at once when the id is known.
 *
 * @param ctx - Domain context of link.
 * @param listener - Called with each new id.
 * @returns An idempotent unsubscribe.
 */
export function addEngineListener(ctx: LinkCtx, listener: (engine: string) => void): () => void {
  const { state } = ctx;
  /**
   * A wrapper of `listener`, so the same function added twice gets two independent entries.
   *
   * @param engine - The id to pass on.
   */
  const entry = (engine: string): void => {
    listener(engine);
  };

  state.engineListeners.add(entry);
  if (state.engine !== undefined) callListener(ctx, entry, state.engine);
  return () => {
    state.engineListeners.delete(entry);
  };
}
