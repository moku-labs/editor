import { afterEach, describe, expect, it, vi } from "vitest";
import { notification } from "../../../registry/protocol";
import { TAP_THROTTLE_MS, watchTaps, watchVisibility } from "../../page";
import { createDeps, fakeWindow, openDeps } from "../helpers";

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Open deps on a browser page whose window is a fake the test presses.
 *
 * @returns The deps, the socket and the fake window.
 */
function tapDeps() {
  const target = fakeWindow();
  const page = {
    href: "http://127.0.0.1:3000/game.html",
    document: new EventTarget(),
    window: target
  };
  return { ...openDeps({ page }), target };
}

describe("watchVisibility", () => {
  it("sends one heartbeat in a microtask after visibilitychange when open", async () => {
    const { deps, socket } = openDeps();
    deps.channel.beat = { frame: 5, paused: true, at: 9 };
    watchVisibility(deps);

    deps.page.document?.dispatchEvent(new Event("visibilitychange"));
    expect(socket.sent).toEqual([]);
    await Promise.resolve();

    expect(socket.messages()).toEqual([
      notification("game", "heartbeat", { frame: 5, paused: true, at: 9 })
    ]);
    expect(deps.emit).toHaveBeenCalledWith({ status: { kind: "paused", frame: 5 } });
  });

  it("sends nothing when the bridge is not open", async () => {
    const { deps, socket } = openDeps();
    deps.state.phase = "lost";
    watchVisibility(deps);

    deps.page.document?.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();

    expect(socket.sent).toEqual([]);
  });

  it("the remover detaches the listener", async () => {
    const { deps, socket } = openDeps();
    const off = watchVisibility(deps);

    off();
    deps.page.document?.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();

    expect(socket.sent).toEqual([]);
  });

  it("does nothing without a document (outside a browser)", () => {
    const deps = createDeps({ page: { href: undefined, document: undefined, window: undefined } });

    const off = watchVisibility(deps);

    expect(off).toBeTypeOf("function");
    expect(() => off()).not.toThrow();
  });
});

describe("watchTaps", () => {
  it("listens to pointerdown on the window, in the capture phase and passive", () => {
    const { deps, target } = tapDeps();

    watchTaps(deps);

    expect(target.listeners.map(listener => listener.options)).toEqual([
      { capture: true, passive: true }
    ]);
  });

  it("sends a tap with the page point and performance.now() of the page", () => {
    const { deps, socket, target } = tapDeps();
    vi.spyOn(performance, "now").mockReturnValue(15_234.5);
    watchTaps(deps);

    target.press(206, 640);

    expect(socket.messages()).toEqual([
      notification("game", "tap", { x: 206, y: 640, at: 15_234.5 })
    ]);
  });

  it("sends at most one tap per 50 ms", () => {
    const { deps, socket, target } = tapDeps();
    const now = vi.spyOn(performance, "now");
    watchTaps(deps);

    now.mockReturnValue(1000);
    target.press(1, 1);
    now.mockReturnValue(1049.9);
    target.press(2, 2);
    now.mockReturnValue(1000 + TAP_THROTTLE_MS);
    target.press(3, 3);

    expect(TAP_THROTTLE_MS).toBe(50);
    expect(socket.messages()).toEqual([
      notification("game", "tap", { x: 1, y: 1, at: 1000 }),
      notification("game", "tap", { x: 3, y: 3, at: 1050 })
    ]);
  });

  it("sends nothing while the bridge is not open, and a dropped tap does not throttle the next", () => {
    const { deps, socket, target } = tapDeps();
    const now = vi.spyOn(performance, "now").mockReturnValue(1000);
    watchTaps(deps);

    deps.state.phase = "lost";
    target.press(1, 1);
    deps.state.phase = "open";
    now.mockReturnValue(1010);
    target.press(2, 2);

    expect(socket.messages()).toEqual([notification("game", "tap", { x: 2, y: 2, at: 1010 })]);
  });

  it("the remover detaches the listener", () => {
    const { deps, socket, target } = tapDeps();
    const off = watchTaps(deps);

    off();
    target.press(1, 1);

    expect(target.listeners).toEqual([]);
    expect(socket.sent).toEqual([]);
  });

  it("does nothing without a window (outside a browser)", () => {
    const deps = createDeps({ page: { href: undefined, document: undefined, window: undefined } });

    const off = watchTaps(deps);

    expect(off).toBeTypeOf("function");
    expect(() => off()).not.toThrow();
  });
});
