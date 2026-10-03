/**
 * @file overlay plugin — api factory (open, close, isOpen) and the open/close actions the
 * editor.overlay command shares.
 */
import { cheatCommands } from "./cheats";
import { overlayCtxOf } from "./context";
import { paint, toRenderNumbers } from "./paint";
import type { OverlayApi, OverlayCtx, OverlayPluginCtx } from "./types";
import { PAINT_MS } from "./types";

/**
 * The render source the overlay watches in process.
 */
const RENDER_SOURCE = "game.render";

/**
 * Creates the overlay api over overlayCtxOf(ctx).
 *
 * @param ctx - Plugin context of the overlay.
 * @returns `{ open, close, isOpen }`.
 * @example
 * ```ts
 * createOverlayApi(ctx).open();
 * ```
 */
export function createOverlayApi(ctx: OverlayPluginCtx): OverlayApi {
  const octx = overlayCtxOf(ctx);

  return {
    /**
     * Shows the card; before start it only sets the flag and onStart honours it. Idempotent.
     *
     * @example
     * ```ts
     * editor.overlay.open(); // the card appears in the top-right corner of the game page
     * ```
     */
    open: () => {
      openOverlay(octx);
    },
    /**
     * Hides the card, stops the render watch and the repaint interval. Idempotent.
     *
     * @example
     * ```ts
     * editor.overlay.close();
     * ```
     */
    close: () => {
      closeOverlay(octx);
    },
    /**
     * Whether the overlay is switched on.
     *
     * @returns The flag.
     * @example
     * ```ts
     * editor.overlay.isOpen(); // false: the overlay is off by default
     * ```
     */
    isOpen: () => octx.state.open
  };
}

/**
 * Watches game.render: the frame callback only stores the numbers; the interval repaints. A
 * missing source or a throwing read marks render unavailable and warns once.
 *
 * @param octx - Domain context.
 * @example
 * ```ts
 * watchRender(octx); // octx.state.render = { fps: 60, frameMs: 4.1, textureMb: 31.1 }
 * ```
 */
function watchRender(octx: OverlayCtx): void {
  const { state } = octx;
  state.render = undefined;
  state.renderUnavailable = false;
  try {
    state.stopRender = octx.channel.watch(RENDER_SOURCE, undefined, value => {
      state.render = toRenderNumbers(value);
    });
  } catch (error) {
    state.renderUnavailable = true;
    const reason = error instanceof Error ? error.message : String(error);
    octx.log.warn("overlay:render-unavailable", { reason });
  }
}

/**
 * Opens: shows the host, computes the cheats, watches game.render, starts the paint interval and
 * paints now. Before mount it only sets the flag. Idempotent.
 *
 * @param octx - Domain context.
 * @example
 * ```ts
 * openOverlay(octx);
 * ```
 */
export function openOverlay(octx: OverlayCtx): void {
  const { state } = octx;
  state.open = true;
  if (state.host === undefined || state.paintTimer !== undefined) return;

  state.host.hidden = false;
  state.cheats = cheatCommands(octx.registry.manifest());
  watchRender(octx);
  state.paintTimer = setInterval(() => {
    paint(octx);
  }, PAINT_MS);
  paint(octx);
}

/**
 * Closes: hides the host, unwatches game.render, clears the interval. Idempotent.
 *
 * @param octx - Domain context.
 * @example
 * ```ts
 * closeOverlay(octx);
 * ```
 */
export function closeOverlay(octx: OverlayCtx): void {
  const { state } = octx;
  state.open = false;
  if (state.host !== undefined) state.host.hidden = true;
  state.stopRender?.();
  state.stopRender = undefined;
  clearInterval(state.paintTimer);
  state.paintTimer = undefined;
}
