// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startOverlay, startOverlayWith, stopOverlay } from "../../lifecycle";
import { openOverlay } from "../../modes";
import { overlayCss } from "../../styles";
import type { TestOctx } from "../helpers";
import { createOctx, pluginCtxOf } from "../helpers";

/**
 * Mounts a test context the way onStart does (the old `mountOverlay`).
 *
 * @param octx - The test context.
 * @param hasBridge - Whether the bridge is composed.
 * @param doc - The document; globalThis.document by default.
 */
function mountOverlay(octx: TestOctx, hasBridge: boolean, doc?: Document): void {
  startOverlayWith(
    octx,
    hasBridge,
    doc ?? (typeof document === "undefined" ? undefined : document)
  );
}

/**
 * Unmounts the way onStop does.
 *
 * @param ctx - The teardown context.
 * @param ctx.state - Own state.
 */
function unmountOverlay(ctx: { state: TestOctx["state"] }): void {
  stopOverlay(ctx);
}

/**
 * The overlay host in the document.
 *
 * @returns The host, or null.
 */
function hostElement(): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[${HOST_ATTRIBUTE}]`);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "__MOKU_GAME_OVERLAY__");
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

import { HOST_ATTRIBUTE } from "../../types";

describe("mountOverlay", () => {
  it("appends a hidden host with an open shadow root to body", () => {
    const octx = createOctx();

    mountOverlay(octx, false);

    const host = hostElement();
    expect(host?.parentElement).toBe(document.body);
    expect(host?.hidden).toBe(true);
    expect(host?.dataset.dock).toBe("right");
    expect(host?.dataset.mode).toBe("hidden");
    expect(host?.shadowRoot).toBe(octx.state.root);
    expect(octx.state.host).toBe(host);
    expect(octx.state.root?.querySelector<HTMLElement>("[data-overlay]")).toBeNull();
    expect(octx.state.root?.querySelectorAll("[data-safe-probe]")).toHaveLength(2);
    expect(octx.state.hasBridge).toBe(false);
  });

  it("appends to the mount selector and docks to config.dock", () => {
    const target = document.createElement("main");
    target.id = "game";
    document.body.append(target);
    const octx = createOctx({ mount: "#game", dock: "left", remember: false });

    mountOverlay(octx, true);
    openOverlay(octx);

    expect(hostElement()?.parentElement).toBe(target);
    expect(hostElement()?.dataset.dock).toBe("left");
    expect(octx.state.hasBridge).toBe(true);
    expect(octx.state.root?.querySelector<HTMLElement>("[data-link]")?.dataset.link).toBe("dev");
  });

  it("warns and uses body when the selector matches nothing", () => {
    const octx = createOctx({ mount: "#missing" });

    mountOverlay(octx, false);

    expect(hostElement()?.parentElement).toBe(document.body);
    expect(octx.log.warn).toHaveBeenCalledWith("overlay:mount-missing", { mount: "#missing" });
  });

  it("adopts the stylesheet into the shadow root", () => {
    const octx = createOctx();

    mountOverlay(octx, false);

    const sheets = octx.state.root?.adoptedStyleSheets ?? [];
    expect(sheets).toHaveLength(1);
    expect(octx.state.root?.querySelector("style")).toBeNull();
  });

  it("falls back to a style element when replaceSync is missing", () => {
    vi.stubGlobal(
      "CSSStyleSheet",
      class {
        readonly cssRules = [];
      }
    );
    const octx = createOctx();

    mountOverlay(octx, false);

    expect(octx.state.root?.adoptedStyleSheets ?? []).toHaveLength(0);
    expect(octx.state.root?.querySelector("style")?.textContent).toBe(overlayCss);
  });

  it("falls back to a style element when CSSStyleSheet is missing", () => {
    vi.stubGlobal("CSSStyleSheet", undefined);
    const octx = createOctx();

    mountOverlay(octx, false);

    expect(octx.state.root?.querySelector("style")?.textContent).toBe(overlayCss);
  });

  it("keeps pointer and key events inside the card away from window", () => {
    const octx = createOctx();
    mountOverlay(octx, false);
    openOverlay(octx);
    const seen: string[] = [];
    const listener = (event: Event) => seen.push(event.type);
    const types = [
      "keydown",
      "pointerdown",
      "pointercancel",
      "click",
      "wheel",
      "contextmenu",
      "input"
    ];
    for (const type of types) globalThis.addEventListener(type, listener);

    const button = octx.state.root?.querySelector("button");
    button?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true })
    );
    button?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));
    button?.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, composed: true }));
    button?.dispatchEvent(new WheelEvent("wheel", { bubbles: true, composed: true }));
    button?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, composed: true }));
    button?.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));

    expect(seen).toEqual(["keydown"]);
    for (const type of types) globalThis.removeEventListener(type, listener);
  });

  it("warns and mounts nothing without a document", () => {
    vi.stubGlobal("document", undefined);
    const octx = createOctx();

    expect(() => mountOverlay(octx, false)).not.toThrow();

    expect(octx.log.warn).toHaveBeenCalledWith("overlay:no-dom");
    expect(octx.state.host).toBeUndefined();
    openOverlay(octx);
    expect(octx.state.mode).toBe("card");
  });

  it("uses the document it is given", () => {
    const octx = createOctx();

    mountOverlay(octx, false, document);

    expect(hostElement()).not.toBeNull();
  });
});

describe("unmountOverlay", () => {
  it("removes the host, the listener, the observers, the global and the interval", () => {
    const octx = createOctx();
    mountOverlay(octx, false);
    openOverlay(octx);
    const host = octx.state.host;
    const stopProbe = vi.fn();
    host?.addEventListener("keydown", stopProbe);

    unmountOverlay({ state: octx.state });

    expect(hostElement()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    expect(octx.state.host).toBeUndefined();
    expect(octx.state.root).toBeUndefined();
    expect(octx.state.isolate).toBeUndefined();
    expect(octx.state.tick).toBeUndefined();
    expect(octx.state.off).toEqual([]);
    expect(octx.state.channel).toBeUndefined();
    expect(globalThis.__MOKU_GAME_OVERLAY__).toBeUndefined();

    const seen = vi.fn();
    globalThis.addEventListener("keydown", seen);
    document.body.append(host as HTMLElement);
    host?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }));
    expect(seen).toHaveBeenCalledTimes(1);
    globalThis.removeEventListener("keydown", seen);
  });

  it("is safe when nothing was mounted", () => {
    const octx = createOctx();

    expect(() => unmountOverlay({ state: octx.state })).not.toThrow();
  });
});

describe("startOverlay", () => {
  it("mounts hidden and stays closed by default", () => {
    const octx = createOctx({ remember: false });

    startOverlay(pluginCtxOf(octx));

    expect(hostElement()?.hidden).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    stopOverlay({ state: octx.state });
  });

  it("opens when config.mode is visible", () => {
    const octx = createOctx({ mode: "card", remember: false });

    startOverlay(pluginCtxOf(octx, true));

    expect(hostElement()?.hidden).toBe(false);
    expect(octx.state.hasBridge).toBe(true);
    expect(vi.getTimerCount()).toBe(1);
    stopOverlay({ state: octx.state });
  });

  it("honours an open() called before start", () => {
    const octx = createOctx({ remember: false });
    openOverlay(octx);

    startOverlay(pluginCtxOf(octx));

    expect(hostElement()?.hidden).toBe(false);
    stopOverlay({ state: octx.state });
  });
});
