/**
 * @file workspace plugin — `manifest.restored` (round 2 R6): the bridge bookmarked the game before
 * Bun's full reload and restored it (and its pause) on the new page, so workspace never restores
 * or pauses again; it only tells the person, once per restore. A reload waiting for that session
 * (`frame/reload.ts`) toasts it itself; otherwise the manifest listener of onStart does (an
 * outside edit, such as an agent writing a file).
 */
import { linkPlugin } from "../../link";
import type { Manifest } from "../../registry/protocol";
import { showToast } from "../toasts";
import type { WorkspaceCtx, WorkspaceState } from "../types";

/**
 * The toast of a session that came back with its state.
 *
 * @example
 * ```ts
 * RESTORED_TOAST; // "Game reloaded · state restored"
 * ```
 */
export const RESTORED_TOAST = "Game reloaded · state restored";

/**
 * True the first time a manifest reports a restore: it is remembered by frame and bookmark, so
 * the same hello seen again (a re-attach) is not a new restore.
 *
 * @param state - Workspace state.
 * @param manifest - A manifest, undefined when the session was lost.
 * @returns Whether this restore is new.
 * @example
 * ```ts
 * takeRestore(state, { ...manifest, restored: { bookmark: "{}", frame: 12 } }); // true, then false
 * ```
 */
export function takeRestore(state: WorkspaceState, manifest: Manifest | undefined): boolean {
  const restored = manifest?.restored;
  if (restored === undefined) return false;

  const key = `${restored.frame}:${restored.bookmark}`;
  if (state.lastRestore === key) return false;
  state.lastRestore = key;
  return true;
}

/**
 * Toasts each new restore of the followed session while no reload waits for it. The manifest
 * that is already there when it subscribes is skipped.
 *
 * @param ctx - Config, state and require.
 * @returns Stops listening.
 */
export function watchRestores(ctx: Pick<WorkspaceCtx, "config" | "state" | "require">): () => void {
  const { state } = ctx;
  let armed = false;
  const off = ctx.require(linkPlugin).onManifest(manifest => {
    if (!armed || state.stopped || state.frame.reload !== undefined) return;
    if (takeRestore(state, manifest)) showToast(ctx, RESTORED_TOAST);
  });
  armed = true;
  return off;
}
