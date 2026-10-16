/* eslint-disable unicorn/no-null -- null is the history's "no epoch yet" */
import { describe, expect, it, vi } from "vitest";
import { HISTORY_ROWS } from "../../../perf/protocol";
import {
  createRenderViewState,
  notify,
  notifyMission,
  subscribe,
  subscribeMission
} from "../../state";
import { CONFIG } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// state.ts: the state factory — the initial shape of the scene cards' fields and
// of Mission control (spec 09 § M12), including session, calibrationAsked and
// palette, a fresh object with fresh collections per call, and the two UI
// stores.
// ─────────────────────────────────────────────────────────────────────────────

describe("createRenderViewState", () => {
  it("starts empty: no data, sort GPU MB descending, every bundle, nothing open, Mission control live at 6 s", () => {
    const state = createRenderViewState({ config: CONFIG });

    expect(state).toEqual({
      active: false,
      session: undefined,
      lastFrame: undefined,
      firstFrame: undefined,
      render: undefined,
      assets: undefined,
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
      mission: {
        source: undefined,
        watches: [],
        poll: { timer: undefined, inFlight: false, eventsAfter: undefined },
        history: expect.objectContaining({ capacity: HISTORY_ROWS, count: 0, epoch: null }),
        series: expect.objectContaining({ version: 0 }),
        second: undefined,
        passes: undefined,
        recorder: undefined,
        telemetry: undefined,
        clock: expect.objectContaining({ ms: undefined, delayMs: 1000, endMs: undefined }),
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
      }
    });
  });

  it("has the three fields the hooks need: session, calibrationAsked, palette", () => {
    const state = createRenderViewState({ config: CONFIG });

    expect(state).toHaveProperty("session", undefined);
    expect(state).toHaveProperty("calibrationAsked", false);
    expect(state).toHaveProperty("palette", undefined);
  });

  it("returns a fresh object with fresh collections on every call, Mission control's history and series included", () => {
    const first = createRenderViewState({ config: CONFIG });
    const second = createRenderViewState({ config: CONFIG });

    expect(second === first).toBe(false);
    expect(second.sources).not.toBe(first.sources);
    expect(second.loaded).not.toBe(first.loaded);
    expect(second.releases).not.toBe(first.releases);
    expect(second.seen).not.toBe(first.seen);
    expect(second.tree).not.toBe(first.tree);
    expect(second.tree.open).not.toBe(first.tree.open);
    expect(second.table).not.toBe(first.table);
    expect(second.tracker).not.toBe(first.tracker);
    expect(second.watching).not.toBe(first.watching);
    expect(second.listeners).not.toBe(first.listeners);
    expect(second.mission.history.frame).not.toBe(first.mission.history.frame);
    expect(second.mission.series.heap.v).not.toBe(first.mission.series.heap.v);
    expect(second.mission.clock).not.toBe(first.mission.clock);

    first.tree.open.add("ui:boardScreen");
    first.table.bundle = "ui";
    first.mission.history.frame[0] = 4810;
    first.mission.view.live = false;
    expect(second.tree.open.size).toBe(0);
    expect(second.table.bundle).toBe("all");
    expect(second.mission.history.frame[0]).toBe(0);
    expect(second.mission.view.live).toBe(true);
  });
});

// A Mission control value (a frames answer every second, a telemetry record) re-renders Mission
// control only; a scene value re-renders the scene cards only. Bug: the 1 Hz Mission control
// values re-rendering the scene cards (or the cards never hearing of a new scene).
describe("the two UI stores", () => {
  it("notifyMission calls Mission control's listeners, notify the scene cards', each until they unsubscribe", () => {
    const state = createRenderViewState({ config: CONFIG });
    const cards = vi.fn();
    const mission = vi.fn();
    const offCards = subscribe(state, cards);
    const offMission = subscribeMission(state.mission, mission);

    notifyMission(state.mission);
    expect([cards.mock.calls.length, mission.mock.calls.length]).toEqual([0, 1]);
    notify(state);
    expect([cards.mock.calls.length, mission.mock.calls.length]).toEqual([1, 1]);

    offMission();
    offMission();
    offCards();
    notifyMission(state.mission);
    notify(state);
    expect([cards.mock.calls.length, mission.mock.calls.length]).toEqual([1, 1]);
  });
});
