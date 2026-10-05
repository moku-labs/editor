/**
 * @file link plugin — the expected reload window (U7): a server restart (close 1012), a reload
 * the editor started (`expectReload`, `setHotReload`) or a game that said bye opens it; inside it a
 * loss reads `lost` with `reloading: true`. The game's next heartbeat after the loss ends it (in
 * the status machine); after `reloadGraceMs` without one the status is a plain `lost` again.
 */
import { clearReload } from "../state";
import type { LinkCtx } from "../types";
import { lastFrameOf, setStatus } from "./machine";

/**
 * The grace ran out without a heartbeat: the window ends and a neutral `lost` turns into the plain
 * `lost` of a real loss.
 *
 * @param ctx - Domain context of link.
 */
function reloadExpired(ctx: LinkCtx): void {
  const { state } = ctx;
  state.reload = undefined;
  if (state.stopped) return;

  const { status } = state;
  if (status.kind !== "lost" || status.reloading !== true) return;
  const { kind, reason, lastFrame, retryInMs } = status;
  setStatus(ctx, { kind, reason, lastFrame, retryInMs });
}

/**
 * Opens (or renews) the expected reload window for `reloadGraceMs`. A renewed window keeps the
 * frame of the last heartbeat, but waits for its own loss: a heartbeat of the old page before that
 * loss does not end it. The current status is left alone: a loss before the call stays a plain
 * `lost`.
 *
 * @param ctx - Domain context of link.
 */
export function expectReload(ctx: LinkCtx): void {
  const { state, config } = ctx;
  if (state.stopped) return;

  const previous = state.reload;
  const lastFrame = lastFrameOf(state.status) || (previous?.lastFrame ?? 0);
  clearReload(state);
  state.reload = {
    lastFrame,
    lost: false,
    timer: setTimeout(() => {
      reloadExpired(ctx);
    }, config.reloadGraceMs)
  };
}
