/**
 * @file link plugin — the values the server publishes to the tools pages (spec 11 § 5.2). The hub
 * keeps the last value per publish method and replays it on every socket open. connect's two,
 * `editor.devices` and `editor.deviceTelemetry`, are checked whole with the `connect/protocol`
 * guards and held here; the other four (`engine`, `project`, `hotReload`, `selection`) are read
 * from the fields link already keeps for them. Every new value goes to the onPublished listeners
 * of its method; a replay of an equal value goes to nobody. link reads no device in them: it is
 * transport, the policy is activeSource's.
 */
import { readDirectory, readTelemetry } from "../../connect/protocol";
import type { Json, PublishMethod, PublishParams } from "../../registry/protocol";
import { parseSelectionInfo } from "../../registry/protocol";
import type { HeldMethod, LinkCtx, LinkState } from "../types";

/**
 * Reads a published value of one method; undefined for another shape.
 */
type Reader<M extends PublishMethod> = (value: Json | undefined) => PublishParams[M] | undefined;

/**
 * The value `published` answers for one method, read from the state.
 */
type View<M extends PublishMethod> = (state: LinkState) => PublishParams[M] | undefined;

/**
 * The guard of each held method.
 */
const READERS: { readonly [M in HeldMethod]: Reader<M> } = {
  devices: readDirectory,
  deviceTelemetry: readTelemetry
};

/**
 * Where `published` reads each method: connect's from `published`, the rest from the fields of
 * `engine()`, `project()`, `hotReload()` and `selection()` (a copy, like `selection()`).
 */
const VIEWS: { readonly [M in PublishMethod]: View<M> } = {
  hotReload: state => state.hotReload,
  selection: state =>
    state.selection === undefined ? undefined : parseSelectionInfo(state.selection),
  project: state => state.project,
  engine: state => state.engine,
  devices: state => state.published.devices,
  deviceTelemetry: state => state.published.deviceTelemetry
};

/**
 * Freezes a fresh parsed value and every object and array inside it.
 *
 * @param value - A value nobody else holds yet.
 * @returns The same value, frozen all the way down.
 * @example
 * ```ts
 * const state = freezeDeep({ state: "on", revision: "r1", defs: { "flow:board": ["flows/board.ts"] }, uses: {}, broken: {} });
 * Object.isFrozen(state.defs["flow:board"]); // true
 * ```
 */
export function freezeDeep<T>(value: T): T {
  if (typeof value !== "object" || value === null) return value;

  for (const child of Object.values(value)) freezeDeep(child);
  return Object.freeze(value);
}

/**
 * True when two published values say the same: equal as JSON. The hub replays the very value it
 * keeps, so a replay is equal member for member and in the same order.
 *
 * @param held - The value link holds.
 * @param next - The value that just arrived.
 * @returns Whether `next` is `held` again.
 * @example
 * ```ts
 * isSameValue({ hmr: true, owner: "bin" }, { hmr: true, owner: "bin" }); // true
 * isSameValue({ v: 1, at: 1 }, { v: 1, at: 2 }); // false
 * ```
 */
export function isSameValue<T>(held: T, next: T): boolean {
  return JSON.stringify(held) === JSON.stringify(next);
}

/**
 * The value `published(method)` answers.
 *
 * @param state - Link state.
 * @param method - A publish method.
 * @returns The held value; undefined before the first.
 */
export function readPublished<M extends PublishMethod>(
  state: LinkState,
  method: M
): PublishParams[M] | undefined {
  const view: View<M> = VIEWS[method];
  return view(state);
}

/**
 * Gives a new value to every onPublished listener of its method, in subscription order. A
 * listener that throws is logged as `link:published-listener-failed` and the others still run.
 *
 * @param ctx - Domain context of link.
 * @param method - The publish method.
 * @param value - The new value, frozen.
 */
export function notifyPublished<M extends PublishMethod>(
  ctx: LinkCtx,
  method: M,
  value: PublishParams[M]
): void {
  const listeners: ReadonlySet<(value: PublishParams[M]) => void> =
    ctx.state.publishedListeners[method];

  for (const listener of listeners) {
    try {
      listener(value);
    } catch (error) {
      ctx.log.error(
        "link:published-listener-failed",
        { method },
        error instanceof Error ? error : undefined
      );
    }
  }
}

/**
 * Handles the params of an `editor.devices` or `editor.deviceTelemetry` notification. A value
 * its guard refuses is the warning `link:bad-published { method }` and keeps the held one; the
 * held value again (the replay after a reconnect) calls nothing; any other value is held frozen
 * and given to the listeners.
 *
 * @param ctx - Domain context of link.
 * @param method - "devices" or "deviceTelemetry".
 * @param params - The notification params.
 */
export function onPublishedNote<M extends HeldMethod>(
  ctx: LinkCtx,
  method: M,
  params: Json | undefined
): void {
  const read: Reader<M> = READERS[method];
  const next = read(params);
  if (next === undefined) {
    ctx.log.warn("link:bad-published", { method });
    return;
  }

  const { published } = ctx.state;
  const held: PublishParams[M] | undefined = published[method];
  if (held !== undefined && isSameValue(held, next)) return;

  const frozen = freezeDeep(next);
  published[method] = frozen;
  notifyPublished(ctx, method, frozen);
}

/**
 * Adds an onPublished listener of one method; it is not called at once.
 *
 * @param ctx - Domain context of link.
 * @param method - The publish method.
 * @param listener - Called with each new value.
 * @returns An idempotent unsubscribe.
 */
export function addPublishedListener<M extends PublishMethod>(
  ctx: LinkCtx,
  method: M,
  listener: (value: PublishParams[M]) => void
): () => void {
  const listeners: Set<(value: PublishParams[M]) => void> = ctx.state.publishedListeners[method];
  /**
   * A wrapper of `listener`, so the same function added twice gets two independent entries.
   *
   * @param value - The value to pass on.
   */
  const entry = (value: PublishParams[M]): void => {
    listener(value);
  };

  listeners.add(entry);
  return () => {
    listeners.delete(entry);
  };
}
