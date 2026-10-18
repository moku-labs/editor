/**
 * @file renderView view — the shared cursor (spec 09 § M8 items 11–12, tooltip; § M9 cursor chips):
 * the source time under the pointer on any graph goes into `mission.hoverMs`, which the painters
 * read every frame; the frame under it is kept beside it. Two kinds of listeners: the paint loop hears
 * every move (the cursor line follows the hand), the DOM (the tooltip, the cards' cursor chips) hears
 * only a change of the hovered frame, so it is rebuilt per frame and never per pointer move.
 */
import type { MissionState } from "../types";

/** The hovered frame and the listeners of one Mission control. */
type HoverStore = {
  frame: number | undefined;
  readonly frameListeners: Set<() => void>;
  readonly moveListeners: Set<() => void>;
};

/** One store per Mission control state, gone with it. */
const STORES = new WeakMap<MissionState, HoverStore>();

/**
 * The store of a Mission control, made on first use.
 *
 * @param mission - Mission control's state.
 * @returns Its store.
 */
function storeOf(mission: MissionState): HoverStore {
  let store = STORES.get(mission);
  if (store === undefined) {
    store = { frame: undefined, frameListeners: new Set(), moveListeners: new Set() };
    STORES.set(mission, store);
  }
  return store;
}

/**
 * Adds a listener to a set; returns an idempotent remover.
 *
 * @param listeners - The set.
 * @param fn - The listener.
 * @returns The remover.
 */
function addTo(listeners: Set<() => void>, fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Moves the shared cursor: the time the painters draw it at and the frame under it. Every move tells
 * the move listeners; a new frame (or the end of the hover) also tells the frame listeners.
 *
 * @param mission - Mission control's state.
 * @param ms - Source-clock ms under the pointer; none when the pointer left the graphs.
 * @param frame - The frame under it; none over no data.
 * @example
 * ```ts
 * setHover(mission, 78_210.5, 4851);
 * mission.hoverMs; // 78_210.5: every graph draws its cursor there
 * ```
 */
export function setHover(mission: MissionState, ms?: number, frame?: number): void {
  const store = storeOf(mission);
  const moved = mission.hoverMs !== ms;
  mission.hoverMs = ms;
  if (moved) for (const listener of store.moveListeners) listener();
  if (store.frame === frame) return;
  store.frame = frame;
  for (const listener of store.frameListeners) listener();
}

/**
 * The frame under the shared cursor.
 *
 * @param mission - Mission control's state.
 * @returns The frame; undefined without a hover.
 * @example
 * ```ts
 * hoverFrame(mission); // 4851 while the pointer is over it
 * ```
 */
export function hoverFrame(mission: MissionState): number | undefined {
  return STORES.get(mission)?.frame;
}

/**
 * Listens to changes of the hovered frame (the tooltip, the cursor chips).
 *
 * @param mission - Mission control's state.
 * @param fn - The listener.
 * @returns Its remover.
 * @example
 * ```ts
 * const off = onHoverFrame(mission, () => rebuildTooltip());
 * ```
 */
export function onHoverFrame(mission: MissionState, fn: () => void): () => void {
  return addTo(storeOf(mission).frameListeners, fn);
}

/**
 * Listens to every move of the shared cursor (the paint loop wakes on it).
 *
 * @param mission - Mission control's state.
 * @param fn - The listener.
 * @returns Its remover.
 * @example
 * ```ts
 * const off = onHoverMove(mission, () => wake());
 * ```
 */
export function onHoverMove(mission: MissionState, fn: () => void): () => void {
  return addTo(storeOf(mission).moveListeners, fn);
}

/**
 * The pointer left the graphs: no cursor, no hovered frame.
 *
 * @param mission - Mission control's state.
 * @example
 * ```ts
 * clearHover(mission);
 * mission.hoverMs; // undefined
 * ```
 */
export function clearHover(mission: MissionState): void {
  setHover(mission);
}
