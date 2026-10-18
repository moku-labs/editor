// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"navigation":{"disableChildFrameNavigation":true}}}
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceApi } from "../../api";
import { createHandlers } from "../../handlers";
import { initWorkspace, startWorkspace, stopWorkspace, validateConfig } from "../../lifecycle";
import { createCtx, flush, keyEvent, manifestOf, type TestCtx } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// onInit (validation, prefs, OS theme, hash, built-ins), onStart (listeners,
// manifest), onStop (every cleanup, timers, shell, frame layer, hosts)
// ─────────────────────────────────────────────────────────────────────────────

let ctx: TestCtx;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  history.replaceState(history.state, "", "/__editor");
  ctx = createCtx();
});

afterEach(() => {
  stopWorkspace(ctx);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  delete document.documentElement.dataset.density;
});

/**
 * Presses a key on window.
 *
 * @param key - `event.key`.
 * @param init - Modifiers.
 * @returns The event.
 */
function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = keyEvent(key, init);
  globalThis.dispatchEvent(event);
  return event;
}

describe("validateConfig", () => {
  it("accepts the defaults", () => {
    expect(() => validateConfig(ctx.config)).not.toThrow();
  });

  it.each([
    [{ defaultWorkspace: "nope" }, "defaultWorkspace"],
    [{ storageKey: "" }, "storageKey"],
    [{ reloadTimeoutMs: 0 }, "reloadTimeoutMs"],
    [{ hotReloadWaitMs: 0 }, "hotReloadWaitMs"],
    [{ hotReloadWaitMs: Number.POSITIVE_INFINITY }, "hotReloadWaitMs"],
    [{ toastMs: -1 }, "toastMs"],
    [{ toastMs: Number.NaN }, "toastMs"]
  ])("rejects %o naming workspace.%s", (patch, field) => {
    const config = { ...ctx.config, ...patch } as typeof ctx.config;
    expect(() => validateConfig(config)).toThrow(
      new RegExp(String.raw`^\[moku-editor\] workspace\.${field} is invalid\.\n  .+\.$`)
    );
  });
});

describe("initWorkspace", () => {
  it("loads prefs, reads the OS theme and the hash", () => {
    localStorage.setItem(
      "moku-editor-test",
      JSON.stringify({
        v: 1,
        theme: "dark",
        previews: { flow: { visible: false, size: "M", corner: "top-left" } },
        device: { preset: "pixel-8", orientation: "landscape" },
        density: "auto",
        showTaps: false,
        muted: true,
        copyOnSelect: false
      })
    );
    vi.stubGlobal("innerWidth", 720);
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
    );
    history.replaceState(history.state, "", "/__editor#console");

    initWorkspace(ctx);
    expect(ctx.state.theme).toEqual({ chosen: "dark", os: "dark" });
    expect(ctx.state.previews.flow).toEqual({ visible: false, size: "M", corner: "top-left" });
    expect(ctx.state.device).toEqual({ preset: "pixel-8", orientation: "landscape" });
    expect(ctx.state.active).toBe("console");
    expect(ctx.state.overlayInGame).toBe(false);
    expect(ctx.state.density).toEqual({ chosen: "auto", applied: "compact" });
    expect(ctx.state.showTaps).toBe(false);
    expect(ctx.state.muted).toBe(true);
    expect(ctx.state.copyOnSelect).toBe(false);
  });

  it("starts in Game without a hash, with Copy on select on", () => {
    initWorkspace(ctx);
    expect(ctx.state.active).toBe("game");
    expect(ctx.state.copyOnSelect).toBe(true);
  });

  it("a stored record without copyOnSelect loads it as on (U5)", () => {
    localStorage.setItem(
      "moku-editor-test",
      JSON.stringify({
        v: 1,
        previews: {},
        device: { preset: "pixel-8", orientation: "portrait" },
        muted: true
      })
    );
    initWorkspace(ctx);
    expect(ctx.state.muted).toBe(true);
    expect(ctx.state.copyOnSelect).toBe(true);
    expect(ctx.log.warn).not.toHaveBeenCalled();
  });

  it("ignores an unknown hash and keeps defaultWorkspace", () => {
    history.replaceState(history.state, "", "/__editor#nope");
    const other = createCtx({ defaultWorkspace: "state" });
    initWorkspace(other);
    expect(other.state.active).toBe("state");
  });

  it("registers the built-in keys, Esc layers and palette commands", () => {
    initWorkspace(ctx);
    expect(ctx.state.keys.bindings.length).toBeGreaterThanOrEqual(10);
    expect(ctx.state.keys.escape.map(entry => entry.layer).toSorted()).toEqual([
      "contextMenu",
      "contextMenu",
      "contextMenu",
      "palette",
      "registry",
      "stepPopover"
    ]);
    expect(ctx.state.palette.items.has("cmd:step")).toBe(true);
    expect(ctx.state.palette.items.has("cmd:copy-on-select")).toBe(true);
    expect(ctx.state.palette.items.has("cmd:reference")).toBe(false);
    expect(ctx.state.palette.items.has("workspace:density-compact")).toBe(true);
  });

  it("throws on an invalid config before touching state", () => {
    const bad = createCtx({ toastMs: 0 });
    expect(() => initWorkspace(bad)).toThrow("[moku-editor] workspace.toastMs is invalid.");
    expect(bad.state.keys.bindings).toEqual([]);
  });
});

describe("startWorkspace — keys", () => {
  beforeEach(() => {
    initWorkspace(ctx);
    startWorkspace(ctx);
  });

  it("⌘2 / Ctrl+2 and bare 2 show Flow; 1 goes back to Game", () => {
    const event = press("2", { metaKey: true, ctrlKey: true, code: "Digit2" });
    expect(ctx.state.active).toBe("flow");
    expect(event.defaultPrevented).toBe(true);
    press("1", { code: "Digit1" });
    expect(ctx.state.active).toBe("game");
    press("6", { code: "Digit6" });
    expect(ctx.state.active).toBe("console");
  });

  it("⌘K toggles the palette, also from an input; Esc closes it", () => {
    press("k", { metaKey: true, ctrlKey: true });
    expect(ctx.state.palette.open).toBe(true);
    press("Escape");
    expect(ctx.state.palette.open).toBe(false);
  });

  it("'.' steps only while paused; P pauses and resumes; O switches the overlay", async () => {
    press(".");
    expect(ctx.link.run).not.toHaveBeenCalled();

    ctx.state.link = { kind: "paused", frame: 5 };
    press(".");
    await flush();
    expect(ctx.link.run).toHaveBeenCalledWith("game.step", { frames: 1 });
    expect(ctx.emit).toHaveBeenCalledWith(
      "workspace:ran",
      expect.objectContaining({ id: "game.step", origin: "key" })
    );

    press("p");
    await flush();
    expect(ctx.link.run).toHaveBeenLastCalledWith("game.resume", undefined);

    ctx.state.link = { kind: "live", frame: 6 };
    press("p");
    await flush();
    expect(ctx.link.run).toHaveBeenLastCalledWith("game.pause", undefined);

    ctx.link.manifestValue = manifestOf();
    press("o");
    await flush();
    expect(ctx.state.overlayInGame).toBe(true);
    expect(ctx.link.run).toHaveBeenLastCalledWith("editor.overlay", { mode: "card" });
  });

  it("R is a free key (D-65): the press runs nothing, emits nothing and is left to the page", () => {
    const version = ctx.state.ui.version;
    const event = press("r");
    expect(event.defaultPrevented).toBe(false);
    expect(ctx.emit).not.toHaveBeenCalled();
    expect(ctx.state.ui.version).toBe(version);
    const bound = ctx.state.keys.bindings.flatMap(entry => entry.combos.map(combo => combo.key));
    expect(bound).not.toContain("r");
    expect(bound).toContain("h");
  });

  it("Esc with nothing open closes nothing: no layer is left over from Reference mode", () => {
    const event = press("Escape");
    expect(event.defaultPrevented).toBe(false);
    expect(ctx.emit).not.toHaveBeenCalled();
    expect(ctx.state.keys.escape.map(entry => entry.layer)).not.toContain("reference");
  });

  it("G shows and hides the preview of the current workspace and is a no-op in Game", () => {
    ctx.state.active = "flow";
    press("g");
    expect(ctx.state.previews.flow.visible).toBe(false);
    press("g");
    expect(ctx.state.previews.flow.visible).toBe(true);
    ctx.state.active = "game";
    press("g");
    expect(ctx.state.previews.flow.visible).toBe(true);
  });

  it("Esc closes the step popover, then the registry, one per press", () => {
    ctx.state.popover = "registry";
    press("Escape");
    expect(ctx.state.popover).toBeUndefined();
    ctx.state.popover = "step";
    press("Escape");
    expect(ctx.state.popover).toBeUndefined();
    ctx.state.popover = "session";
    press("Escape");
    expect(ctx.state.popover).toBeUndefined();
    ctx.state.popover = "more";
    press("Escape");
    expect(ctx.state.popover).toBeUndefined();
  });

  it("H asks the bin to switch hot reload; a failed switch toasts how to change it", async () => {
    ctx.link.hotReload.mockReturnValue({ hmr: true, owner: "bin" });
    press("h");
    await flush();
    expect(ctx.link.setHotReload).toHaveBeenCalledWith(false);
    expect(ctx.state.toasts.map(toast => toast.message)).toEqual([
      "Could not switch · start the bin with --no-hmr to turn hot reload off"
    ]);
  });
});

describe("startWorkspace — listeners", () => {
  it("adds window listeners and the manifest listener; onStop removes all of them", () => {
    const add = vi.spyOn(globalThis, "addEventListener");
    const remove = vi.spyOn(globalThis, "removeEventListener");
    const addDocument = vi.spyOn(document, "addEventListener");
    const removeDocument = vi.spyOn(document, "removeEventListener");
    initWorkspace(ctx);
    startWorkspace(ctx);

    const added = add.mock.calls.map(call => call[0]);
    expect(added).toEqual(expect.arrayContaining(["keydown", "resize"]));
    expect(addDocument.mock.calls.map(call => call[0])).toContain("scroll");
    expect(ctx.link.manifestListeners.size).toBe(2);
    expect(ctx.link.onHotReload).toHaveBeenCalledTimes(1);
    const offHotReload = ctx.link.onHotReload.mock.results[0]?.value;

    stopWorkspace(ctx);
    expect(offHotReload).toHaveBeenCalledTimes(1);
    expect(remove.mock.calls.map(call => call[0])).toEqual(expect.arrayContaining(added));
    expect(removeDocument.mock.calls.map(call => call[0])).toContain("scroll");
    expect(ctx.link.manifestListeners.size).toBe(0);
    expect(ctx.state.dom.cleanup).toEqual([]);
  });

  it("subscribes to link taps once; a tap draws a ripple while docked; onStop clears it", () => {
    initWorkspace(ctx);
    startWorkspace(ctx);
    const api = createWorkspaceApi(ctx);
    const root = document.createElement("div");
    document.body.append(root);
    api.mount(root);
    expect(ctx.link.onTap).toHaveBeenCalledTimes(1);
    ctx.state.frame.box = { left: 0, top: 0, width: 393, height: 852, scale: 1, docked: "stage" };

    ctx.link.tap({ x: 12, y: 34, at: 1 });
    expect(document.querySelectorAll("[data-frame-overlay] [data-tap-ripple]")).toHaveLength(1);

    stopWorkspace(ctx);
    expect(ctx.link.tapListeners.size).toBe(0);
    expect(ctx.state.taps).toEqual([]);
  });

  it("a new session that restored its state across Bun's reload toasts it once", () => {
    initWorkspace(ctx);
    startWorkspace(ctx);
    const restored = { bookmark: "{}", frame: 12 };
    ctx.link.attach({ ...manifestOf(), restored });
    ctx.link.attach({ ...manifestOf(), restored });
    expect(ctx.state.toasts.map(toast => toast.message)).toEqual([
      "Game reloaded · state restored"
    ]);
  });

  it("resize re-evaluates the auto density and emits workspace:density on a change", () => {
    vi.stubGlobal("innerWidth", 1440);
    initWorkspace(ctx);
    startWorkspace(ctx);
    expect(ctx.state.density.applied).toBe("comfortable");

    vi.stubGlobal("innerWidth", 480);
    globalThis.dispatchEvent(new Event("resize"));
    expect(ctx.state.density.applied).toBe("compact");
    expect(document.documentElement.dataset.density).toBe("compact");
    expect(ctx.emit).toHaveBeenCalledWith("workspace:density", { density: "compact" });
  });

  it("a manifest marks everLive, bumps the UI and re-applies the overlay while on", async () => {
    initWorkspace(ctx);
    startWorkspace(ctx);
    ctx.state.overlayInGame = true;
    const version = ctx.state.ui.version;

    ctx.link.attach(manifestOf());
    await flush();
    expect(ctx.state.everLive).toBe(true);
    expect(ctx.state.ui.version).toBeGreaterThan(version);
    expect(ctx.link.run).toHaveBeenCalledWith("editor.overlay", { mode: "card" });
  });

  it("resize bumps the UI; an OS theme change updates the theme while none is chosen", () => {
    let fire: ((event: { matches: boolean }) => void) | undefined;
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        addEventListener: (_type: string, fn: (event: { matches: boolean }) => void) => {
          fire = fn;
        },
        removeEventListener: vi.fn()
      }))
    );
    initWorkspace(ctx);
    startWorkspace(ctx);
    const prefs = vi.fn();
    createWorkspaceApi(ctx).onPrefs(prefs);

    const version = ctx.state.ui.version;
    globalThis.dispatchEvent(new Event("resize"));
    expect(ctx.state.ui.version).toBe(version + 1);

    fire?.({ matches: true });
    expect(ctx.state.theme.os).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(prefs).toHaveBeenCalledWith(expect.objectContaining({ theme: "dark" }));

    ctx.state.theme.chosen = "light";
    fire?.({ matches: false });
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});

describe("startWorkspace — scenarios and the engine fingerprint", () => {
  it("the first open socket lists the scenarios once", async () => {
    const hooks = createHandlers(ctx);
    vi.mocked(ctx.link.files.list).mockResolvedValue([
      { path: "tests/scenarios/full.ts", kind: "file", size: 9 }
    ]);

    hooks["link:status"]({ status: { kind: "connecting" } });
    expect(ctx.link.files.list).not.toHaveBeenCalled();
    hooks["link:status"]({ status: { kind: "empty" } });
    hooks["link:status"]({ status: { kind: "live", frame: 1 }, session: "s-1" });
    await flush();
    hooks["link:status"]({ status: { kind: "live", frame: 2 }, session: "s-1" });

    expect(ctx.link.files.list).toHaveBeenCalledTimes(1);
    expect(ctx.link.files.list).toHaveBeenCalledWith("tests/scenarios");
    expect(createWorkspaceApi(ctx).scenarios().scenarios).toEqual(["full"]);
  });

  it("a lost socket lists nothing until it opens", () => {
    const hooks = createHandlers(ctx);

    hooks["link:status"]({
      status: { kind: "lost", reason: "socket_closed", lastFrame: 0, retryInMs: 1000 }
    });

    expect(ctx.link.files.list).not.toHaveBeenCalled();
  });

  it("the engine fingerprint bumps the top bar; onStop drops the listener", () => {
    initWorkspace(ctx);
    startWorkspace(ctx);
    const version = ctx.state.ui.version;

    ctx.link.publishEngine("0.14.13+1ab7f2");
    expect(ctx.state.ui.version).toBeGreaterThan(version);

    stopWorkspace(ctx);
    expect(ctx.link.engineListeners.size).toBe(0);
  });
});

describe("stopWorkspace", () => {
  it("unrenders the shell, removes the frame layer and the hosts, clears timers", () => {
    initWorkspace(ctx);
    startWorkspace(ctx);
    const api = createWorkspaceApi(ctx);
    const root = document.createElement("div");
    document.body.append(root);
    api.mount(root);
    api.toast("hello");
    const toastTimer = ctx.state.toasts[0]?.timer;
    ctx.state.ticker = setInterval(() => {}, 1000);
    const ticker = ctx.state.ticker;
    const flow = api.host("flow");
    const clearTimer = vi.spyOn(globalThis, "clearTimeout");
    const clearTicker = vi.spyOn(globalThis, "clearInterval");

    expect(document.querySelectorAll("iframe[data-game-frame]")).toHaveLength(1);
    stopWorkspace(ctx);

    expect(root.childElementCount).toBe(0);
    expect(document.querySelectorAll("iframe[data-game-frame]")).toHaveLength(0);
    expect(document.querySelector("[data-frame-layer]")).toBeNull();
    expect(flow.isConnected).toBe(false);
    expect(ctx.state.dom.hosts.size).toBe(0);
    expect(ctx.state.toasts).toEqual([]);
    expect(ctx.state.ticker).toBeUndefined();
    expect(ctx.state.stopped).toBe(true);
    expect(clearTimer).toHaveBeenCalledWith(toastTimer);
    expect(clearTicker).toHaveBeenCalledWith(ticker);

    // a second stop is harmless; a late mount does nothing
    stopWorkspace(ctx);
    api.mount(root);
    expect(root.childElementCount).toBe(0);
  });
});
