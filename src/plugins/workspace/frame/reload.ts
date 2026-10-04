/**
 * @file workspace plugin — the D-07 reload of the game frame: bookmark the game and note whether
 * it is paused, reload the frame in place (`iframe.src` reassigned; the element never moves), wait
 * for the manifest of this tab's own new session, restore the bookmark, pause again when it was
 * paused, toast the outcome. Concurrent calls share one run; a call during a run schedules exactly
 * one more run after it. The internal bookmark/restore/pause runs are not user runs: they emit no
 * `workspace:ran`. Reload never writes files (the caller does, contracts §6).
 */
import { linkPlugin } from "../../link";
import type { LinkApi } from "../../link/types";
import type { Json, Manifest } from "../../registry/protocol";
import { bareMessage, toWireError } from "../../registry/protocol";
import { trackCleanup } from "../state";
import { showToast } from "../toasts";
import type { PendingReload, ReloadResult, WorkspaceCtx } from "../types";
import { taggedGameUrl } from "./frame";

/**
 * What a reload may report besides `restored`.
 */
type Reason = NonNullable<ReloadResult["reason"]>;

/**
 * What the reload keeps of the game before it: the bookmark, and whether the game was paused.
 */
type Checkpoint = { readonly bookmark: Json; readonly paused: boolean };

/**
 * The checkpoint taken before a reload, or the reason there is none.
 */
type Taken = { readonly checkpoint: Checkpoint | undefined; readonly reason: Reason | undefined };

/**
 * Nothing taken: a reload without restore.
 */
const NOTHING_TAKEN: Taken = { checkpoint: undefined, reason: undefined };

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
 * True when a manifest lists a command.
 *
 * @param manifest - The manifest.
 * @param id - The command id.
 * @returns Whether the command is there.
 * @example
 * ```ts
 * hasCommand(manifest, "game.restore"); // true for merge-game
 * ```
 */
function hasCommand(manifest: Manifest, id: string): boolean {
  return manifest.commands.some(command => command.id === id);
}

/**
 * Waits for the first manifest of this tab's own embedded frame after now; the immediate call of
 * an existing manifest, a lost session (undefined), a session outside the editor and the game
 * frame of another tools tab are skipped. Ends with undefined after the timeout or at stop.
 *
 * @param ctx - Domain context of workspace.
 * @param link - The link api.
 * @returns The new manifest, or undefined on timeout or stop.
 */
function nextManifest(ctx: WorkspaceCtx, link: LinkApi): Promise<Manifest | undefined> {
  return new Promise(resolve => {
    let armed = false;
    let finish: (manifest?: Manifest) => void = resolve;
    const off = link.onManifest(manifest => {
      if (armed && manifest?.embedded && !link.isOtherTab(manifest.page)) finish(manifest);
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
 * Takes the checkpoint before a restore reload, when the game is connected: the bookmark, and
 * whether the link says paused.
 *
 * @param ctx - Domain context of workspace.
 * @param link - The link api.
 * @returns The checkpoint (or undefined) and the reason it is missing.
 */
async function takeCheckpoint(ctx: WorkspaceCtx, link: LinkApi): Promise<Taken> {
  const { kind } = ctx.state.link;
  if (kind !== "live" && kind !== "paused") return { checkpoint: undefined, reason: "no_session" };

  try {
    const ran = await link.run("game.bookmark");
    return { checkpoint: { bookmark: ran.value, paused: kind === "paused" }, reason: undefined };
  } catch (error) {
    ctx.log.warn("workspace:bookmark-failed", { message: messageOf(error) });
    return { checkpoint: undefined, reason: "bookmark_failed" };
  }
}

/**
 * Pauses the restored game again, when the new session lists `game.pause`. A failure is a warn:
 * the state is restored all the same.
 *
 * @param ctx - Domain context of workspace.
 * @param link - The link api.
 * @param manifest - The manifest of the new session.
 */
async function pauseAgain(ctx: WorkspaceCtx, link: LinkApi, manifest: Manifest): Promise<void> {
  if (!hasCommand(manifest, "game.pause")) return;

  try {
    await link.run("game.pause");
  } catch (error) {
    ctx.log.warn("workspace:pause-failed", { message: messageOf(error) });
  }
}

/**
 * Restores the checkpoint into the new session (the bookmark, then the pause) and toasts the
 * outcome.
 *
 * @param ctx - Domain context of workspace.
 * @param link - The link api.
 * @param checkpoint - The checkpoint taken before the reload.
 * @param manifest - The manifest of the new session.
 * @returns The result.
 */
async function restore(
  ctx: WorkspaceCtx,
  link: LinkApi,
  checkpoint: Checkpoint,
  manifest: Manifest
): Promise<ReloadResult> {
  try {
    await link.run("game.restore", { bookmark: checkpoint.bookmark });
  } catch (error) {
    const message = messageOf(error);
    showToast(ctx, `Game reloaded · restore failed: ${bareMessage(message)}`);
    ctx.log.warn("workspace:restore-failed", { message });
    return { restored: false, reason: "restore_failed" };
  }

  if (checkpoint.paused) await pauseAgain(ctx, link, manifest);
  showToast(ctx, "Game reloaded · state restored from the last checkpoint");
  return { restored: true };
}

/**
 * One reload run (steps 2–7 of the D-07 flow).
 *
 * @param ctx - Domain context of workspace.
 * @param iframe - The game frame.
 * @param restoreState - Checkpoint before and restore after.
 * @returns The result.
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

  const taken = restoreState ? await takeCheckpoint(ctx, link) : NOTHING_TAKEN;
  if (ctx.state.stopped) return { restored: false, reason: "timeout" };

  const next = nextManifest(ctx, link);
  iframe.src = taggedGameUrl(ctx);
  const manifest = await next;

  if (manifest === undefined) {
    if (ctx.state.stopped) return { restored: false, reason: "timeout" };
    const seconds = Math.round(ctx.config.reloadTimeoutMs / 1000);
    showToast(ctx, `Game reloaded · no game connected after ${seconds} s`);
    return { restored: false, reason: "timeout" };
  }
  if (taken.checkpoint !== undefined && hasCommand(manifest, "game.restore")) {
    return restore(ctx, link, taken.checkpoint, manifest);
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
