/* eslint-disable unicorn/no-null -- null is a JSON value on the wire */
import type { Json, Manifest } from "../../registry/protocol";
import type { ModelSnapshot } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures from the design demo data (design-context §8, merge-game): the
// player before and after the tap on the sawmill at frame 1503, the session
// state, a flow graph with a sub-flow and a slot, and a manifest.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The player before the tap: no item, energy 8, 2 sawmill charges, next id 3.
 *
 * @returns A fresh copy.
 */
export function playerBefore(): Json {
  return {
    merge: {
      board: { cols: 3, rows: 3, items: [] },
      energy: { value: 8, max: 10, countedAt: 1_024_032 },
      generators: { sawmill: { readyAt: 1_084_032, charges: 2 } },
      orders: [{ id: 0, needs: [{ chain: "wood", level: 3 }], given: [], rewardId: "planks" }],
      wallet: { coins: 25 },
      inventory: [null, null, null],
      nextItemId: 3
    },
    claimed: ["logs"],
    giftClaimed: false
  };
}

/**
 * The player after the tap: item i3 on c0_1, energy 7, 1 charge, next id 4.
 *
 * @returns A fresh copy.
 */
export function playerAfter(): Json {
  return {
    merge: {
      board: {
        cols: 3,
        rows: 3,
        items: [{ id: "i3", chain: "wood", level: 1, cell: "c0_1" }]
      },
      energy: { value: 7, max: 10, countedAt: 1_024_032 },
      generators: { sawmill: { readyAt: 1_084_032, charges: 1 } },
      orders: [{ id: 0, needs: [{ chain: "wood", level: 3 }], given: [], rewardId: "planks" }],
      wallet: { coins: 25 },
      inventory: [null, null, null],
      nextItemId: 4
    },
    claimed: ["logs"],
    giftClaimed: false
  };
}

/** The session state of the demo. */
export const SESSION_STATE: Json = { taps: 3, loading: 1, selected: "i3" };

/** The rng branch of the demo. */
export const RNG: Json = { seed: 42, streams: {} };

/**
 * A game.model snapshot.
 *
 * @param player - The player root.
 * @param session - The session root.
 * @param rng - The rng branch.
 * @returns The snapshot.
 */
export function model(player: Json, session: Json = SESSION_STATE, rng: Json = RNG): ModelSnapshot {
  return { player, session, rng };
}

/** The model before the tap, as a wire value. */
export const MODEL_BEFORE: Json = { player: playerBefore(), session: SESSION_STATE, rng: RNG };

/** The model after the tap, as a wire value. */
export const MODEL_AFTER: Json = { player: playerAfter(), session: SESSION_STATE, rng: RNG };

/** A merge-game-like graph: main → board (sub-flow), board → settings (sub-flow), a slot. */
export const GRAPH: Json = {
  main: "main",
  flows: {
    main: {
      start: "boot",
      edges: {},
      nodes: {
        boot: { flow: "main", node: "boot", outcomes: ["ready"] },
        board: { flow: "main", node: "board", outcomes: ["left"], subFlow: "board" },
        afterOrder: { flow: "main", node: "afterOrder", outcomes: [], slot: "afterOrder" }
      }
    },
    board: {
      start: "awaitIntent",
      edges: {},
      nodes: {
        awaitIntent: { flow: "board", node: "awaitIntent", outcomes: ["tap"] },
        settings: { flow: "board", node: "settings", outcomes: [], subFlow: "settingsPopup" }
      }
    },
    settingsPopup: {
      start: "open",
      edges: {},
      nodes: { open: { flow: "settingsPopup", node: "open", outcomes: ["close"] } }
    },
    rewardPopup: {
      start: "show",
      edges: {},
      nodes: { show: { flow: "rewardPopup", node: "show", outcomes: ["done"] } }
    }
  },
  slots: {}
};

/** The position of the demo. */
export const POSITION: Json = {
  path: "board/awaitIntent",
  flow: "board",
  node: "awaitIntent",
  waiting: ["tap", "merge", "leave"]
};

/** game.history {last: 1}: the last edge was a rejected merge. */
export const HISTORY: Json = [
  {
    index: 41,
    path: "board/merge",
    outcome: "rejected",
    payload: { reason: "empty" },
    next: "awaitIntent",
    now: 1_024_100,
    hash: "15f29b25"
  }
];

/** Every source stateView and its panel use. */
export const SOURCE_IDS = [
  "game.model",
  "game.tainted",
  "game.graph",
  "game.position",
  "game.history"
] as const;

/** A manifest with every source of SOURCE_IDS. */
export const MANIFEST: Manifest = {
  game: "merge-game 0.0.0",
  page: "http://127.0.0.1:3000/game.html",
  embedded: true,
  sources: SOURCE_IDS.map(id => ({
    id,
    title: id,
    input: id === "game.history" ? { last: "number?" as const } : {},
    changes: "edge" as const
  })),
  commands: []
};
