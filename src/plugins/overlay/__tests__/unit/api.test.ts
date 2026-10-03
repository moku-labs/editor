// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeOverlay, createOverlayApi, openOverlay } from "../../api";
import { PAINT_MS } from "../../types";
import type { TestOctx } from "../helpers";
import { command, createOctx, pluginCtxOf } from "../helpers";

/**
 * Gives the state a hidden host with a shadow root, like mount does.
 *
 * @param octx - The test context.
 * @returns The host.
 */
function withHost(octx: TestOctx): HTMLElement {
  const host = document.createElement("div");
  host.hidden = true;
  document.body.append(host);
  octx.state.host = host;
  octx.state.root = host.attachShadow({ mode: "open" });
  return host;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
});

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("openOverlay", () => {
  it("only sets the flag before mount", () => {
    const octx = createOctx();

    openOverlay(octx);

    expect(octx.state.open).toBe(true);
    expect(octx.channel.opened).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("shows the host, lists the cheats, watches game.render and paints", () => {
    const octx = createOctx({}, [command("a.cheat"), command("game.step", "route")]);
    const host = withHost(octx);

    openOverlay(octx);

    expect(host.hidden).toBe(false);
    expect(octx.state.cheats.map(cheat => cheat.id)).toEqual(["a.cheat"]);
    expect(octx.channel.opened).toBe(1);
    expect(octx.state.render).toEqual({ fps: 60, frameMs: 4.1, textureMb: 31.1 });
    expect(vi.getTimerCount()).toBe(1);
    expect(octx.state.root?.querySelector('[data-chip="fps"]')?.textContent).toBe("fps 60");
  });

  it("subscribes once when called twice", () => {
    const octx = createOctx();
    withHost(octx);

    openOverlay(octx);
    openOverlay(octx);

    expect(octx.channel.opened).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("stores frame values and repaints on the interval only", () => {
    const octx = createOctx();
    withHost(octx);
    openOverlay(octx);

    octx.channel.frame({ fps: 30, frameMs: 9.94, textureMb: 2 });
    const fps = () => octx.state.root?.querySelector('[data-chip="fps"]')?.textContent;

    expect(octx.state.render?.fps).toBe(30);
    expect(fps()).toBe("fps 60");
    vi.advanceTimersByTime(PAINT_MS);
    expect(fps()).toBe("fps 30");
  });

  it("marks render unavailable and warns once per open when the watch throws", () => {
    const octx = createOctx();
    withHost(octx);
    octx.channel.watchError = new Error("[moku-editor] game.render: unknown source");

    openOverlay(octx);
    openOverlay(octx);

    expect(octx.state.renderUnavailable).toBe(true);
    expect(octx.log.warn).toHaveBeenCalledTimes(1);
    expect(octx.log.warn).toHaveBeenCalledWith("overlay:render-unavailable", {
      reason: "[moku-editor] game.render: unknown source"
    });
    expect(octx.state.root?.querySelector("[data-chip]")?.textContent).toBe("render —");

    closeOverlay(octx);
    openOverlay(octx);
    expect(octx.log.warn).toHaveBeenCalledTimes(2);
  });

  it("warns with a text reason for a thrown non-error", () => {
    const octx = createOctx();
    withHost(octx);
    octx.channel.watch = () => {
      throw "nope";
    };

    openOverlay(octx);

    expect(octx.log.warn).toHaveBeenCalledWith("overlay:render-unavailable", { reason: "nope" });
  });
});

describe("closeOverlay", () => {
  it("hides the host, stops the watch and clears the interval", () => {
    const octx = createOctx();
    const host = withHost(octx);
    openOverlay(octx);

    closeOverlay(octx);

    expect(octx.state.open).toBe(false);
    expect(host.hidden).toBe(true);
    expect(octx.channel.stopped).toBe(1);
    expect(octx.state.stopRender).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("is idempotent and safe before mount", () => {
    const octx = createOctx();

    closeOverlay(octx);
    closeOverlay(octx);

    expect(octx.state.open).toBe(false);
  });

  it("allows a fresh subscription after a close", () => {
    const octx = createOctx();
    withHost(octx);

    openOverlay(octx);
    closeOverlay(octx);
    openOverlay(octx);

    expect(octx.channel.opened).toBe(2);
    expect(vi.getTimerCount()).toBe(1);
  });
});

describe("createOverlayApi", () => {
  it("opens, closes and answers isOpen", () => {
    const octx = createOctx();
    const api = createOverlayApi(pluginCtxOf(octx));

    expect(api.isOpen()).toBe(false);
    api.open();
    expect(api.isOpen()).toBe(true);
    api.close();
    expect(api.isOpen()).toBe(false);
  });
});
