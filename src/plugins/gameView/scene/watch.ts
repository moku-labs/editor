/**
 * @file gameView plugin — the scene inputs while Game is shown (R6) or Reference mode is on:
 * watches of game.ui, game.entities and game.projections, one buildScene per animation frame for
 * a burst of values, and the calibration (scene/calibrate) told of every ui snapshot. No timer
 * reads a frame source.
 */
import { linkPlugin } from "../../link";
import type { Json } from "../../registry/protocol";
import { isObject } from "../capture/shot";
import { messageOf } from "../report";
import type { GameViewCtx, GameViewState } from "../types";
import { calibrate, onUiSnapshot } from "./calibrate";
import { frameOf, rebuildScene } from "./rebuild";

/**
 * A scene source and the state.sources key it fills.
 */
type SceneSource = readonly [key: keyof GameViewState["sources"], id: string];

/**
 * The three scene sources, in watch order.
 */
export const SCENE_SOURCES: readonly SceneSource[] = [
  ["ui", "game.ui"],
  ["entities", "game.entities"],
  ["projections", "game.projections"]
];

/**
 * What one watch session shares between its three callbacks.
 */
type WatchSession = { frame: number; scheduled: boolean; stopped: boolean; refreshing: boolean };

/** One frame at 60 fps: the timeout that stands in for requestAnimationFrame where it does not exist. */
const FALLBACK_FRAME_MS = 16;

/**
 * Runs a callback on the next animation frame (a 16 ms timeout where rAF does not exist).
 *
 * @param callback - What to run.
 */
function nextFrame(callback: () => void): void {
  if (typeof globalThis.requestAnimationFrame === "function") {
    globalThis.requestAnimationFrame(() => callback());
  } else {
    setTimeout(callback, FALLBACK_FRAME_MS);
  }
}

/**
 * Tells whether the entities name a projection entity the projections map does not list. The game
 * declares `game.projections` a commit source, but a view mounts its projections on a frame after
 * the commit (merge-game's board after Play), so the watch can hold the map of the screen before.
 *
 * @param entities - The game.entities value.
 * @param projections - The game.projections value.
 * @returns True when a projection entity has no key in the map.
 * @example
 * ```ts
 * projectionsBehind([{ id: 7, owner: { kind: "projection", name: "board.cells" } }], {}); // true
 * ```
 */
export function projectionsBehind(entities: Json, projections: Json | undefined): boolean {
  if (!Array.isArray(entities)) return false;
  const known = new Set<number>();
  if (isObject(projections)) {
    for (const keys of Object.values(projections)) {
      if (!isObject(keys)) continue;
      for (const id of Object.values(keys)) if (typeof id === "number") known.add(id);
    }
  }
  return entities.some(entity => {
    if (!isObject(entity) || !isObject(entity.owner)) return false;
    return (
      entity.owner.kind === "projection" && typeof entity.id === "number" && !known.has(entity.id)
    );
  });
}

/**
 * Reads game.projections once when the entities are ahead of the watched map (see
 * `projectionsBehind`); one read at a time, the next entities value asks again.
 *
 * @param ctx - Domain context of gameView.
 * @param session - The watch session.
 */
async function refreshProjections(ctx: GameViewCtx, session: WatchSession): Promise<void> {
  const { sources } = ctx.state;
  // Before the first map arrives the watch itself delivers it.
  if (session.refreshing || sources.entities === undefined || sources.projections === undefined) {
    return;
  }
  if (!projectionsBehind(sources.entities, sources.projections)) return;

  session.refreshing = true;
  try {
    const value = await ctx.require(linkPlugin).read("game.projections");
    if (session.stopped) return;
    sources.projections = value;
    onSceneValue(ctx, session, "projections");
  } catch (error) {
    ctx.log.warn("gameView: projections read failed", { message: messageOf(error) });
  } finally {
    session.refreshing = false;
  }
}

/**
 * One watched value: a ui snapshot goes to the calibration; any other value calibrates only
 * when nothing was read and no device change waits for a snapshot. One rebuild on the next
 * animation frame.
 *
 * @param ctx - Domain context of gameView.
 * @param session - The watch session.
 * @param key - The source the value came from.
 */
function onSceneValue(
  ctx: GameViewCtx,
  session: WatchSession,
  key: keyof GameViewState["sources"]
): void {
  const { state } = ctx;
  if (key === "ui") {
    onUiSnapshot(ctx);
  } else if (
    !state.calibrationRead &&
    !state.calibrationRun.waiting &&
    state.sources.ui !== undefined
  ) {
    void calibrate(ctx);
  }
  if (session.scheduled) return;

  session.scheduled = true;
  nextFrame(() => {
    session.scheduled = false;
    if (!session.stopped) rebuildScene(ctx, session.frame);
  });
}

/**
 * Watches the three scene sources while Game is shown or Reference mode is on (a second call
 * does nothing). The unwatch functions go into `state.watching`.
 *
 * @param ctx - Domain context of gameView.
 */
export function startSceneWatches(ctx: GameViewCtx): void {
  const { state } = ctx;
  if (state.watching.length > 0) return;

  const link = ctx.require(linkPlugin);
  const session: WatchSession = {
    frame: 0,
    scheduled: false,
    stopped: false,
    refreshing: false
  };
  for (const [key, id] of SCENE_SOURCES) {
    state.watching.push(
      link.watch(id, undefined, value => {
        state.sources[key] = value;
        session.frame = frameOf(link.status(), session.frame);
        onSceneValue(ctx, session, key);
        if (key === "entities") void refreshProjections(ctx, session);
      })
    );
  }
  state.watching.push(() => {
    session.stopped = true;
  });
}

/**
 * Stops the scene watches (idempotent); a pending rebuild is dropped.
 *
 * @param ctx - Domain context of gameView.
 */
export function stopSceneWatches(ctx: Pick<GameViewCtx, "state">): void {
  for (const unwatch of ctx.state.watching.splice(0)) unwatch();
}
