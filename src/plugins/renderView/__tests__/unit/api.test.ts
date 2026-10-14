// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import type { ElementRef } from "../../../panels/shared/scene";
import { toWireValue } from "../../../registry/protocol";
import { createRenderViewApi } from "../../api";
import { createHandlers } from "../../handlers";
import { initRenderView, startRenderView, stopRenderView } from "../../lifecycle";
import { createRenderViewState, notify, subscribe } from "../../state";
import type { RenderSnapshot, RenderViewApi, TextureSortKey } from "../../types";
import { startScene } from "../../watch";
import { DEVICE, deviceSession, spikesOf, windowWire, wireJson } from "../device-fixtures";
import {
  ASSETS,
  CONFIG,
  createCtx,
  deliverBoard,
  type FrameQueue,
  flush,
  GAME_01_SOURCES,
  manifestOf,
  RENDER,
  serveManifest,
  stubFrames,
  type TestCtx
} from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// api.ts with a mock ctx (link, workspace, panels): refresh, snapshot, reveal,
// highlight, sortTextures, filterBundle; plus the state store and the lifecycle.
// ─────────────────────────────────────────────────────────────────────────────

let ctx: TestCtx;
let frames: FrameQueue;
let api: RenderViewApi;

const SLOT: ElementRef = { kind: "ui", path: "boardScreen/boardSlot" };
const CELL: ElementRef = { kind: "entity", id: 3_145_728 };

/** The pink box renderView draws into the overlay, if any. */
function box(): HTMLElement | null {
  return ctx.workspace.overlay.querySelector<HTMLElement>("[data-render='box'] [data-box]");
}

beforeEach(() => {
  ctx = createCtx();
  frames = stubFrames();
  api = createRenderViewApi(ctx);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("state", () => {
  it("starts sorted by GPU MB descending, all bundles, nothing open", () => {
    const state = createRenderViewState({ config: CONFIG });

    expect(state.table).toEqual({ sort: "gpuMb", dir: -1, bundle: "all", hover: undefined });
    expect(state.catalogue).toBeUndefined();
    expect(state.active).toBe(false);
  });

  it("notifies subscribers until they unsubscribe (idempotent)", () => {
    const state = createRenderViewState({ config: CONFIG });
    const listener = vi.fn();
    const off = subscribe(state, listener);

    notify(state);
    off();
    off();
    notify(state);

    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("refresh", () => {
  it("is skipped while the link is not live or paused", async () => {
    ctx.link.current = { kind: "silent", since: 1, lastFrame: 1840 };
    await api.refresh();

    expect(ctx.link.api.files.read).not.toHaveBeenCalled();
    expect(ctx.state.catalogue).toBeUndefined();
  });

  it("re-reads the catalogue and the calibration, and adds the Textures palette items", async () => {
    serveManifest(ctx);
    startScene(ctx);
    await deliverBoard(ctx, frames);
    vi.mocked(ctx.link.api.read).mockClear();

    ctx.link.current = { kind: "paused", frame: 1841 };
    await api.refresh();

    expect(ctx.state.catalogue?.path).toBe("manifest.json");
    expect(ctx.link.api.read).toHaveBeenCalledWith("game.rect", { key: "boardScreen" });
    expect(ctx.workspace.items.map(item => [item.group, item.label])).toEqual([
      ["Textures", "board.board-tray"],
      ["Textures", "board.cell"],
      ["Textures", "ui.hud-pill"],
      ["Textures", "home.bg"]
    ]);

    // A second refresh replaces the items, it does not add them twice.
    await api.refresh();
    expect(ctx.workspace.items).toHaveLength(4);
  });

  it("a palette item shows Render, filters its bundle and selects the node drawing it", async () => {
    serveManifest(ctx);
    startScene(ctx);
    await deliverBoard(ctx, frames);
    await api.refresh();

    ctx.workspace.items.find(item => item.label === "board.cell")?.run();

    expect(ctx.workspace.show).toHaveBeenCalledWith("render");
    expect(ctx.state.table.bundle).toBe("board");
    expect(ctx.state.tree.selected).toBe("entity:3145728");

    ctx.workspace.items.find(item => item.label === "home.bg")?.run();
    expect(ctx.state.table.bundle).toBe("home");
    expect(ctx.state.tree.selected).toBe("entity:3145728");
  });
});

describe("snapshot", () => {
  it("derives from the state and returns copies", () => {
    startRenderView(ctx);
    ctx.link.send("game.render", RENDER);
    ctx.link.send("game.assets", ASSETS);
    const first = api.snapshot();

    expectTypeOf(api.snapshot).returns.toEqualTypeOf<RenderSnapshot>();
    expect(first.tiles.fps).toEqual({ now: 60, samples: [60], low: 60 });
    expect(first.tiles.drawCalls).toEqual({ kind: "absent" });
    expect(first.bundles.map(row => row.name)).toEqual(["board", "ui"]);
    expect(first.frame).toBe(1841);
    expect(api.snapshot()).not.toBe(first);
  });
});

describe("reveal", () => {
  it("shows Render, opens the ancestors and selects the row", async () => {
    startScene(ctx);
    await deliverBoard(ctx, frames);

    api.reveal(CELL);

    expect(ctx.workspace.show).toHaveBeenCalledWith("render");
    expect(ctx.state.tree.selected).toBe("entity:3145728");
    expect(ctx.state.tree.open.has("ui:boardScreen/boardSlot")).toBe(true);
    expect(api.snapshot().tree.find(row => row.id === "entity:3145728")?.depth).toBe(2);
  });

  it("waits in pendingReveal until the first scene", async () => {
    api.reveal(SLOT);
    expect(ctx.state.pendingReveal).toEqual(SLOT);
    expect(ctx.state.tree.selected).toBeUndefined();

    startScene(ctx);
    await deliverBoard(ctx, frames);

    expect(ctx.state.pendingReveal).toBeUndefined();
    expect(ctx.state.tree.selected).toBe("ui:boardScreen/boardSlot");
    expect(ctx.state.tree.open.has("ui:boardScreen")).toBe(true);
  });

  it("waits when the element is not in the current scene, then selects it anyway", async () => {
    startScene(ctx);
    await deliverBoard(ctx, frames);
    const missing: ElementRef = { kind: "ui", path: "settings/close" };

    api.reveal(missing);
    expect(ctx.state.pendingReveal).toEqual(missing);

    await deliverBoard(ctx, frames);
    expect(ctx.state.pendingReveal).toBeUndefined();
    expect(ctx.state.tree.selected).toBe("ui:settings/close");
  });
});

describe("highlight", () => {
  it("renders the pink box into renderView's root in the overlay and clears it", async () => {
    startScene(ctx);
    await deliverBoard(ctx, frames);

    api.highlight(SLOT);
    const root = ctx.workspace.overlay.querySelector<HTMLElement>("[data-render='box']");
    expect(root).not.toBeNull();
    expect(box()?.style.left).toBe("55px");
    expect(box()?.style.top).toBe("801px");
    expect(box()?.style.width).toBe("970px");
    expect(box()?.style.height).toBe("970px");
    expect(ctx.state.box).toEqual(SLOT);

    api.highlight(undefined);
    expect(box()).toBeNull();
    expect(ctx.state.box).toBeUndefined();
  });

  it("draws nothing for a ref without a rect, an unknown ref or an uncalibrated scene", async () => {
    api.highlight(SLOT);
    expect(box()).toBeNull();

    startScene(ctx);
    await deliverBoard(ctx, frames);
    api.highlight({ kind: "entity", id: 1_048_640 });
    expect(box()).toBeNull();
    api.highlight({ kind: "ui", path: "nope" });
    expect(box()).toBeNull();
  });

  it("follows the element when a new scene arrives", async () => {
    startScene(ctx);
    await deliverBoard(ctx, frames);
    api.highlight(SLOT);
    ctx.state.calibration = { scale: 0.5, x: 10, y: 20 };
    await deliverBoard(ctx, frames);

    expect(box()?.style.left).toBe("37.5px");
  });

  it("onStop removes the overlay root", async () => {
    startScene(ctx);
    await deliverBoard(ctx, frames);
    api.highlight(SLOT);

    stopRenderView(ctx);

    expect(ctx.workspace.overlay.querySelector("[data-render='box']")).toBeNull();
    expect(ctx.state.overlayRoot).toBeUndefined();
  });
});

describe("sortTextures and filterBundle", () => {
  it("flip the same key, sort a new key, filter by bundle", () => {
    const listener = vi.fn();
    ctx.state.listeners.add(listener);

    api.sortTextures("gpuMb");
    expect(ctx.state.table).toMatchObject({ sort: "gpuMb", dir: 1 });
    api.sortTextures("key");
    expect(ctx.state.table).toMatchObject({ sort: "key", dir: 1 });
    api.filterBundle("ui");
    expect(ctx.state.table.bundle).toBe("ui");
    expect(listener).toHaveBeenCalledTimes(3);

    // @ts-expect-error — not a sort key
    api.sortTextures("nope");
    expectTypeOf(api.sortTextures).parameter(0).toEqualTypeOf<TextureSortKey>();
  });
});

describe("lifecycle", () => {
  it("onInit registers the Render panel without sources", () => {
    initRenderView(ctx);

    expect(ctx.registered.map(panel => [panel.id, panel.workspace, panel.sources])).toEqual([
      ["render", "render", {}]
    ]);
  });

  it("onStart starts the scene watches when Render is restored as the active workspace", async () => {
    ctx.workspace.activeValue = "render";
    startRenderView(ctx);
    await flush();

    expect(ctx.state.active).toBe(true);
    expect(ctx.link.active().map(record => record.id)).toEqual([
      "game.render",
      "game.assets",
      "game.ui",
      "game.entities",
      "game.projections"
    ]);
  });

  it("onStop removes the palette items", async () => {
    serveManifest(ctx);
    await api.refresh();
    expect(ctx.workspace.items).toHaveLength(4);

    stopRenderView(ctx);
    expect(ctx.workspace.items).toHaveLength(0);
  });
});

describe("the device strip api (spec 09 R5)", () => {
  const PERF = [
    "editor.perf.second",
    "editor.perf.window",
    "editor.perf.spikes",
    "editor.perf.spike"
  ];

  /**
   * Attaches a session (a phone when `device` is given) and shows Render.
   *
   * @param device - The phone, or undefined for a browser session.
   * @param sources - The manifest's sources.
   */
  function attachSession(
    device: typeof DEVICE | undefined,
    sources: readonly string[] = [...GAME_01_SOURCES, ...PERF]
  ): void {
    ctx.link.api.sessions = () => [deviceSession("s-1", device)];
    ctx.link.api.session = () => "s-1";
    ctx.link.manifestValue = manifestOf(sources);
    startRenderView(ctx);
    createHandlers(ctx)["workspace:changed"]({ ws: "render" });
    ctx.link.send("editor.perf.window", wireJson(windowWire()));
    ctx.link.send("editor.perf.spikes", toWireValue(spikesOf()));
  }

  it("device() is undefined for a session without editor.perf.second", () => {
    attachSession(DEVICE, GAME_01_SOURCES);

    expect(api.device()).toBeUndefined();
  });

  it("device() is defined for a browser session with perf, with link.kind 'browser'", () => {
    attachSession(undefined);

    expect(api.device()?.link).toEqual({ kind: "browser" });
    expect(api.device()?.counter).toBe("–/6");
  });

  it("device() returns copies: mutating it changes nothing", () => {
    attachSession(DEVICE);
    const view = api.device();
    if (view === undefined) throw new Error("no strip");

    Object.assign(view.spikes, { 0: { frame: 1, cause: "js" } });
    Object.assign(view.link, { kind: "lan" });

    expect(api.device()?.link.kind).toBe("adb");
    expect(api.device()?.spikes[0]?.frame).toBe(4572);
    expect(ctx.state.device.session?.device?.link).toBe("adb");
  });

  it("stepSpike, closeSpike and setMore change the state and notify the UI", () => {
    attachSession(DEVICE);
    const listener = vi.fn();
    subscribe(ctx.state, listener);

    expect(api.stepSpike(1)).toBe(4572);
    expect(api.device()?.selected).toBe(4572);
    expect(api.device()?.record).toBe("loading");
    expect(api.stepSpike(-1)).toBe(4845);
    api.closeSpike();
    expect(api.device()?.record).toBe("closed");
    expect(api.device()?.selected).toBe(4845);
    api.setMore(false);
    expect(api.device()?.more).toBe(false);
    expect(listener).toHaveBeenCalled();
  });

  it("without a strip stepSpike and openSpike change nothing", async () => {
    attachSession(DEVICE, GAME_01_SOURCES);

    expect(api.stepSpike(1)).toBeUndefined();
    await api.openSpike(4812);
    expect(ctx.link.api.read).not.toHaveBeenCalledWith("editor.perf.spike", expect.anything());
  });

  it("onStart re-renders the strip when the computer's engine arrives; onStop drops it", () => {
    const listeners: (() => void)[] = [];
    ctx.link.api.onEngine = vi.fn((listener: (engine: string) => void) => {
      const entry = (): void => listener("0.14.13+1ab7f2");
      listeners.push(entry);
      return () => {
        listeners.splice(listeners.indexOf(entry), 1);
      };
    });
    attachSession(DEVICE);
    const ui = vi.fn();
    subscribe(ctx.state, ui);

    for (const listener of listeners) listener();
    expect(ui).toHaveBeenCalled();

    stopRenderView(ctx);
    expect(listeners).toEqual([]);
    expect(ctx.state.device.watches).toEqual([]);
  });
});
