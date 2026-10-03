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
 */
export function createOverlayApi(ctx: OverlayPluginCtx): OverlayApi {
  const octx = overlayCtxOf(ctx);

  return {
    open: () => {
      openOverlay(octx);
    },
    close: () => {
      closeOverlay(octx);
    },
    isOpen: () => octx.state.open
  };
}

/**
 * Watches game.render: the frame callback only stores the numbers; the interval repaints. A
 * missing source or a throwing read marks render unavailable and warns once.
 *
 * @param octx - Domain context.
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
