// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableIframePageLoading":true}}
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceApi } from "../../api";
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
        device: { preset: "pixel-8", orientation: "landscape" }
      })
    );
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
      "palette",
      "registry",
      "stepPopover"
    ]);
    expect(ctx.state.palette.items.has("cmd:step")).toBe(true);
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

  it("⌘2 / Ctrl+2 and bare 2 show Game; 1 goes back to Flow", () => {
    const event = press("2", { metaKey: true, ctrlKey: true, code: "Digit2" });
    expect(ctx.state.active).toBe("game");
    expect(event.defaultPrevented).toBe(true);
    press("1", { code: "Digit1" });
    expect(ctx.state.active).toBe("flow");
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
    expect(ctx.link.run).toHaveBeenLastCalledWith("editor.overlay", { on: true });
  });

  it("G shows and hides the preview of the current workspace and is a no-op in Game", () => {
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
    expect(ctx.link.manifestListeners.size).toBe(1);

    stopWorkspace(ctx);
    expect(remove.mock.calls.map(call => call[0])).toEqual(expect.arrayContaining(added));
    expect(removeDocument.mock.calls.map(call => call[0])).toContain("scroll");
    expect(ctx.link.manifestListeners.size).toBe(0);
    expect(ctx.state.dom.cleanup).toEqual([]);
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
    expect(ctx.link.run).toHaveBeenCalledWith("editor.overlay", { on: true });
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
