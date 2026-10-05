/**
 * @file workspace plugin — the D-07 reload of the game frame: bookmark the game and note whether
 * it is paused, reload the frame in place (`iframe.src` reassigned; the element never moves), wait
 * for the manifest of this tab's own new session, restore the bookmark, pause again when it was
 * paused, toast the outcome. Concurrent calls share one run; a call during a run schedules exactly
 * one more run after it. The internal bookmark/restore/pause runs are not user runs: they emit no
 * `workspace:ran`. Reload never writes files (the caller does, contracts §6).
 *
 * After a save with Bun hot reload on (round 2 R6), Bun reloads the page itself: the run first
 * waits up to `hotReloadWaitMs` for that new session and reloads the frame only when none came.
 * A session whose hello carries `restored` was restored by the bridge: no second restore, no
 * second pause.
 *
 * The Hot reload switch (D-32) takes the checkpoint itself before the bin restarts its server and
 * hands it to `reloadFrame`, which then restores it instead of taking a new one.
 */
import { linkPlugin } from "../../link";
import type { LinkApi } from "../../link/types";
import type { Json, Manifest } from "../../registry/protocol";
import { bareMessage, toWireError } from "../../registry/protocol";
import { trackCleanup } from "../state";
import { showToast } from "../toasts";
import type { PendingReload, ReloadResult, WorkspaceCtx } from "../types";
import { taggedGameUrl } from "./frame";
import { RESTORED_TOAST, takeRestore } from "./restored";

/**
 * What a reload may report besides `restored`.
 */
type Reason = NonNullable<ReloadResult["reason"]>;

/**
 * What the reload keeps of the game before it: the bookmark, and whether the game was paused.
 */
type Checkpoint = { readonly bookmark: Json; readonly paused: boolean };

/**
 * The checkpoint taken before a reload, or the reason there is none (with the failure message of
 * a bookmark that failed, warned only when the checkpoint is needed).
 *
 * @example
 * ```ts
 * const taken: Taken = { checkpoint: { bookmark: { checkpoint: "home" }, paused: false }, reason: undefined };
 * ```
 */
export type Taken = {
  readonly checkpoint: Checkpoint | undefined;
  readonly reason: Reason | undefined;
  readonly failure?: string;
};

/**
 * Nothing taken: a reload without restore.
 */
const NOTHING_TAKEN: Taken = { checkpoint: undefined, reason: undefined };

/**
 * The result of a run that got no new session: the wait timed out, or workspace stopped. Returned
 * as a copy, so no caller shares it.
 */
const TIMED_OUT: ReloadResult = Object.freeze({ restored: false, reason: "timeout" });

/**
 * Milliseconds in a second, for the timeout toast.
 */
const MS_PER_SECOND = 1000;

/**
 * How a run reloads: with the state kept, and whether a save started it (then Bun may reload
 * the page first).
 */
export type ReloadOptions = { readonly restore?: boolean; readonly afterSave?: boolean };

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
 * messageOf(new Error("game.restore: shape changed")); // "[moku-editor] game.restore: shape changed"
 * messageOf("boom"); // "[moku-editor] Unknown error"
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
 * frame of another tools tab are skipped. Ends with undefined after the timeout, at stop, or when
 * the signal aborts.
 *
 * @param ctx - Domain context of workspace.
 * @param link - The link api.
 * @param timeoutMs - How long to wait.
 * @param signal - Ends the wait early (the Hot reload switch when the server refused).
 * @returns The new manifest, or undefined on timeout, stop or abort.
 */
export function nextManifest(
  ctx: WorkspaceCtx,
  link: LinkApi,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<Manifest | undefined> {
  return new Promise(resolve => {
    // Listen first. `armed` skips the immediate call with the manifest that exists now.
    let armed = false;
    const off = link.onManifest(manifest => {
      if (armed && manifest?.embedded && !link.isOtherTab(manifest.page)) finish(manifest);
    });
    armed = true;

    // The wait also ends after the timeout, at stop, or on abort.
    const timer = setTimeout(() => {
      finish();
    }, timeoutMs);
    const untrack = trackCleanup(ctx.state, () => {
      finish();
    });
    const aborted = (): void => {
      finish();
    };
    signal?.addEventListener("abort", aborted, { once: true });

    /**
     * Ends the wait once: clears the timer, the listener, the stop cleanup and the abort listener.
     *
     * @param manifest - The new manifest, omitted on timeout, stop or abort.
     */
    const finish = (manifest?: Manifest): void => {
      clearTimeout(timer);
      off();
      untrack();
      signal?.removeEventListener("abort", aborted);
      resolve(manifest);
    };
    if (signal?.aborted) finish();
  });
}

/**
 * Takes the checkpoint before a restore reload, when the game is connected: the bookmark, and
 * whether the link says paused. A failed bookmark is reported in `failure`, not logged here.
 *
 * @param ctx - Domain context of workspace.
 * @param link - The link api.
 * @returns The checkpoint (or undefined) and the reason it is missing.
 */
export async function takeCheckpoint(ctx: WorkspaceCtx, link: LinkApi): Promise<Taken> {
  const { kind } = ctx.state.link;
  if (kind !== "live" && kind !== "paused") return { checkpoint: undefined, reason: "no_session" };

  try {
    const ran = await link.run("game.bookmark");
    return { checkpoint: { bookmark: ran.value, paused: kind === "paused" }, reason: undefined };
  } catch (error) {
    return { checkpoint: undefined, reason: "bookmark_failed", failure: messageOf(error) };
  }
}

/**
 * Warns about a failed bookmark once the run needs the checkpoint.
 *
 * @param ctx - Domain context of workspace.
 * @param taken - The checkpoint result.
 */
function warnTaken(ctx: WorkspaceCtx, taken: Taken): void {
  if (taken.failure !== undefined) {
    ctx.log.warn("workspace:bookmark-failed", { message: taken.failure });
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
 * Reloads the frame in place and waits for this tab's own new session. link is told first, so
 * the session close reads as an expected reload (U7).
 *
 * @param ctx - Domain context of workspace.
 * @param link - The link api.
 * @param iframe - The game frame.
 * @returns The new manifest, undefined on timeout or stop.
 */
function reloadHere(
  ctx: WorkspaceCtx,
  link: LinkApi,
  iframe: HTMLIFrameElement
): Promise<Manifest | undefined> {
  const next = nextManifest(ctx, link, ctx.config.reloadTimeoutMs);
  link.expectReload();
  iframe.src = taggedGameUrl(ctx);
  return next;
}

/**
 * The new session Bun's own reload brings after a save with hot reload on, armed before anything
 * else so a fast reload is not missed; undefined when Bun does not reload (no save, hot reload off
 * or unknown).
 *
 * @param ctx - Domain context of workspace.
 * @param link - The link api.
 * @param afterSave - Whether a save started the run.
 * @returns The wait, or undefined.
 */
function bunReload(
  ctx: WorkspaceCtx,
  link: LinkApi,
  afterSave: boolean
): Promise<Manifest | undefined> | undefined {
  if (!afterSave || link.hotReload()?.hmr !== true) return undefined;
  return nextManifest(ctx, link, ctx.config.hotReloadWaitMs);
}

/**
 * The end of a run on a new session the bridge did not restore: workspace's own restore of its
 * checkpoint (and the pause), else a plain "Game reloaded".
 *
 * @param ctx - Domain context of workspace.
 * @param link - The link api.
 * @param manifest - The new session's manifest.
 * @param taken - The checkpoint taken before.
 * @returns The result.
 */
function settle(
  ctx: WorkspaceCtx,
  link: LinkApi,
  manifest: Manifest,
  taken: Taken
): Promise<ReloadResult> | ReloadResult {
  if (taken.checkpoint !== undefined && hasCommand(manifest, "game.restore")) {
    return restore(ctx, link, taken.checkpoint, manifest);
  }
  showToast(ctx, "Game reloaded");
  return resultOf(false, taken.reason);
}

/**
 * The run's result when the new session restored its state across Bun's reload: one toast, no
 * second restore or pause.
 *
 * @param ctx - Domain context of workspace.
 * @param manifest - The restored session's manifest.
 * @returns `{ restored: true }`.
 */
function restoredByBridge(ctx: WorkspaceCtx, manifest: Manifest): ReloadResult {
  if (takeRestore(ctx.state, manifest)) showToast(ctx, RESTORED_TOAST);
  return { restored: true };
}

/**
 * One reload run (steps 2–7 of the D-07 flow, with Bun's reload first after a save).
 *
 * @param ctx - Domain context of workspace.
 * @param iframe - The game frame.
 * @param opts - Restore and afterSave.
 * @param taken - A checkpoint taken before the run, restored instead of a new one.
 * @returns The result.
 */
async function runOnce(
  ctx: WorkspaceCtx,
  iframe: HTMLIFrameElement,
  opts: ReloadOptions,
  taken: Taken | undefined
): Promise<ReloadResult> {
  // A game outside the editor is reloaded there, not here.
  const link = ctx.require(linkPlugin);
  if (link.manifest()?.embedded === false) {
    showToast(ctx, "The game runs outside the editor · reload it there");
    return { restored: false, reason: "not_embedded" };
  }

  // Bun may already be reloading the page after the save: listen first, then bookmark.
  const fromBun = bunReload(ctx, link, opts.afterSave === true);
  const taking = taken ?? (opts.restore === true ? takeCheckpoint(ctx, link) : NOTHING_TAKEN);
  const reloaded = fromBun === undefined ? undefined : await fromBun;
  if (reloaded?.restored !== undefined) return restoredByBridge(ctx, reloaded);

  // The checkpoint is needed from here on: a failed bookmark is warned now.
  const checkpoint = await taking;
  if (ctx.state.stopped) return { ...TIMED_OUT };
  warnTaken(ctx, checkpoint);

  // No session from Bun: reload the frame here and wait for this tab's new session.
  const manifest = reloaded ?? (await reloadHere(ctx, link, iframe));
  if (manifest === undefined) {
    if (ctx.state.stopped) return { ...TIMED_OUT };
    const seconds = Math.round(ctx.config.reloadTimeoutMs / MS_PER_SECOND);
    showToast(ctx, `Game reloaded · no game connected after ${seconds} s`);
    return { ...TIMED_OUT };
  }

  // The new session: the bridge restored it already, or workspace restores its checkpoint.
  if (manifest.restored !== undefined) return restoredByBridge(ctx, manifest);
  return settle(ctx, link, manifest, checkpoint);
}

/**
 * Starts a run and records it as the pending one; when it ends and another call came in during
 * it, one more run starts with the same options (and takes its own checkpoint).
 *
 * @param ctx - Domain context of workspace.
 * @param iframe - The game frame.
 * @param opts - Restore and afterSave.
 * @param taken - A checkpoint taken before the run, if any.
 * @returns The run's result.
 */
function startRun(
  ctx: WorkspaceCtx,
  iframe: HTMLIFrameElement,
  opts: ReloadOptions,
  taken: Taken | undefined
): Promise<ReloadResult> {
  const { frame } = ctx.state;
  const pending: PendingReload = {
    promise: runOnce(ctx, iframe, opts, taken).then(result => {
      if (frame.reload === pending) frame.reload = undefined;
      if (pending.again && !ctx.state.stopped) void reloadFrame(ctx, opts);
      return result;
    }),
    again: false
  };
  frame.reload = pending;
  return pending.promise;
}

/**
 * Reloads the game frame (D-07). Before the first mount there is no frame: resolves
 * `not_mounted`. `gameFrame().reload()` is the after-save reload; the palette's reload is not.
 *
 * @param ctx - Domain context of workspace.
 * @param opts - `restore: true` bookmarks first and restores after; `afterSave: true` lets Bun's
 * own reload (hot reload on) come first.
 * @param taken - A checkpoint taken before (the Hot reload switch), restored instead of a new
 * bookmark.
 * @returns The result; a call during a run shares that run's promise.
 */
export function reloadFrame(
  ctx: WorkspaceCtx,
  opts: ReloadOptions,
  taken?: Taken
): Promise<ReloadResult> {
  const { iframe, reload } = ctx.state.frame;
  if (iframe === undefined) return Promise.resolve({ restored: false, reason: "not_mounted" });

  if (reload !== undefined) {
    reload.again = true;
    return reload.promise;
  }
  return startRun(ctx, iframe, opts, taken);
}
