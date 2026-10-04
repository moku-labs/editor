// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { isNotification } from "../../../registry/protocol";
import { watchTaps } from "../../page";
import type { FakeSocket } from "../helpers";
import { openDeps } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The tap watch on a real (happy-dom) window: the game's own stopPropagation
// does not hide a tap, and input on the overlay host is not a game tap.
// ─────────────────────────────────────────────────────────────────────────────

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

/**
 * Deps on the real window and document, with an open socket.
 *
 * @returns The deps and the socket.
 */
function domDeps() {
  return openDeps({ page: { href: location.href, document, window: globalThis.window } });
}

/**
 * The points of every tap the socket sent.
 *
 * @param socket - The fake socket.
 * @returns `[x, y]` per tap.
 */
function tapsOf(socket: FakeSocket): [unknown, unknown][] {
  return socket
    .messages()
    .filter(message => isNotification(message) && message.method === "tap")
    .map(message => {
      const params = "params" in message ? message.params : undefined;
      const fields =
        typeof params === "object" && params !== null && !Array.isArray(params) ? params : {};
      return [fields.x, fields.y];
    });
}

/**
 * Presses the pointer on an element, the way a browser dispatches a pointerdown.
 *
 * @param element - The pressed element.
 * @param x - clientX in page CSS px.
 * @param y - clientY in page CSS px.
 */
function press(element: Element, x: number, y: number): void {
  element.dispatchEvent(
    new PointerEvent("pointerdown", { clientX: x, clientY: y, bubbles: true, composed: true })
  );
}

describe("watchTaps on a real window", () => {
  it("still sends the tap when the game stops the pointerdown at its canvas", () => {
    const { deps, socket } = domDeps();
    const canvas = document.createElement("canvas");
    canvas.addEventListener("pointerdown", event => {
      event.stopPropagation();
    });
    document.body.append(canvas);
    watchTaps(deps);

    press(canvas, 206, 640);

    expect(tapsOf(socket)).toEqual([[206, 640]]);
  });

  it("sends no tap for input on the overlay host", () => {
    const { deps, socket } = domDeps();
    const host = document.createElement("div");
    host.dataset.mokuEditorOverlay = "";
    const button = document.createElement("button");
    host.attachShadow({ mode: "open" }).append(button);
    document.body.append(host);
    watchTaps(deps);

    press(button, 30, 40);
    press(host, 31, 41);

    expect(tapsOf(socket)).toEqual([]);
  });

  it("the remover detaches the real listener", () => {
    const { deps, socket } = domDeps();
    const off = watchTaps(deps);

    off();
    press(document.body, 1, 2);

    expect(tapsOf(socket)).toEqual([]);
  });
});
