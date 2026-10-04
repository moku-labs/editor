// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sidePanelState } from "../../../panels/shared/side-panel";
import { DEVICES } from "../../../workspace/devices";
import { initGameView, startGameView, stopGameView } from "../../lifecycle";
import { createCtx, flush, manifestOf, type TestCtx, useScene } from "../helpers";

let ctx: TestCtx;

/**
 * The palette item with a label.
 *
 * @param label - The label.
 * @returns The item.
 */
function item(label: string) {
  const found = ctx.workspace.items.find(entry => entry.label === label);
  if (found === undefined) throw new Error(`no item ${label}`);
  return found;
}

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  ctx = createCtx();
  useScene(ctx);
});

afterEach(() => {
  stopGameView(ctx);
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("initGameView", () => {
  it("registers the Game panel: source game.position, the three commands", () => {
    initGameView(ctx);
    const [panel] = ctx.panels.registered;
    expect(panel).toMatchObject({
      id: "game",
      title: "Game",
      workspace: "game",
      sources: { position: "game.position" },
      commands: {
        capture: "editor.capture",
        series: "editor.series",
        seriesStop: "editor.seriesStop"
      }
    });
  });

  it("adds palette items for the picker, screenshot, series, overlay, the Element panel and every device", () => {
    initGameView(ctx);
    expect(ctx.workspace.items.map(entry => entry.label)).toEqual([
      "Select element",
      "Take a screenshot",
      "Record a series…",
      "Overlay in game",
      "Show Element panel",
      ...DEVICES.map(device => `Device: ${device.name}`)
    ]);
    expect(item("Select element").shortcut).toBe("⇧⌘C");
  });

  it("palette items run the picker, the screenshot, the series popover, the overlay and the device", async () => {
    initGameView(ctx);
    item("Select element").run();
    expect(ctx.state.picker.on).toBe(true);
    item("Take a screenshot").run();
    await flush();
    expect(ctx.panels.run).toHaveBeenCalledWith("editor.capture");
    item("Record a series…").run();
    expect(ctx.state.series.popover).toBe(true);
    expect(ctx.workspace.show).toHaveBeenCalledWith("game");
    item("Overlay in game").run();
    expect(ctx.workspace.setOverlayInGame).toHaveBeenCalledWith(true);
    localStorage.setItem("moku-editor:panel:game.side", JSON.stringify({ closed: true }));
    expect(sidePanelState("game.side").closed).toBe(true);
    ctx.workspace.show.mockClear();
    item("Show Element panel").run();
    expect(ctx.workspace.show).toHaveBeenCalledWith("game");
    expect(sidePanelState("game.side").closed).toBe(false);
    expect(item("Show Element panel").shortcut).toBe("\\");
    ctx.workspace.device.orientation = "landscape";
    item("Device: Pixel 8").run();
    expect(ctx.workspace.api.setDevice).toHaveBeenCalledWith({
      preset: "pixel-8",
      orientation: "portrait"
    });
  });

  it("disables the screenshot, series and overlay items without the game's commands", () => {
    initGameView(ctx);
    expect(item("Take a screenshot").disabled?.()).toBe(false);
    ctx.link.manifestValue = manifestOf([]);
    expect(item("Take a screenshot").disabled?.()).toBe("The game did not add capturePlugin");
    expect(item("Record a series…").disabled?.()).toBe("The game did not add capturePlugin");
    expect(item("Overlay in game").disabled?.()).toBe("The game did not add the overlay");
  });

  it("binds the keys and the four Esc layers; every remover goes into the disposers", () => {
    initGameView(ctx);
    expect(ctx.workspace.bindings).toHaveLength(6);
    expect(ctx.workspace.escapes.map(entry => entry.layer)).toEqual([
      "contactSheet",
      "seriesPopover",
      "captureCard",
      "picker"
    ]);
    expect(ctx.state.disposers.length).toBeGreaterThanOrEqual(10);
  });

  it("does no I/O", () => {
    initGameView(ctx);
    expect(ctx.link.read).not.toHaveBeenCalled();
    expect(ctx.link.watch).not.toHaveBeenCalled();
    expect(ctx.panels.run).not.toHaveBeenCalled();
    expect(ctx.link.files.writes).toEqual([]);
  });

  it("re-calibrates after a device change, not after other preference changes", async () => {
    initGameView(ctx);
    startGameView(ctx);
    ctx.workspace.activeValue = "game";
    ctx.state.calibrationRead = true;

    ctx.workspace.changeDevice("iphone-15", "portrait");
    expect(ctx.state.calibrationRead).toBe(true);

    ctx.workspace.changeDevice("pixel-8", "portrait");
    expect(ctx.state.calibrationRead).toBe(false);
  });

  it("re-calibrates after a fold: the same preset on its other screen", () => {
    ctx.workspace.device = { preset: "galaxy-z-fold-6", orientation: "portrait" };
    initGameView(ctx);
    startGameView(ctx);
    ctx.state.calibrationRead = true;

    ctx.workspace.changeDevice("galaxy-z-fold-6", "portrait", true);
    expect(ctx.state.calibrationRead).toBe(true);

    ctx.workspace.changeDevice("galaxy-z-fold-6", "portrait", false);
    expect(ctx.state.calibrationRead).toBe(false);
  });

  it.each([
    ".moku/captures",
    ".moku/captures/picks",
    ".moku/captures/a/b"
  ])("accepts capturesDir %s", capturesDir => {
    expect(() => initGameView({ ...ctx, config: { ...ctx.config, capturesDir } })).not.toThrow();
    stopGameView(ctx);
  });

  it.each([
    "captures",
    ".moku/capturesX",
    ".moku",
    "/srv/captures",
    "../.moku/captures"
  ])("refuses capturesDir %s with the startup error", capturesDir => {
    expect(() => initGameView({ ...ctx, config: { ...ctx.config, capturesDir } })).toThrow(
      '[moku-editor] gameView.capturesDir must be .moku/captures or a folder under it.\n  Set pluginConfigs.gameView.capturesDir to ".moku/captures/<sub>".'
    );
    expect(ctx.panels.registered).toEqual([]);
  });
});

describe("startGameView", () => {
  it("starts the scene watches when Game is already active (restored #game)", () => {
    ctx.workspace.activeValue = "game";
    startGameView(ctx);
    expect(ctx.link.active().map(record => record.id)).toEqual([
      "game.ui",
      "game.entities",
      "game.projections"
    ]);
  });

  it("mutes the attached game again when the viewer has the sound off (round 2b R11)", async () => {
    ctx.workspace.mutedValue = true;
    ctx.link.manifestValue = manifestOf([["game.mute", "cosmetic"]]);
    startGameView(ctx);
    await flush();
    expect(ctx.panels.run).toHaveBeenCalledWith("game.mute", { muted: true });
  });

  it("does not watch while another workspace is active", () => {
    startGameView(ctx);
    expect(ctx.link.watch).not.toHaveBeenCalled();
  });
});

describe("stopGameView", () => {
  it("runs the disposers and every unwatch, clears the timers and stops a recording", () => {
    initGameView(ctx);
    ctx.workspace.activeValue = "game";
    startGameView(ctx);
    ctx.state.timers.card = setTimeout(() => {}, 10_000);
    ctx.state.series.recording = {
      folder: "f/",
      label: "a",
      startedAt: 0,
      durationMs: 2000,
      intervalMs: 100,
      planned: 20,
      phase: "recording",
      written: 0,
      stopRequested: false
    };

    stopGameView({ state: ctx.state });

    expect(ctx.workspace.items).toEqual([]);
    expect(ctx.workspace.bindings).toEqual([]);
    expect(ctx.workspace.escapes).toEqual([]);
    expect(ctx.link.active()).toEqual([]);
    expect(ctx.state.disposers).toEqual([]);
    expect(ctx.state.timers).toEqual({});
    expect(ctx.state.series.recording?.stopRequested).toBe(true);
  });
});
