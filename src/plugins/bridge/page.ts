/**
 * @file bridge plugin — page behaviour: a `visibilitychange` (either way) sends one heartbeat in a
 * microtask, after the game's lifecycle listener has flipped the pause state; a `pointerdown` on
 * the page sends one `tap` (at most one per 50 ms), so the tools page can show where it landed.
 */
import type { Tap } from "../registry/protocol";
import { HOST_ATTRIBUTE, notification } from "../registry/protocol";
import { sendBeat } from "./connection/loop";
import { sendNow } from "./dispatch/send";
import type { BridgeDeps, TapEvent, TapOptions } from "./types";

/**
 * The shortest time between two taps sent, in ms.
 */
export const TAP_THROTTLE_MS = 50;

/**
 * The tap listener runs in the capture phase on the window, so the game's own stopPropagation
 * cannot hide a tap, and passive, so it never delays the game's input.
 */
const TAP_OPTIONS: TapOptions = { capture: true, passive: true };

/**
 * Listens to `visibilitychange` on the page document; while open, each event sends one heartbeat
 * in a microtask after it.
 *
 * @param deps - The domain deps.
 * @returns The remover (a no-op outside a browser).
 */
export function watchVisibility(deps: BridgeDeps): () => void {
  const doc = deps.page.document;
  if (doc === undefined) return () => {};

  /**
   * Queues one heartbeat after the event.
   */
  const onVisibility = (): void => {
    queueMicrotask(() => {
      if (deps.state.phase === "open") sendBeat(deps, deps.channel.heartbeat());
    });
  };
  doc.addEventListener("visibilitychange", onVisibility);
  return () => {
    doc.removeEventListener("visibilitychange", onVisibility);
  };
}

/**
 * True when a pointerdown comes from the in-game overlay: its host is on the event path. The
 * overlay stops its input at the host, but a capture listener on the window runs before that.
 *
 * @param event - The pointerdown.
 * @returns Whether the overlay host is on the path.
 */
function isOverlayInput(event: TapEvent): boolean {
  if (typeof Element !== "function") return false;
  return event
    .composedPath()
    .some(node => node instanceof Element && node.hasAttribute(HOST_ATTRIBUTE));
}

/**
 * Listens to `pointerdown` on the page window (capture, passive); while open, each one sends a
 * `tap { x, y, at }` in page CSS px and page `performance.now()`, at most one per
 * TAP_THROTTLE_MS. Overlay input sends none.
 *
 * @param deps - The domain deps.
 * @returns The remover (a no-op outside a browser).
 */
export function watchTaps(deps: BridgeDeps): () => void {
  const target = deps.page.window;
  if (target === undefined) return () => {};
  let lastAt = Number.NEGATIVE_INFINITY;

  /**
   * Sends one tap for a pointerdown, unless the bridge is closed, the overlay was pressed or the
   * last tap is too recent.
   *
   * @param event - The pointerdown.
   */
  const onPointerDown = (event: TapEvent): void => {
    if (deps.state.phase !== "open" || isOverlayInput(event)) return;
    const at = performance.now();
    if (at - lastAt < TAP_THROTTLE_MS) return;

    lastAt = at;
    const tap: Tap = { x: event.clientX, y: event.clientY, at };
    sendNow(deps, notification("game", "tap", tap));
  };
  target.addEventListener("pointerdown", onPointerDown, TAP_OPTIONS);
  return () => {
    target.removeEventListener("pointerdown", onPointerDown, TAP_OPTIONS);
  };
}
