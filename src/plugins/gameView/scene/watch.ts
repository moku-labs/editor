/**
 * @file gameView plugin — the scene inputs while Game is shown (R6): watches of game.ui,
 * game.entities and game.projections, one buildScene per animation frame for a burst of values,
 * and the calibration (one game.rect read per session and after a device change). No timer reads
 * a frame source.
 */
import { linkPlugin } from "../../link";
import type { PageRect } from "../../panels/shared/scene";
import { buildScene, calibrationFrom, calibrationTarget } from "../../panels/shared/scene";
import type { Json, LinkStatus } from "../../registry/protocol";
import { isObject } from "../capture/shot";
import { messageOf } from "../report";
import { notify } from "../state";
import type { GameViewCtx, GameViewState } from "../types";

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

/**
 * The frame a link status reports, or a fallback.
 *
 * @param status - The link status.
 * @param fallback - Used while connecting or empty.
 * @returns The frame.
 * @example
 * ```ts
 * frameOf({ kind: "paused", frame: 2000 }, 0); // 2000
 * ```
 */
export function frameOf(status: LinkStatus, fallback: number): number {
  if (status.kind === "live" || status.kind === "paused") return status.frame;
  if (status.kind === "silent" || status.kind === "lost") return status.lastFrame;
  return fallback;
}

/**
 * Reads a game.rect value: `{ x, y, w, h }` in page px, or undefined (null on the wire).
 *
 * @param value - The game.rect value.
 * @returns The rect, or undefined.
 * @example
 * ```ts
 * pageRectOf({ x: 0, y: 0, w: 1080, h: 1440 }); // { x: 0, y: 0, w: 1080, h: 1440 }
 * ```
 */
export function pageRectOf(value: Json): PageRect | undefined {
  if (!isObject(value)) return undefined;
  const { x, y, w, h } = value;
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof w !== "number" ||
    typeof h !== "number"
  ) {
    return undefined;
  }
  return { x, y, w, h };
}

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
 * Builds the scene from the stored sources (all three needed); a shape error keeps the last
 * scene and warns.
 *
 * @param ctx - Domain context of gameView.
 * @param frame - The frame of the values.
 */
export function rebuildScene(ctx: GameViewCtx, frame: number): void {
  const { state } = ctx;
  const { ui, entities, projections } = state.sources;
  if (ui === undefined || entities === undefined || projections === undefined) return;

  const built = buildScene({ ui, entities, projections, frame, calibration: state.calibration });
  if ("error" in built) {
    ctx.log.warn("gameView: scene shape", built);
    return;
  }
  state.scene = built;
  notify(state);
}

/**
 * Calibrates from the stored game.ui: the first keyed element's drawn rect and its game.rect
 * (one read). Marks the calibration read first, so a burst asks once. Rebuilds the scene while
 * watching.
 *
 * @param ctx - Domain context of gameView.
 * @returns Resolves when the calibration is known (never rejects).
 */
export async function calibrate(ctx: GameViewCtx): Promise<void> {
  const { state } = ctx;
  const { ui } = state.sources;
  if (ui === undefined) return;

  state.calibrationRead = true;
  const target = calibrationTarget(ui);
  if (target === undefined) {
    state.calibration = undefined;
    notify(state);
    return;
  }

  const link = ctx.require(linkPlugin);
  try {
    const page = pageRectOf(await link.read("game.rect", { key: target.key }));
    state.calibration = page === undefined ? undefined : calibrationFrom(page, target.drawn);
  } catch (error) {
    state.calibration = undefined;
    ctx.log.warn("gameView: calibration failed", { key: target.key, message: messageOf(error) });
  }
  if (state.watching.length > 0) rebuildScene(ctx, state.scene?.frame ?? frameOf(link.status(), 0));
  notify(state);
}

/**
 * Forgets the calibration of the old device and calibrates again while watching (device change).
 *
 * @param ctx - Domain context of gameView.
 */
export function recalibrate(ctx: GameViewCtx): void {
  ctx.state.calibrationRead = false;
  if (ctx.state.watching.length > 0) void calibrate(ctx);
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
    onSceneValue(ctx, session);
  } catch (error) {
    ctx.log.warn("gameView: projections read failed", { message: messageOf(error) });
  } finally {
    session.refreshing = false;
  }
}

/**
 * One watched value: stored, calibration asked once, one rebuild on the next animation frame.
 *
 * @param ctx - Domain context of gameView.
 * @param session - The watch session.
 */
function onSceneValue(ctx: GameViewCtx, session: WatchSession): void {
  if (!ctx.state.calibrationRead && ctx.state.sources.ui !== undefined) void calibrate(ctx);
  if (session.scheduled) return;

  session.scheduled = true;
  nextFrame(() => {
    session.scheduled = false;
    if (!session.stopped) rebuildScene(ctx, session.frame);
  });
}

/**
 * Watches the three scene sources while Game is shown (a second call does nothing). The
 * unwatch functions go into `state.watching`.
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
        onSceneValue(ctx, session);
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
