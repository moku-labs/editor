// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openOverlay } from "../../api";
import { mountOverlay, startOverlay, unmountOverlay } from "../../mount";
import { overlayCss } from "../../styles";
import { HOST_ATTRIBUTE } from "../../types";
import { command, createOctx, pluginCtxOf } from "../helpers";

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
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("mountOverlay", () => {
  it("appends a hidden host with an open shadow root to body", () => {
    const octx = createOctx();

    mountOverlay(octx, false);

    const host = hostElement();
    expect(host?.parentElement).toBe(document.body);
    expect(host?.hidden).toBe(true);
    expect(host?.dataset.corner).toBe("top-right");
    expect(host?.shadowRoot).toBe(octx.state.root);
    expect(octx.state.host).toBe(host);
    expect(octx.state.root?.querySelector<HTMLElement>("[data-overlay]")).not.toBeNull();
    expect(octx.state.hasBridge).toBe(false);
    expect(octx.channel.opened).toBe(0);
  });

  it("appends to the mount selector and sets the corner", () => {
    const target = document.createElement("main");
    target.id = "game";
    document.body.append(target);
    const octx = createOctx({ mount: "#game", corner: "bottom-left" });

    mountOverlay(octx, true);

    expect(hostElement()?.parentElement).toBe(target);
    expect(hostElement()?.dataset.corner).toBe("bottom-left");
    expect(octx.state.hasBridge).toBe(true);
    expect(octx.state.root?.querySelector<HTMLElement>("[data-dot]")?.dataset.kind).toBe(
      "connecting"
    );
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
    const octx = createOctx({}, [command("a.cheat")]);
    mountOverlay(octx, false);
    openOverlay(octx);
    const seen: string[] = [];
    const listener = (event: Event) => seen.push(event.type);
    for (const type of ["keydown", "pointerdown", "click", "wheel"]) {
      globalThis.addEventListener(type, listener);
    }

    const button = octx.state.root?.querySelector("button");
    button?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true })
    );
    button?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));
    button?.dispatchEvent(new WheelEvent("wheel", { bubbles: true, composed: true }));
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));

    expect(seen).toEqual(["keydown"]);
    for (const type of ["keydown", "pointerdown", "click", "wheel"]) {
      globalThis.removeEventListener(type, listener);
    }
  });

  it("warns and mounts nothing without a document", () => {
    vi.stubGlobal("document", undefined);
    const octx = createOctx();

    expect(() => mountOverlay(octx, false)).not.toThrow();

    expect(octx.log.warn).toHaveBeenCalledWith("overlay:no-dom");
    expect(octx.state.host).toBeUndefined();
    openOverlay(octx);
    expect(octx.state.open).toBe(true);
  });

  it("uses the document it is given", () => {
    const octx = createOctx();

    mountOverlay(octx, false, document);

    expect(hostElement()).not.toBeNull();
  });
});

describe("unmountOverlay", () => {
  it("removes the host, the listener, the watch and the interval", () => {
    const octx = createOctx();
    mountOverlay(octx, false);
    openOverlay(octx);
    const host = octx.state.host;
    const stopProbe = vi.fn();
    host?.addEventListener("keydown", stopProbe);

    unmountOverlay({ state: octx.state });

    expect(hostElement()).toBeNull();
    expect(octx.channel.stopped).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(octx.state.host).toBeUndefined();
    expect(octx.state.root).toBeUndefined();
    expect(octx.state.isolate).toBeUndefined();
    expect(octx.state.paintTimer).toBeUndefined();
    expect(octx.state.stopRender).toBeUndefined();

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
    const octx = createOctx();

    startOverlay(pluginCtxOf(octx));

    expect(hostElement()?.hidden).toBe(true);
    expect(octx.channel.opened).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("opens when config.open is set", () => {
    const octx = createOctx({ open: true });

    startOverlay(pluginCtxOf(octx, true));

    expect(hostElement()?.hidden).toBe(false);
    expect(octx.state.hasBridge).toBe(true);
    expect(octx.channel.opened).toBe(1);
  });

  it("honours an open() called before start", () => {
    const octx = createOctx();
    openOverlay(octx);

    startOverlay(pluginCtxOf(octx));

    expect(hostElement()?.hidden).toBe(false);
    expect(octx.channel.opened).toBe(1);
  });
});
