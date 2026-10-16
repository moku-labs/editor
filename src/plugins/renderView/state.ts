/**
 * @file renderView plugin — state factory and the two UI stores: the scene cards' (notify,
 * subscribe) and Mission control's own (notifyMission, subscribeMission), so a Mission control
 * value re-renders Mission control, not the scene cards.
 */
import { createMissionSeries } from "./series/series";
import { createPerfHistory } from "./source/contract";
import type { MissionState, RenderViewConfig, RenderViewState } from "./types";
import { createDisplayClock } from "./view/clock";

/**
 * Creates Mission control's state (spec 09 § M12): no source, the 2-minute history and the side
 * series allocated once (about 2.5 MB), the display clock not started, live at the 6 s span, nothing
 * selected or in flight, every popover closed, the Connect panel on "By wire", Scene details closed.
 *
 * @returns The mission state.
 */
function createMissionState(): MissionState {
  return {
    source: undefined,
    watches: [],
    poll: { timer: undefined, inFlight: false, eventsAfter: undefined },
    history: createPerfHistory(),
    series: createMissionSeries(),
    second: undefined,
    passes: undefined,
    recorder: undefined,
    telemetry: undefined,
    clock: createDisplayClock(),
    view: { live: true, endMs: 0, span: 6000 },
    selection: undefined,
    selectionVersion: 0,
    detail: { kind: "idle" },
    hoverMs: undefined,
    rate: { pending: undefined, answer: undefined },
    sectionPending: undefined,
    popover: undefined,
    connect: {
      tab: "wire",
      stopScan: undefined,
      codes: new Map(),
      pending: undefined,
      error: undefined
    },
    sceneOpen: false,
    files: new Map(),
    stopLoop: undefined,
    listeners: new Set()
  };
}

/**
 * Creates the initial renderView state: textures sorted by GPU MB descending, every bundle shown,
 * no data, Mission control empty. The roots of the tree open on the first scene of a session.
 *
 * @param _ctx - Minimal context (the config shapes nothing here yet).
 * @param _ctx.config - Resolved plugin config.
 * @returns The fresh state.
 */
export function createRenderViewState(_ctx: {
  readonly config: Readonly<RenderViewConfig>;
}): RenderViewState {
  return {
    active: false,
    session: undefined,
    lastFrame: undefined,
    firstFrame: undefined,
    render: undefined,
    assets: undefined,
    effects: undefined,
    effectsWatch: undefined,
    effectsInstalled: true,
    sources: {},
    scene: undefined,
    calibration: undefined,
    calibrationAsked: false,
    catalogue: undefined,
    loaded: new Map(),
    releases: [],
    seen: new Map(),
    tree: { open: new Set(), selected: undefined },
    table: { sort: "gpuMb", dir: -1, bundle: "all", hover: undefined },
    pendingReveal: undefined,
    box: undefined,
    overlayRoot: undefined,
    error: undefined,
    palette: undefined,
    tracker: [],
    watching: [],
    listeners: new Set(),
    mission: createMissionState()
  };
}

/**
 * Calls every UI listener of the scene cards.
 *
 * @param state - renderView state.
 */
export function notify(state: RenderViewState): void {
  for (const listener of state.listeners) listener();
}

/**
 * Adds a UI listener of the scene cards; returns an idempotent remover.
 *
 * @param state - renderView state.
 * @param fn - The listener.
 * @returns The remover.
 */
export function subscribe(state: RenderViewState, fn: () => void): () => void {
  state.listeners.add(fn);
  return () => {
    state.listeners.delete(fn);
  };
}

/**
 * Calls every listener of Mission control's own UI.
 *
 * @param mission - Mission control's state.
 */
export function notifyMission(mission: MissionState): void {
  for (const listener of mission.listeners) listener();
}

/**
 * Adds a listener of Mission control's own UI; returns an idempotent remover.
 *
 * @param mission - Mission control's state.
 * @param fn - The listener.
 * @returns The remover.
 */
export function subscribeMission(mission: MissionState, fn: () => void): () => void {
  mission.listeners.add(fn);
  return () => {
    mission.listeners.delete(fn);
  };
}
