import { defineCommand } from "@moku-labs/game/control";
import { Window } from "happy-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeMonitor, type FakeMonitor } from "../../../../../tests/fixtures/fake-monitor";
import { startTinyHeadless } from "../../../../../tests/fixtures/tiny-screen-game";
import {
  heapMeasured,
  logLeak,
  measureGrowth
} from "../../../../../tests/integration/helpers/heap";
import { agentCoreConfig, createAgentCore } from "../../../../config";
import { channelPlugin } from "../../../channel";
import { perfPlugin } from "../../../perf";
import { recorderPlugin } from "../../../recorder";
import { registryPlugin } from "../../../registry";
import type { DevModule, GameLike } from "../../../registry/types";
import { overlayPlugin } from "../..";
import type { GraphContext2DLike, OverlayTab, VisibleMode } from "../../types";
import { HOST_ATTRIBUTE, PAINT_MS } from "../../types";

// ─────────────────────────────────────────────────────────────────────────────
// M2, the overlay part (spec 10, Delta 2026-10-16): the overlay keeps no memory,
// DOM node, listener or observer it does not mean to. The agent defaults over
// the headless tiny game with the root fake monitor, on a happy-dom Window
// stubbed onto the globals (as overlay.test.ts). 10 000 ticks of the open card
// (perf reads, the view model, the Preact render, the graph paint) and 200
// open/close cycles through every tab and the pill. Each test prints its
// numbers (`[leak] …`).
// ─────────────────────────────────────────────────────────────────────────────

/** Bytes in a KiB. */
const KIB = 1024;

/** The ceiling of both measurements: the spec's heap bound, and objects (steady runs read ±100). */
const CEILING = { heapBytes: 256 * KIB, objects: 1000 };

/** A test's own bound: the work is seconds, the default 5 s is not enough on a loaded machine. */
const TEST_MS = 60_000;

const framework = createAgentCore(agentCoreConfig, {
  plugins: [registryPlugin, channelPlugin, perfPlugin, recorderPlugin, overlayPlugin]
});

/** One overlay toggle, so the Game tab shows. */
const devModule: DevModule = {
  commands: [
    defineCommand({
      id: "test.glow",
      title: "Glow",
      input: { on: "boolean" },
      effect: "cosmetic",
      overlay: "toggle",
      value: () => true,
      run: (_app: GameLike, { on }) => on
    })
  ]
};

/** The places listeners are counted on (spec: window, document and the overlay root). */
type Place = "window" | "document" | "host" | "root";

/** Listener adds and removes per place, in fixed counters. */
type Balance = Record<Place, { added: number; removed: number }>;

/** ResizeObservers made and disconnected. */
type Observers = { created: number; disconnected: number };

let game: { readonly app: GameLike; stop(): Promise<void> };
let dom: Window;
let monitor: FakeMonitor;
let balance: Balance;
let observers: Observers;
let painted: { rects: number };
const stops: (() => Promise<void>)[] = [];
const restores: (() => void)[] = [];

beforeEach(async () => {
  vi.stubGlobal("__MOKU_GAME_DEV__", false);
  vi.stubGlobal("__MOKU_GAME_AGENT__", true);
  vi.stubGlobal("__MOKU_GAME_CONTROL__", false);
  vi.stubGlobal("__MOKU_GAME_ENGINE__", "0.15.0+memory");
  vi.stubGlobal("__MOKU_GAME_BUILD__", "debug-20261016T000000Z");
  game = await startTinyHeadless();
  monitor = createFakeMonitor({ capacity: 1024 });
  dom = new Window({ width: 384, height: 833 });
  // The page's title, fixed: happy-dom answers document.title (the registry's game name, read at
  // every render) with a lookup it caches in a list on every element it walks, and a DOM change
  // (each open and close) makes the next read walk and add again: a growth of the test DOM only.
  Object.defineProperty(dom.document, "title", { value: "overlay memory" });
  // The slide forces its reset with a style read (getComputedStyle): happy-dom caches every computed
  // style it makes in lists on the document and the element's parents that only a DOM change
  // empties, so a paint a tick would grow them in the test and never in a browser.
  const style = { getPropertyValue: () => "none" };
  dom.getComputedStyle = (() => style) as never;
  painted = { rects: 0 };
  dom.HTMLCanvasElement.prototype.getContext = (() => quietContext(painted)) as never;
  balance = countListeners(dom);
  observers = { created: 0, disconnected: 0 };
  vi.stubGlobal("ResizeObserver", countingObserver(observers));
  vi.stubGlobal("document", dom.document);
  vi.stubGlobal("CSSStyleSheet", dom.CSSStyleSheet);
  vi.stubGlobal("localStorage", dom.localStorage);
  vi.useFakeTimers({
    toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"]
  });
});

afterEach(async () => {
  for (const stop of stops.splice(0).toReversed()) await stop();
  for (const restore of restores.splice(0)) restore();
  vi.useRealTimers();
  await game.stop();
  vi.unstubAllGlobals();
  await dom.happyDOM.close();
});

/**
 * Creates and starts the agent app over the game, the monitor grafted on as its renderer, the
 * recorder off (a recording keeps its lines by design).
 *
 * @returns The started app.
 */
async function startEditor() {
  const grafted: GameLike = Object.create(game.app, { renderer: { value: { monitor } } });
  const app = framework.createApp({
    pluginConfigs: {
      registry: { game: grafted, modules: [devModule] },
      recorder: { autoStart: false }
    }
  });
  app.log.clearSinks();
  await app.start();
  stops.push(() => app.stop());
  return app;
}

/** Page ms of the next frame to commit. */
let nextT = 1000;

/**
 * Commits a quarter second of 60 fps frames, a js spike in every ninth batch.
 *
 * @param batch - The batch's index.
 */
function commitQuarter(batch: number): void {
  for (let index = 0; index < 15; index += 1) {
    const spike = index === 7 && batch % 9 === 0;
    monitor.commit({
      t: nextT,
      gapMs: 16.67,
      rateMs: 16.67,
      budgetMs: 16.67,
      workMs: spike ? 30 : 3,
      drawn: true,
      gpuMs: 4,
      causes: spike ? 1 << 1 : 0
    });
    nextT += 16.67;
  }
}

/**
 * The overlay's shadow root.
 *
 * @returns The root.
 */
function shadow(): ShadowRoot {
  const root = dom.document.querySelector(`[${HOST_ATTRIBUTE}]`)?.shadowRoot;
  if (!root) throw new Error("no overlay root");
  return root as unknown as ShadowRoot;
}

/**
 * Every node under a node, text nodes included.
 *
 * @param node - The node.
 * @returns How many.
 */
function nodesUnder(node: Node): number {
  let count = 0;
  for (const child of node.childNodes) count += 1 + nodesUnder(child);
  return count;
}

/**
 * Listeners still added per place: adds minus removes.
 *
 * @returns The open count of each place.
 */
function openListeners(): Record<Place, number> {
  return {
    window: balance.window.added - balance.window.removed,
    document: balance.document.added - balance.document.removed,
    host: balance.host.added - balance.host.removed,
    root: balance.root.added - balance.root.removed
  };
}

/**
 * One tick of the open card: a quarter second of frames, then the paint interval.
 *
 * @param round - The tick's index.
 */
function tick(round: number): void {
  commitQuarter(round);
  vi.advanceTimersByTime(PAINT_MS);
}

/** Before a heap read: the monitor events the fake keeps (the recorder's devtools lines) dropped. */
function clearEvents(): void {
  monitor.events.length = 0;
}

/** The visible windows an open/close cycle goes through, in turn. */
const OPENINGS: readonly { readonly mode: VisibleMode; readonly tab?: OverlayTab }[] = [
  { mode: "card", tab: "frames" },
  { mode: "card", tab: "record" },
  { mode: "card", tab: "link" },
  { mode: "card", tab: "game" },
  { mode: "pill" }
];

describe("overlay memory (M2)", () => {
  it("10 000 ticks of the open card (perf read, view model, render, graph paint) keep the heap flat (bug: a closure, node or string kept per tick)", {
    timeout: TEST_MS
  }, async () => {
    const app = await startEditor();
    app.overlay.open({ tab: "frames" });

    const growth = await measureGrowth(tick, {
      warmup: 2000,
      rounds: 10_000,
      settle: clearEvents,
      ceiling: CEILING
    });
    logLeak("overlay ticks, 10 000 open card", {
      ...growth,
      counts: { rects: painted.rects, nodes: nodesUnder(shadow() as unknown as Node) }
    });

    expect(painted.rects).toBeGreaterThan(10_000);
    expect(shadow().querySelector("canvas")).not.toBeNull();
    if (growth.objects !== undefined) expect(growth.objects).toBeLessThan(CEILING.objects);
    if (heapMeasured(growth)) expect(growth.heapBytes).toBeLessThan(CEILING.heapBytes);
  });

  it("200 open/close cycles through every tab and the pill: after each close the same nodes under the root and the same listeners; a stop removes every listener and observer it added (bug: a listener, observer or node kept by a closed overlay)", {
    timeout: TEST_MS
  }, async () => {
    const app = await startEditor();
    commitQuarter(1);
    // The root is looked up once: happy-dom caches every querySelector in lists on the nodes it
    // walks, and each DOM change makes the next one walk and add again (the test's own growth).
    const root = shadow() as unknown as Node;
    const nodes = nodesUnder(root);
    const listening = openListeners();
    const watching = observers.created - observers.disconnected;
    const drift = { nodes: 0, listeners: 0, observers: 0 };

    const cycle = (round: number): void => {
      const opening = OPENINGS[round % OPENINGS.length] ?? { mode: "card" };
      app.overlay.open(opening);
      commitQuarter(round);
      vi.advanceTimersByTime(PAINT_MS);
      app.overlay.close();
      if (nodesUnder(root) !== nodes) drift.nodes += 1;
      const open = openListeners();
      if (JSON.stringify(open) !== JSON.stringify(listening)) drift.listeners += 1;
      if (observers.created - observers.disconnected !== watching) drift.observers += 1;
    };
    const growth = await measureGrowth(cycle, {
      warmup: 300,
      rounds: 200,
      settle: clearEvents,
      ceiling: CEILING
    });
    const hostOpen = openListeners().host;
    await app.stop();
    stops.length = 0;
    const left = openListeners();
    logLeak("overlay open/close, 200 cycles", {
      ...growth,
      counts: {
        "node drift": drift.nodes,
        "listener drift": drift.listeners,
        "observer drift": drift.observers,
        "listeners left": left.window + left.document + left.host + left.root,
        "observers left": observers.created - observers.disconnected
      }
    });

    expect(hostOpen).toBeGreaterThan(0);
    expect(balance.window.added).toBeGreaterThan(0);
    expect(balance.document.added).toBeGreaterThan(0);
    expect(observers.created).toBeGreaterThan(OPENINGS.length);
    expect(drift).toEqual({ nodes: 0, listeners: 0, observers: 0 });
    expect(left).toEqual({ window: 0, document: 0, host: 0, root: 0 });
    expect(observers.created - observers.disconnected).toBe(0);
    expect(dom.document.querySelector(`[${HOST_ATTRIBUTE}]`)).toBeNull();
    if (growth.objects !== undefined) expect(growth.objects).toBeLessThan(CEILING.objects);
    if (heapMeasured(growth)) expect(growth.heapBytes).toBeLessThan(CEILING.heapBytes);
  });
});

/**
 * A 2D context that paints nothing and keeps nothing but one counter.
 *
 * @param painted - Where the fillRect calls are counted.
 * @param painted.rects - The count.
 * @returns The context.
 */
function quietContext(painted: { rects: number }): GraphContext2DLike {
  return {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    fillRect: () => {
      painted.rects += 1;
    },
    strokeRect: () => undefined,
    beginPath: () => undefined,
    closePath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    fill: () => undefined,
    stroke: () => undefined,
    setLineDash: () => undefined,
    fillText: () => undefined,
    measureText: text => ({ width: text.length * 6 }),
    clearRect: () => undefined,
    setTransform: () => undefined
  };
}

/**
 * Counts the listener adds and removes on the page's window, its document, the overlay's host and
 * its shadow root, by wrapping happy-dom's EventTarget and the window's own bound methods
 * (restored after the test).
 *
 * @param window - The happy-dom window.
 * @returns The live counters.
 */
function countListeners(window: Window): Balance {
  const counts: Balance = {
    window: { added: 0, removed: 0 },
    document: { added: 0, removed: 0 },
    host: { added: 0, removed: 0 },
    root: { added: 0, removed: 0 }
  };
  const placeOf = (target: unknown): Place | undefined => {
    if (target === window.document) return "document";
    if (target instanceof window.ShadowRoot && target.host?.hasAttribute(HOST_ATTRIBUTE) === true) {
      return "root";
    }
    if (target instanceof window.HTMLElement && target.hasAttribute(HOST_ATTRIBUTE)) return "host";
    return undefined;
  };
  const prototype = ownerOfAddEventListener(window.document);
  const { addEventListener: add, removeEventListener: remove } = prototype;
  prototype.addEventListener = function (this: unknown, ...args: Parameters<typeof add>) {
    const place = placeOf(this);
    if (place !== undefined) counts[place].added += 1;
    add.apply(this, args);
  };
  prototype.removeEventListener = function (this: unknown, ...args: Parameters<typeof remove>) {
    const place = placeOf(this);
    if (place !== undefined) counts[place].removed += 1;
    remove.apply(this, args);
  };
  // happy-dom binds the window's own methods at construction: wrap those too.
  const { addEventListener: windowAdd, removeEventListener: windowRemove } = window;
  window.addEventListener = (...args: Parameters<typeof windowAdd>) => {
    counts.window.added += 1;
    windowAdd(...args);
  };
  window.removeEventListener = (...args: Parameters<typeof windowRemove>) => {
    counts.window.removed += 1;
    windowRemove(...args);
  };
  restores.push(() => {
    prototype.addEventListener = add;
    prototype.removeEventListener = remove;
    window.addEventListener = windowAdd;
    window.removeEventListener = windowRemove;
  });
  return counts;
}

/**
 * The prototype that defines `addEventListener` for a node and the window: happy-dom's EventTarget
 * (the window's `EventTarget` global is a per-window subclass, so its prototype is not the one).
 *
 * @param node - A happy-dom node.
 * @returns The prototype.
 * @throws {Error} When none defines it.
 */
function ownerOfAddEventListener(node: object): EventTarget {
  for (let proto: object | null = node; proto !== null; proto = Object.getPrototypeOf(proto)) {
    if (Object.hasOwn(proto, "addEventListener")) return proto as EventTarget;
  }
  throw new Error("no addEventListener on the node's prototype chain");
}

/**
 * A ResizeObserver that observes nothing and counts how many were made and disconnected.
 *
 * @param counts - The counters.
 * @returns The class to stub as the global.
 */
function countingObserver(counts: Observers) {
  return class CountingObserver {
    constructor() {
      counts.created += 1;
    }
    observe(): void {
      // Nothing to measure in happy-dom.
    }
    unobserve(): void {
      // Nothing observed.
    }
    disconnect(): void {
      counts.disconnected += 1;
    }
  };
}
