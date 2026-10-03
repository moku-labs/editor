/**
 * @file workspace plugin — the D-07 reload of the game frame: bookmark the game, reload the frame
 * in place (`iframe.src` reassigned; the element never moves), wait for the new session's
 * manifest, restore the bookmark, toast the outcome. Concurrent calls share one run; a call during
 * a run schedules exactly one more run after it. The internal bookmark/restore runs are not user
 * runs: they emit no `workspace:ran`. Reload never writes files (the caller does, contracts §6).
 */
import { linkPlugin } from "../../link";
import type { LinkApi } from "../../link/types";
import type { Json, Manifest } from "../../registry/protocol";
import { bareMessage, toWireError } from "../../registry/protocol";
import { trackCleanup } from "../state";
import { showToast } from "../toasts";
import type { PendingReload, ReloadResult, WorkspaceCtx } from "../types";
import { gameUrl } from "./frame";

/**
 * What a reload may report besides `restored`.
 */
type Reason = NonNullable<ReloadResult["reason"]>;

/**
 * Builds a result without a `reason` key when there is none.
 *
 * @param restored - Whether the bookmark was restored.
 * @param reason - Why not, when known.
 * @returns The result.
 * @example
 * ```ts
 * resultOf(false, "timeout"); // { restored: false, reason: "timeout" }
 * ```
 */
function resultOf(restored: boolean, reason: Reason | undefined): ReloadResult {
  return reason === undefined ? { restored } : { restored, reason };
}

/**
 * The message of a failed run (with the `[moku-editor]` prefix).
 *
 * @param error - The rejection.
 * @returns The wire message.
 * @example
 * ```ts
 * messageOf(error); // "[moku-editor] game.restore: shape changed"
 * ```
 */
function messageOf(error: unknown): string {
  return toWireError(error).message;
}

/**
 * Waits for the first manifest of an embedded session after now; the immediate call of an
 * existing manifest, a lost session (undefined) and a session outside the editor are skipped.
 * Ends with undefined after the timeout or at stop.
 *
 * @param ctx - Domain context of workspace.
 * @param link - The link api.
 * @returns The new manifest, or undefined on timeout or stop.
 * @example
 * ```ts
 * const next = nextManifest(ctx, link); // subscribe before reloading the frame
 * ```
 */
function nextManifest(ctx: WorkspaceCtx, link: LinkApi): Promise<Manifest | undefined> {
  return new Promise(resolve => {
    let armed = false;
    let finish: (manifest?: Manifest) => void = resolve;
    const off = link.onManifest(manifest => {
      if (armed && manifest?.embedded) finish(manifest);
    });
    armed = true;

    const timer = setTimeout(() => {
      finish();
    }, ctx.config.reloadTimeoutMs);
    const untrack = trackCleanup(ctx.state, () => {
      finish();
    });
    /**
     * Ends the wait once: clears the timer, the listener and the stop cleanup.
     *
     * @param manifest - The new manifest, omitted on timeout or stop.
     * @example
     * ```ts
     * finish(manifest);
     * ```
     */
    finish = manifest => {
      clearTimeout(timer);
      off();
      untrack();
      resolve(manifest);
    };
  });
}

/**
 * Takes the bookmark before a restore reload, when the game is connected.
 *
 * @param ctx - Domain context of workspace.
 * @param link - The link api.
 * @returns The bookmark (or undefined) and the reason it is missing.
 * @example
 * ```ts
 * const { bookmark, reason } = await takeBookmark(ctx, link);
 * ```
 */
async function takeBookmark(
  ctx: WorkspaceCtx,
  link: LinkApi
): Promise<{ bookmark: Json | undefined; reason: Reason | undefined }> {
  const { kind } = ctx.state.link;
  if (kind !== "live" && kind !== "paused") return { bookmark: undefined, reason: "no_session" };

  try {
    const ran = await link.run("game.bookmark");
    return { bookmark: ran.value, reason: undefined };
  } catch (error) {
    ctx.log.warn("workspace:bookmark-failed", { message: messageOf(error) });
    return { bookmark: undefined, reason: "bookmark_failed" };
  }
}

/**
 * Restores the bookmark into the new session and toasts the outcome.
 *
 * @param ctx - Domain context of workspace.
 * @param link - The link api.
 * @param bookmark - The bookmark taken before the reload.
 * @returns The result.
 * @example
 * ```ts
 * return await restore(ctx, link, bookmark);
 * ```
 */
async function restore(ctx: WorkspaceCtx, link: LinkApi, bookmark: Json): Promise<ReloadResult> {
  try {
    await link.run("game.restore", { bookmark });
    showToast(ctx, "Game reloaded · state restored from the last checkpoint");
    return { restored: true };
  } catch (error) {
    const message = messageOf(error);
    showToast(ctx, `Game reloaded · restore failed: ${bareMessage(message)}`);
    ctx.log.warn("workspace:restore-failed", { message });
    return { restored: false, reason: "restore_failed" };
  }
}

/**
 * One reload run (steps 2–7 of the D-07 flow).
 *
 * @param ctx - Domain context of workspace.
 * @param iframe - The game frame.
 * @param restoreState - Bookmark before and restore after.
 * @returns The result.
 * @example
 * ```ts
 * await runOnce(ctx, iframe, true);
 * ```
 */
async function runOnce(
  ctx: WorkspaceCtx,
  iframe: HTMLIFrameElement,
  restoreState: boolean
): Promise<ReloadResult> {
  const link = ctx.require(linkPlugin);
  if (link.manifest()?.embedded === false) {
    showToast(ctx, "The game runs outside the editor · reload it there");
    return { restored: false, reason: "not_embedded" };
  }

  const taken = restoreState
    ? await takeBookmark(ctx, link)
    : { bookmark: undefined, reason: undefined };
  if (ctx.state.stopped) return { restored: false, reason: "timeout" };

  const next = nextManifest(ctx, link);
  iframe.src = gameUrl(ctx);
  const manifest = await next;

  if (manifest === undefined) {
    if (ctx.state.stopped) return { restored: false, reason: "timeout" };
    const seconds = Math.round(ctx.config.reloadTimeoutMs / 1000);
    showToast(ctx, `Game reloaded · no game connected after ${seconds} s`);
    return { restored: false, reason: "timeout" };
  }
  if (
    taken.bookmark !== undefined &&
    manifest.commands.some(command => command.id === "game.restore")
  ) {
    return restore(ctx, link, taken.bookmark);
  }
  showToast(ctx, "Game reloaded");
  return resultOf(false, taken.reason);
}

/**
 * Starts a run and records it as the pending one; when it ends and another call came in during
 * it, one more run starts.
 *
 * @param ctx - Domain context of workspace.
 * @param iframe - The game frame.
 * @param restoreState - Bookmark before and restore after.
 * @returns The run's result.
 * @example
 * ```ts
 * return startRun(ctx, iframe, opts.restore === true);
 * ```
 */
function startRun(
  ctx: WorkspaceCtx,
  iframe: HTMLIFrameElement,
  restoreState: boolean
): Promise<ReloadResult> {
  const { frame } = ctx.state;
  const pending: PendingReload = {
    promise: runOnce(ctx, iframe, restoreState).then(result => {
      if (frame.reload === pending) frame.reload = undefined;
      if (pending.again && !ctx.state.stopped) void reloadFrame(ctx, { restore: restoreState });
      return result;
    }),
    again: false
  };
  frame.reload = pending;
  return pending.promise;
}

/**
 * Reloads the game frame (D-07). Before the first mount there is no frame: resolves
 * `not_mounted`.
 *
 * @param ctx - Domain context of workspace.
 * @param opts - `restore: true` bookmarks first and restores after.
 * @param opts.restore - Bookmark and restore the game state.
 * @returns The result; a call during a run shares that run's promise.
 * @example
 * ```ts
 * await reloadFrame(ctx, { restore: true }); // { restored: true }
 * ```
 */
export function reloadFrame(
  ctx: WorkspaceCtx,
  opts: { readonly restore?: boolean }
): Promise<ReloadResult> {
  const { iframe, reload } = ctx.state.frame;
  if (iframe === undefined) return Promise.resolve({ restored: false, reason: "not_mounted" });

  if (reload !== undefined) {
    reload.again = true;
    return reload.promise;
  }
  return startRun(ctx, iframe, opts.restore === true);
}
