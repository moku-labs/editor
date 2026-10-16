/**
 * @file link plugin — the computer's engine fingerprint on the tools page. The hub publishes the
 * `EngineInfo` of the project's installed `@moku-labs/game` as the editor notification
 * `editor.engine` after each tools socket opens and on change (spec 01 C7). link keeps the whole
 * info across reconnects (`published("engine")` answers it); the replay of an equal info calls no
 * listener. The id "unknown" (the hub found no installed game) is held as unknown: `engine()`
 * answers undefined for it, so a STALE mark never fires on it, and a change from a known id to it
 * calls the listeners with `undefined` (the top bar drops the old id).
 */
import type { Json, PublishParams } from "../../registry/protocol";
import { objectOf, textOf } from "../rpc/shapes";
import type { LinkCtx } from "../types";
import { freezeDeep, isSameValue, notifyPublished } from "./published";

/**
 * The engine info of the wire (`EngineInfo` of hub/protocol).
 */
type EngineInfo = PublishParams["engine"];

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
 * @param engine - The id; undefined for "unknown".
 */
function callListener(
  ctx: LinkCtx,
  listener: (engine: string | undefined) => void,
  engine: string | undefined
): void {
  try {
    listener(engine);
  } catch (error) {
    ctx.log.error("link:engine-listener-failed", {}, error instanceof Error ? error : undefined);
  }
}

/**
 * Reads the params of an `editor.engine` notification as a whole EngineInfo: the id `readEngine`
 * accepts, a `version` and a `dist`. A `patch` is kept only as `{ file, hash }`; a malformed one is
 * left out (the info stays).
 *
 * @param params - The notification params.
 * @returns The info, or undefined for a malformed value.
 * @example
 * ```ts
 * readEngineInfo({ id: "0.14.13+1ab7f2", version: "0.14.13", dist: "1ab7f2c0" }); // the same info
 * readEngineInfo({ id: "0.14.13+1ab7f2" }); // undefined: no version, no dist
 * ```
 */
function readEngineInfo(params: Json | undefined): EngineInfo | undefined {
  const id = readEngine(params);
  const object = objectOf(params);
  const version = object && textOf(object, "version");
  const dist = object && textOf(object, "dist");
  if (id === undefined || version === undefined || dist === undefined) return undefined;

  const info = { id: id ?? UNKNOWN_ENGINE, version, dist };
  const patch = objectOf(object?.patch);
  const file = patch && textOf(patch, "file");
  const hash = patch && textOf(patch, "hash");
  return file === undefined || hash === undefined ? info : { ...info, patch: { file, hash } };
}

/**
 * The id `engine()` answers for a held info: undefined for none and for "unknown".
 *
 * @param info - The held info.
 * @returns The id, or undefined.
 * @example
 * ```ts
 * engineIdOf({ id: "unknown", version: "", dist: "" }); // undefined
 * ```
 */
export function engineIdOf(info: EngineInfo | undefined): string | undefined {
  return info === undefined || info.id === UNKNOWN_ENGINE ? undefined : info.id;
}

/**
 * Handles the params of an `editor.engine` notification. A malformed value is the warning
 * `link:bad-engine` and keeps the held info; an equal info again (the replay after a reconnect)
 * calls nothing; a new info is held frozen and given to the onPublished listeners of `engine`.
 * When its id differs from the held one, every engine listener gets it in subscription order: a
 * change to "unknown" gives them `undefined`, and "unknown" before any id calls none of them.
 *
 * @param ctx - Domain context of link.
 * @param params - The notification params.
 */
export function onEngineNote(ctx: LinkCtx, params: Json | undefined): void {
  const next = readEngineInfo(params);
  if (next === undefined) {
    ctx.log.warn("link:bad-engine", {});
    return;
  }

  const { state } = ctx;
  const held = state.engine;
  if (held !== undefined && isSameValue(held, next)) return;

  const info = freezeDeep(next);
  state.engine = info;
  notifyPublished(ctx, "engine", info);

  const id = engineIdOf(info);
  if (id === engineIdOf(held)) return;
  for (const listener of state.engineListeners) callListener(ctx, listener, id);
}

/**
 * Adds an engine listener; it is called at once when the id is known.
 *
 * @param ctx - Domain context of link.
 * @param listener - Called with each new id; with undefined when it changes to "unknown".
 * @returns An idempotent unsubscribe.
 */
export function addEngineListener(
  ctx: LinkCtx,
  listener: (engine: string | undefined) => void
): () => void {
  const { state } = ctx;
  /**
   * A wrapper of `listener`, so the same function added twice gets two independent entries.
   *
   * @param engine - The id to pass on; undefined for "unknown".
   */
  const entry = (engine: string | undefined): void => {
    listener(engine);
  };

  state.engineListeners.add(entry);
  const id = engineIdOf(state.engine);
  if (id !== undefined) callListener(ctx, entry, id);
  return () => {
    state.engineListeners.delete(entry);
  };
}
