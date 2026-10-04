/**
 * @file gameView plugin — the calibration of the scene (finding 3): which keyed ui node gets
 * its page rect read (a full-screen keyed node first, else the shared `calibrationTarget`), from
 * the source the manifest lists (`game.locate` on game 0.4, `game.rect` on game 0.1, none: no
 * read), when to read again (another target, drawn rect or root rect; the first ui snapshot
 * after a device change) and the discard of a read overtaken by a ui snapshot with another
 * target (one retry).
 */
import { linkPlugin } from "../../link";
import type { PageRect } from "../../panels/shared/scene";
import {
  calibrationFrom,
  calibrationTarget,
  drawnRect,
  rectSourceOf
} from "../../panels/shared/scene";
import { isShapePath, readUi, uiRoots, uiVisits } from "../../panels/shared/scene/wire";
import type { Json } from "../../registry/protocol";
import { isObject } from "../capture/shot";
import { messageOf } from "../report";
import { notify } from "../state";
import type { CalibrationTarget, GameViewCtx, GameViewState } from "../types";
import { frameOf, rebuildScene } from "./rebuild";

/**
 * Reads a page rect value of `game.locate` or `game.rect`: `{ x, y, w, h }` in page px, or
 * undefined (null on the wire).
 *
 * @param value - The rect value.
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

/**
 * Tells whether two rects are the same numbers.
 *
 * @param a - A rect.
 * @param b - Another rect.
 * @returns True when x, y, w and h are equal.
 * @example
 * ```ts
 * sameRect({ x: 0, y: 0, w: 1, h: 1 }, { x: 0, y: 0, w: 1, h: 1 }); // true
 * ```
 */
function sameRect(a: PageRect, b: PageRect): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

/**
 * Tells whether two calibration targets are the same key, drawn rect and root rect.
 *
 * @param a - A target, or undefined.
 * @param b - Another target, or undefined.
 * @returns True when both are undefined or equal.
 * @example
 * ```ts
 * sameTarget(undefined, undefined); // true
 * ```
 */
function sameTarget(a: CalibrationTarget | undefined, b: CalibrationTarget | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.key === b.key && sameRect(a.drawn, b.drawn) && sameRect(a.root, b.root);
}

/**
 * The calibration target of a game.ui value: the first keyed node whose drawn rect covers the
 * ui root (the most precise scale), else the shared `calibrationTarget` (the first keyed node
 * with a width). The root rect is the first root's: the topmost popup under the synthetic root.
 *
 * @param ui - The game.ui value.
 * @returns The key, its drawn rect and the root rect, undefined without a keyed node.
 * @example
 * ```ts
 * calibrationTargetOf(homeUi)?.key; // "homeScreen": the keyed root covers the screen
 * ```
 */
export function calibrationTargetOf(ui: Json): CalibrationTarget | undefined {
  const top = readUi(ui);
  if (isShapePath(top)) return undefined;
  const root = uiRoots(top)[0]?.rect;
  if (root === undefined) return undefined;

  for (const { node, fits } of uiVisits(top)) {
    if (node.key === undefined) continue;
    const drawn = drawnRect(node.rect, fits);
    if (drawn.w > 0 && sameRect(drawn, root)) return { key: node.key, drawn, root };
  }
  const first = calibrationTarget(ui);
  return first === undefined ? undefined : { ...first, root };
}

/**
 * Tells whether the stored game.ui has another calibration target than the given one: another
 * key, drawn rect or root rect.
 *
 * @param state - gameView state.
 * @param target - The target to compare with; the one in use when omitted.
 * @returns True when the target differs (false without a stored game.ui).
 * @example
 * ```ts
 * // The game went from the board to the settings popup since the last read.
 * targetChanged(state); // true: settingsScreen is the target now, boardScreen was read
 * ```
 */
export function targetChanged(
  state: GameViewState,
  target: CalibrationTarget | undefined = state.calibrationRun.used
): boolean {
  const { ui } = state.sources;
  return ui !== undefined && !sameTarget(calibrationTargetOf(ui), target);
}

/**
 * Keeps one calibration read: the calibration from it and its target, then a rebuild while
 * watching. When the ui moved on to another target meanwhile, that target is read next.
 *
 * @param ctx - Domain context of gameView.
 * @param target - The target that was read.
 * @param page - Its page rect; omitted or undefined when not on screen, failed or not reported.
 */
function keepRead(ctx: GameViewCtx, target: CalibrationTarget, page?: PageRect): void {
  const { state } = ctx;
  state.calibration = page === undefined ? undefined : calibrationFrom(page, target.drawn);
  state.calibrationRun.used = target;
  if (state.watching.length > 0) {
    rebuildScene(ctx, state.scene?.frame ?? frameOf(ctx.require(linkPlugin).status(), 0));
  }
  notify(state);
  if (targetChanged(state)) void calibrate(ctx);
}

/**
 * Calibrates from the stored game.ui: reads the page rect of the target (`game.locate`, else
 * `game.rect`; without either nothing is read and the calibration stays undefined) and maps its
 * drawn rect onto it. Marks the calibration read first, so a burst asks once; a second call
 * while a read is in flight does nothing. A read overtaken by a ui snapshot with another target
 * is discarded and read once more; the second read is kept. While it runs,
 * `calibrationRun.pending` holds it, so `scene()` can wait for the calibrated scene.
 *
 * @param ctx - Domain context of gameView.
 * @param retries - How many overtaken reads may still be discarded.
 * @returns Resolves when the calibration is known (never rejects).
 */
export async function calibrate(ctx: GameViewCtx, retries = 1): Promise<void> {
  const run = ctx.state.calibrationRun;
  if (ctx.state.sources.ui === undefined || run.reading) return;

  const pending = readCalibration(ctx, retries);
  run.pending = pending;
  try {
    await pending;
  } finally {
    if (run.pending === pending) run.pending = undefined;
  }
}

/**
 * One calibration read of `calibrate` (stored game.ui present, no read in flight).
 *
 * @param ctx - Domain context of gameView.
 * @param retries - How many overtaken reads may still be discarded.
 * @returns Resolves when the calibration is known (never rejects).
 */
async function readCalibration(ctx: GameViewCtx, retries: number): Promise<void> {
  const { state } = ctx;
  const run = state.calibrationRun;
  const { ui } = state.sources;
  if (ui === undefined) return;

  state.calibrationRead = true;
  run.waiting = false;
  const target = calibrationTargetOf(ui);
  if (target === undefined) {
    state.calibration = undefined;
    run.used = undefined;
    notify(state);
    return;
  }

  // A game that lists no rect source reports no element rects: nothing to read, no warn.
  const link = ctx.require(linkPlugin);
  const source = rectSourceOf(link.manifest());
  if (source === undefined) {
    keepRead(ctx, target);
    return;
  }

  const revision = run.revision;
  run.reading = true;
  let page: PageRect | undefined;
  try {
    page = pageRectOf(await link.read(source, { key: target.key }));
  } catch (error) {
    ctx.log.warn("gameView: calibration failed", { key: target.key, message: messageOf(error) });
  } finally {
    run.reading = false;
  }
  const overtaken = run.revision !== revision && targetChanged(state, target);
  if (overtaken && retries > 0) {
    await calibrate(ctx, retries - 1);
    return;
  }
  keepRead(ctx, target, page);
}

/**
 * One new game.ui value while watching: bumps the revision, then calibrates when nothing was
 * read yet, a device change waits for this snapshot, or the target changed.
 *
 * @param ctx - Domain context of gameView.
 */
export function onUiSnapshot(ctx: GameViewCtx): void {
  const { state } = ctx;
  state.calibrationRun.revision += 1;
  if (!state.calibrationRead || state.calibrationRun.waiting || targetChanged(state)) {
    void calibrate(ctx);
  }
}

/**
 * A device change: the calibration of the old device is read again. While watching, the read
 * waits for the next ui snapshot (the game lays out at the new size first); while hidden, the
 * next `scene()` reads it.
 *
 * @param ctx - Domain context of gameView.
 */
export function recalibrate(ctx: GameViewCtx): void {
  ctx.state.calibrationRead = false;
  if (ctx.state.watching.length > 0) ctx.state.calibrationRun.waiting = true;
}
