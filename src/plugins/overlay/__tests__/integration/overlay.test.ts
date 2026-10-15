import { defineCommand } from "@moku-labs/game/control";
import { Window } from "happy-dom";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  createFakeMonitor,
  eventLine,
  type FakeMonitor,
  rateChange
} from "../../../../../tests/fixtures/fake-monitor";
import { startTinyHeadless } from "../../../../../tests/fixtures/tiny-screen-game";
import type { AgentEvents } from "../../../../config";
import { agentCoreConfig, createAgentCore, createAgentPlugin } from "../../../../config";
import { channelPlugin } from "../../../channel";
import { perfPlugin } from "../../../perf";
import { recorderPlugin } from "../../../recorder";
import { registryPlugin } from "../../../registry";
import type { DevModule, GameLike } from "../../../registry/types";
import { overlayPlugin } from "../..";
import type { Config, OverlayApi } from "../../types";
import { HOST_ATTRIBUTE, PAINT_MS, STORE_KEY } from "../../types";
import { fakeContext } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The agent defaults (registry, channel, perf, recorder, overlay) over the
// headless tiny game with the root fake monitor grafted on as its renderer, a
// `.dev` module with one overlay toggle (cosmetic) and one overlay button
// (cheat), on the flags of a plain `--debug` build. The DOM is a happy-dom
// Window stubbed onto the globals; its canvas gets a recording 2D context, so
// the real perf/graph painter draws and its hit tests answer.
// ─────────────────────────────────────────────────────────────────────────────

/** A test bridge: it emits bridge:status on demand and records overlay:connect. */
const connects: AgentEvents["overlay:connect"][] = [];
const bridgeStub = createAgentPlugin("bridge", {
  api: ctx => ({
    send: (payload: AgentEvents["bridge:status"]) => ctx.emit("bridge:status", payload)
  }),
  hooks: () => ({
    "overlay:connect": (payload: AgentEvents["overlay:connect"]) => {
      connects.push(payload);
    }
  })
});

const framework = createAgentCore(agentCoreConfig, {
  plugins: [registryPlugin, channelPlugin, perfPlugin, recorderPlugin, overlayPlugin, bridgeStub]
});

/** The toggle's state, read by its `value(app)`. */
let glowOn = true;

/** The dev module of the test. */
const devModule: DevModule = {
  commands: [
    defineCommand({
      id: "test.glow",
      title: "Glow",
      input: { on: "boolean" },
      effect: "cosmetic",
      overlay: "toggle",
      value: () => glowOn,
      run: (_app: GameLike, { on }) => {
        glowOn = on;
        return on;
      }
    }),
    defineCommand({
      id: "test.boost",
      title: "Boost",
      input: {},
      effect: "cheat",
      overlay: "button",
      run: () => 1
    })
  ]
};

/** A started headless tiny game. */
type StartedGame = { readonly app: GameLike; stop(): Promise<void> };

let game: StartedGame;
let dom: Window;
let monitor: FakeMonitor;
const stops: (() => Promise<void>)[] = [];

/**
 * Creates and starts the editor app over the game, the monitor grafted on as its renderer.
 *
 * @param pluginConfigs - Overlay and recorder overrides.
 * @param pluginConfigs.overlay - Overlay overrides.
 * @param pluginConfigs.recorder - Recorder overrides.
 * @param pluginConfigs.recorder.autoStart - Start a log at start.
 * @returns The started app.
 */
async function startEditor(
  pluginConfigs: { overlay?: Partial<Config>; recorder?: { autoStart?: boolean } } = {}
) {
  const grafted: GameLike = Object.create(game.app, { renderer: { value: { monitor } } });
  const app = framework.createApp({
    pluginConfigs: {
      registry: { game: grafted, modules: [devModule] },
      overlay: pluginConfigs.overlay ?? {},
      recorder: pluginConfigs.recorder ?? {}
    }
  });
  app.log.clearSinks();
  await app.start();
  stops.push(() => app.stop());
  return app;
}

/**
 * The overlay's shadow root.
 *
 * @returns The root.
 */
function shadow(): ShadowRoot {
  const root = host()?.shadowRoot;
  if (!root) throw new Error("no overlay root");
  return root;
}

/**
 * The overlay's host in the happy-dom document.
 *
 * @returns The host, or null.
 */
function host(): HTMLElement | null {
  return dom.document.querySelector(`[${HOST_ATTRIBUTE}]`) as unknown as HTMLElement | null;
}

/**
 * One element of the overlay.
 *
 * @param selector - The selector.
 * @returns The element.
 */
function part<Element extends HTMLElement = HTMLElement>(selector: string): Element {
  const element = shadow().querySelector<Element>(selector);
  if (element === null) throw new Error(`no ${selector}`);
  return element;
}

/**
 * Commits frames at 60 fps from `t`.
 *
 * @param count - How many.
 * @param t - Page ms of the first.
 * @param extra - Ring values for each.
 * @param extra.rateMs - One frame of the rate.
 * @param extra.budgetMs - The frame's budget.
 * @returns The page ms after the last.
 */
function commit(
  count: number,
  t: number,
  extra: { rateMs?: number; budgetMs?: number } = {}
): number {
  const rateMs = extra.rateMs ?? 16.67;
  for (let index = 0; index < count; index += 1) {
    monitor.commit({
      t: t + index * rateMs,
      gapMs: rateMs,
      rateMs,
      budgetMs: extra.budgetMs ?? rateMs,
      workMs: 3,
      drawn: true,
      gpuMs: 4
    });
  }
  return t + count * rateMs;
}

beforeEach(async () => {
  glowOn = true;
  connects.length = 0;
  vi.stubGlobal("__MOKU_GAME_DEV__", false);
  vi.stubGlobal("__MOKU_GAME_AGENT__", true);
  vi.stubGlobal("__MOKU_GAME_CONTROL__", false);
  vi.stubGlobal("__MOKU_GAME_ENGINE__", "0.14.12+9c41e0");
  vi.stubGlobal("__MOKU_GAME_BUILD__", "debug-20261014T160000Z");
  game = await startTinyHeadless();
  monitor = createFakeMonitor({ capacity: 1024 });
  dom = new Window({ width: 384, height: 833 });
  dom.HTMLCanvasElement.prototype.getContext = (() => fakeContext()) as never;
  vi.stubGlobal("document", dom.document);
  vi.stubGlobal("CSSStyleSheet", dom.CSSStyleSheet);
  vi.stubGlobal("localStorage", dom.localStorage);
  vi.useFakeTimers({
    toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"]
  });
});

afterEach(async () => {
  for (const stop of stops.splice(0).toReversed()) await stop();
  vi.useRealTimers();
  await game.stop();
  vi.unstubAllGlobals();
  await dom.happyDOM.close();
});

describe("overlay integration", () => {
  it("(1) starts hidden with the global set; the engine's channel opens the pill; a tap opens the card", async () => {
    const app = await startEditor();
    expect(app.overlay.mode()).toBe("hidden");
    expect(host()?.hidden).toBe(true);
    const channel = globalThis.__MOKU_GAME_OVERLAY__;
    expect(channel?.isOpen()).toBe(false);

    commit(60, 1000);
    channel?.open({ mode: "pill" });
    await vi.advanceTimersByTimeAsync(PAINT_MS);
    expect(part('[data-overlay="pill"] [data-part="fps"]').textContent).toBe("60");
    part('[data-overlay="pill"]').click();
    expect(app.overlay.mode()).toBe("card");
    expect(shadow().querySelectorAll('[role="tab"]')).toHaveLength(4);
    expect(part('[data-part="engine"]').textContent).toContain("engine 0.14.12+9c41e0");
    expect(part('[data-part="engine"]').textContent).toContain("debug, read-only");
  });

  it("(2) spikes: the header counts them, prev/next walk them, a hit opens the record; the rate switch and the game's events show", async () => {
    const app = await startEditor();
    let t = commit(60, 1000, { rateMs: 8.33 });
    const before = monitor.commit({
      t,
      gapMs: 8.33,
      rateMs: 8.33,
      budgetMs: 8.33,
      workMs: 3,
      drawn: true
    });
    t += 8.33;
    const spike = monitor.commit({
      t,
      gapMs: 41.3,
      rateMs: 16.67,
      budgetMs: 16.67,
      workMs: 8,
      drawn: true,
      causes: 1 << 4
    });
    monitor.emit(
      eventLine("overlay", spike, {
        entity: 7,
        label: "shopDimLayer",
        what: "open",
        mode: "freeze"
      })
    );
    monitor.emit(eventLine("pool-trim", before, { reason: "rest", freedMb: 41.5 }));
    monitor.emit(eventLine("rate", spike, rateChange()));
    commit(40, t + 41.3);
    app.overlay.open();
    await vi.advanceTimersByTimeAsync(PAINT_MS * 2);

    expect(part('[data-part="header"] [data-part="spikes"] [data-legend]').textContent).toBe("1");
    expect(part('[data-counter="fps"] [data-part="rate"]').textContent).toBe(" @60");
    part('[data-spike-nav="next"]').click();
    expect(part('[data-part="count"]').textContent).toBe("1/1");

    const canvas = part<HTMLCanvasElement>("canvas");
    for (let x = 0; x < 300 && shadow().querySelector("[data-record]") === null; x += 3) {
      canvas.dispatchEvent(
        new dom.MouseEvent("click", { clientX: x, clientY: 60 }) as unknown as Event
      );
    }
    expect(part("[data-record]").dataset.record).toBe(String(spike));
    expect(
      [...shadow().querySelectorAll('[data-part="causes"] [data-legend]')].map(
        legend => legend.textContent
      )
    ).toEqual(["UP"]);
    const changed = part('[data-part="changed"]').textContent;
    expect(changed).toContain("rate 120 → 60 (missed, auto)");
    expect(changed).toContain("shopDimLayer open · pool trim −41.5 MB (rest)");
    part('[data-tab="record"]').click();
    part('[data-tab="frames"]').click();
    expect(part('[data-part="changed"]').textContent).toBe(changed);
    part('[data-action="back"]').click();
    expect(shadow().querySelector("canvas")).not.toBeNull();
  });

  it("(3) the Game tab: the toggle runs { on: false }, logged once with a mark; the cheat is greyed", async () => {
    const app = await startEditor();
    commit(30, 1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(app.recorder.status().state).toBe("recording");
    app.overlay.open({ tab: "game" });
    expect(part('[data-command="test.glow"]').dataset.state).toBe("on");
    expect(part('[data-command="test.boost"]').dataset.state).toBe("refused");
    expect(part('[data-command="test.boost"]').textContent).toContain("needs a --debug=full build");

    part('[data-command="test.glow"]').click();
    await vi.advanceTimersByTimeAsync(PAINT_MS);
    expect(glowOn).toBe(false);
    expect(part('[data-command="test.glow"]').dataset.state).toBe("off");
    const commands = monitor.events.filter(event => event.name === "command");
    expect(commands).toHaveLength(1);
    expect(commands[0]?.detail).toMatchObject({ id: "test.glow", via: "overlay" });
    expect(monitor.marks).toEqual(["Glow off"]);
    expect(app.recorder.marks().at(-1)).toMatchObject({ label: "Glow off", auto: true });
    expect(part("[data-toast]").textContent).toMatch(
      /^Glow off\. Logged as a mark at \d\d:\d\d\.$/
    );
  });

  it("(4) the Record tab starts, marks and stops through the real recorder", async () => {
    const app = await startEditor({ recorder: { autoStart: false } });
    commit(30, 1000);
    app.overlay.open({ tab: "record" });
    part('[data-action="start"]').click();
    expect(app.recorder.status().state).toBe("recording");
    const field = part<HTMLInputElement>('[data-part="mark-row"] [data-part="field"]');
    field.value = "boss";
    field.dispatchEvent(new dom.Event("input", { bubbles: true }) as unknown as Event);
    part('[data-action="mark"]').click();
    expect(app.recorder.marks().map(mark => mark.label)).toEqual(["boss"]);
    part('[data-action="stop"]').click();
    await vi.advanceTimersByTimeAsync(PAINT_MS * 2);
    expect(app.recorder.status().state).toBe("idle");
    expect(shadow().querySelectorAll('[data-part="logs"] li')).toHaveLength(1);
  });

  it("(5) the Link tab shows the pairing code and STALE; Connect emits overlay:connect", async () => {
    const app = await startEditor();
    await app.bridge.send({
      status: { kind: "connecting" },
      link: {
        mode: "connecting",
        address: "192.168.1.5:47600",
        pairing: { code: "4821" },
        editorEngine: "0.14.13+1ab7f2"
      }
    });
    app.overlay.open({ tab: "link" });
    expect(part("[data-pairing]").dataset.pairing).toBe("4821");
    expect(part('[data-part="header"] [data-link]').dataset.link).toBe("stale");
    expect(shadow().querySelector("[data-caution]")).not.toBeNull();
    part('[data-action="pair"]').click();
    expect(connects).toEqual([{ address: "192.168.1.5:47600" }]);
  });

  it("(6) a drag past the middle docks left and is remembered by the next app", async () => {
    const first = await startEditor();
    first.overlay.open({ tab: "link" });
    const grip = part('[data-part="grip"]');
    const pointer = (type: string, x: number, y: number): void => {
      grip.dispatchEvent(
        new dom.PointerEvent(type, {
          bubbles: true,
          pointerId: 1,
          button: 0,
          clientX: x,
          clientY: y
        }) as unknown as Event
      );
    };
    pointer("pointerdown", 300, 600);
    pointer("pointermove", 60, 500);
    pointer("pointerup", 60, 500);
    expect(host()?.dataset.dock).toBe("left");
    expect(JSON.parse(dom.localStorage.getItem(STORE_KEY) ?? "{}")).toMatchObject({
      mode: "card",
      tab: "link",
      place: { dock: "left" }
    });
    await stops.pop()?.();

    const second = await startEditor();
    expect(second.overlay.mode()).toBe("card");
    expect(host()?.dataset.dock).toBe("left");
    expect(part('[role="tab"][aria-selected="true"]').dataset.tab).toBe("link");
  });

  it("(7) stop leaves no host, no global and no timer", async () => {
    vi.useRealTimers();
    vi.useFakeTimers({
      toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"]
    });
    await startEditor({ overlay: { mode: "card", remember: false } });
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    await stops.pop()?.();
    expect(host()).toBeNull();
    expect(globalThis.__MOKU_GAME_OVERLAY__).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("overlay app types", () => {
  it("app.overlay is the OverlayApi and pluginConfigs.overlay a partial Config", () => {
    const app = framework.createApp({ pluginConfigs: { registry: { game: game.app } } });
    expectTypeOf(app.overlay).toEqualTypeOf<OverlayApi>();
    expect(() =>
      framework.createApp({
        // @ts-expect-error — "top" is not an edge
        pluginConfigs: { registry: { game: game.app }, overlay: { dock: "top" } }
      })
    ).toThrow(TypeError);
    expect(app.overlay.mode()).toBe("hidden");
  });
});
