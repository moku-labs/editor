/* eslint-disable unicorn/no-null -- null is the wire value for "no input" */
import { defineCommand } from "@moku-labs/game/control";
import { Window } from "happy-dom";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { startTinyHeadless } from "../../../../../tests/fixtures/tiny-screen-game";
import { agentCoreConfig, createAgentCore, createAgentPlugin } from "../../../../config";
import { channelPlugin } from "../../../channel";
import { registryPlugin } from "../../../registry";
import type { DevModule, GameLike } from "../../../registry/types";
import { overlayPlugin } from "../..";
import type { Config, OverlayApi } from "../../types";
import { HOST_ATTRIBUTE } from "../../types";

// ─────────────────────────────────────────────────────────────────────────────
// The agent defaults (registry, channel, overlay) over the headless tiny game,
// with a dev module holding one one-click cheat and one cheat with required input.
// The DOM is a happy-dom Window stubbed onto the globals by hand, so the test
// runs in the node environment.
// ─────────────────────────────────────────────────────────────────────────────

const framework = createAgentCore(agentCoreConfig, {
  plugins: [registryPlugin, channelPlugin, overlayPlugin]
});

/** How many times the test cheat ran. */
let coinsAdded = 0;

/** The dev module of the test. */
const devModule: DevModule = {
  commands: [
    defineCommand({
      id: "test.addCoins",
      title: "Add 100 coins",
      input: {},
      effect: "cheat",
      run: () => {
        coinsAdded += 1;
        return coinsAdded;
      }
    }),
    defineCommand({
      id: "test.setCoins",
      title: "Set coins",
      input: { amount: "number" },
      effect: "cheat",
      run: (_app: GameLike, { amount }) => amount
    })
  ]
};

/** A started headless tiny game. */
type StartedGame = { readonly app: GameLike; stop(): Promise<void> };

let game: StartedGame;
let dom: Window;

/**
 * Creates and starts the editor app over the game.
 *
 * @param overlay - Overlay config overrides.
 * @returns The started app.
 */
async function startEditor(overlay: Partial<Config> = {}) {
  const app = framework.createApp({
    pluginConfigs: { registry: { game: game.app, modules: [devModule] }, overlay }
  });
  await app.start();
  return app;
}

/**
 * The overlay host in the document.
 *
 * @returns The host, or null.
 */
function hostElement(): HTMLElement | null {
  return dom.document.querySelector(`[${HOST_ATTRIBUTE}]`) as HTMLElement | null;
}

/**
 * The overlay's shadow root.
 *
 * @returns The root.
 */
function shadow(): ShadowRoot {
  const root = hostElement()?.shadowRoot;
  if (!root) throw new Error("no overlay root");
  return root;
}

beforeEach(async () => {
  coinsAdded = 0;
  vi.stubGlobal("__MOKU_GAME_DEV__", true);
  game = await startTinyHeadless();
  dom = new Window();
  vi.stubGlobal("document", dom.document);
  vi.stubGlobal("CSSStyleSheet", dom.CSSStyleSheet);
});

afterEach(async () => {
  vi.useRealTimers();
  await game.stop();
  vi.unstubAllGlobals();
  await dom.happyDOM.close();
});

describe("overlay integration", () => {
  it("is off by default: hidden host, closed, no dot, no render watch", async () => {
    const app = await startEditor();

    expect(hostElement()?.hidden).toBe(true);
    expect(app.overlay.isOpen()).toBe(false);
    expect(shadow().querySelector<HTMLElement>("[data-dot]")).toBeNull();
    expect(app.log.trace().some(entry => entry.event === "overlay:render-unavailable")).toBe(false);
    expect(app.registry.manifest().commands.some(c => c.id === "editor.overlay")).toBe(true);
    await app.stop();
  });

  it("editor.overlay { on: true } → one cheat button, render —, cheat taints the game", async () => {
    const app = await startEditor();

    const result = await app.channel.run("editor.overlay", { on: true });

    expect(result.value).toEqual({ on: true });
    expect(result.state).toEqual(app.registry.envelope());
    expect(app.overlay.isOpen()).toBe(true);
    expect(hostElement()?.hidden).toBe(false);
    const buttons = shadow().querySelectorAll<HTMLButtonElement>("button[data-cheat]");
    expect([...buttons].map(button => button.dataset.cheat)).toEqual(["test.addCoins"]);
    expect(shadow().querySelector("[data-chip]")?.textContent).toBe("render —");
    const warns = app.log.trace().filter(entry => entry.event === "overlay:render-unavailable");
    expect(warns).toHaveLength(1);

    buttons[0]?.click();
    await vi.waitFor(() => {
      expect(
        shadow().querySelector<HTMLElement>('[data-cheat="test.addCoins"]')?.dataset.state
      ).toBe("ok");
    });

    expect(coinsAdded).toBe(1);
    expect(app.registry.source("game.tainted")?.read(null)).toBe(true);
    expect(shadow().querySelector("[data-announce]")?.textContent).toBe(
      "Cheat sent: Add 100 coins"
    );

    await app.channel.run("editor.overlay", { on: false });
    expect(hostElement()?.hidden).toBe(true);
    await app.stop();
  });

  it("a QA build opens at start in its corner", async () => {
    const app = await startEditor({ open: true, corner: "bottom-left" });

    expect(app.overlay.isOpen()).toBe(true);
    expect(hostElement()?.hidden).toBe(false);
    expect(hostElement()?.dataset.corner).toBe("bottom-left");
    expect(shadow().querySelector<HTMLElement>("[data-overlay]")?.dataset.corner).toBe(
      "bottom-left"
    );
    await app.stop();
  });

  it("shows the link dot fed by the global bridge:status when a bridge is composed", async () => {
    const bridgeStub = createAgentPlugin("bridge", {
      onStart: async ctx => {
        await ctx.emit("bridge:status", { status: { kind: "live", frame: 12 } });
      }
    });
    const withBridge = createAgentCore(agentCoreConfig, {
      plugins: [registryPlugin, channelPlugin, overlayPlugin, bridgeStub]
    });
    const app = withBridge.createApp({
      pluginConfigs: { registry: { game: game.app, modules: [devModule] }, overlay: { open: true } }
    });
    await app.start();

    const dot = shadow().querySelector<HTMLElement>("[data-dot]");
    expect(dot?.dataset.kind).toBe("live");
    expect(dot?.getAttribute("aria-label")).toBe("Editor live · frame 12");
    await app.stop();
  });

  it("stop removes the host and leaves no timer", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    const app = await startEditor({ open: true });

    await app.stop();

    expect(hostElement()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("overlay app types", () => {
  it("app.overlay is the OverlayApi and pluginConfigs.overlay a partial Config", () => {
    const app = framework.createApp({ pluginConfigs: { registry: { game: game.app } } });

    expectTypeOf(app.overlay).toEqualTypeOf<OverlayApi>();
    framework.createApp({
      // @ts-expect-error — "center" is not a corner
      pluginConfigs: { registry: { game: game.app }, overlay: { corner: "center" } }
    });
  });
});
