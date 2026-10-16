/**
 * @file workspace plugin — W12, starting the local preview (spec 11 § 5.3): mounts the one game
 * frame when it is not mounted yet (the frame layer the first `mount()` creates, docked by the
 * current workspace's preview prefs) and resolves once link lists the frame's own session. Two
 * calls in flight share one wait. A page without a game frame (the tools page of `moku-editor
 * perf`) rejects at once and mounts nothing; no session within 15 s rejects with where the frame
 * is mounted. onStop drops the wait without settling it: the page is going away.
 */
import { linkPlugin } from "../../link";
import { ERROR_PREFIX } from "../../registry/protocol";
import type { PendingStart, WorkspaceCtx, WorkspaceState } from "../types";
import { createFrameLayer, gameUrl, syncFrame } from "./frame";

/**
 * How long a start waits for the frame's session, in ms.
 */
export const START_TIMEOUT_MS = 15_000;

/**
 * The rejection of a start on a page without a game frame.
 */
const NO_FRAME = `${ERROR_PREFIX}workspace.startLocalPreview() needs a game frame.\n  This page shows a device only; open the tools page of moku-editor <game> to run the game here.`;

/**
 * The executor of a start after stop: the page is going away, so it never settles.
 */
function settleNever(): void {
  // Nothing settles: onStop rejects nothing.
}

/**
 * True unless this page is the tools page of `moku-editor perf`: its hub's device mode belongs to
 * perf (`editor.devices` reports `mode.owner` "other"), and perf serves no game to put in a frame.
 * Before connect published a directory the page counts as one with a game frame.
 *
 * @param ctx - Domain context of workspace.
 * @returns Whether a local preview can run on this page.
 */
export function pageHasGameFrame(ctx: Pick<WorkspaceCtx, "require">): boolean {
  return ctx.require(linkPlugin).published("devices")?.mode.owner !== "other";
}

/**
 * Waits for the frame's own session: resolves on the first session list in which
 * `link.ownSession()` answers, rejects after START_TIMEOUT_MS. Either way the listener and the
 * timer go, and the start is no longer pending.
 *
 * @param ctx - Domain context of workspace.
 * @returns The pending start.
 */
function waitForOwnSession(ctx: WorkspaceCtx): PendingStart {
  const { state } = ctx;
  const link = ctx.require(linkPlugin);
  let off: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  /**
   * Ends the wait without settling it.
   */
  const drop = (): void => {
    off?.();
    clearTimeout(timer);
    state.start = undefined;
  };

  const promise = new Promise<void>((resolve, reject) => {
    off = link.onSessions(() => {
      if (link.ownSession() === undefined) return;
      drop();
      resolve();
    });
    timer = setTimeout(() => {
      drop();
      reject(
        new Error(
          `${ERROR_PREFIX}The local preview did not start.\n  Check the game's console in the Console workspace; the frame is mounted at ${gameUrl(ctx)}.`
        )
      );
    }, START_TIMEOUT_MS);
  });
  return { promise, drop };
}

/**
 * Starts this page's local preview (`workspace.startLocalPreview()`); the contract is on
 * `WorkspaceApi` in `types.ts`.
 *
 * @param ctx - Domain context of workspace.
 * @returns When the frame's session is open.
 */
export function startLocalPreview(ctx: WorkspaceCtx): Promise<void> {
  const { state } = ctx;
  // After stop the page is going away: nothing is mounted and nothing settles.
  if (state.stopped) return new Promise<void>(settleNever);
  if (state.start !== undefined) return state.start.promise;
  if (!pageHasGameFrame(ctx)) return Promise.reject(new Error(NO_FRAME));
  if (ctx.require(linkPlugin).ownSession() !== undefined) return Promise.resolve();

  // The same mount the first mount() does; a frame that is already there stays as it is.
  createFrameLayer(ctx);
  syncFrame(ctx);
  state.start = waitForOwnSession(ctx);
  return state.start.promise;
}

/**
 * Drops a pending start without settling it (onStop).
 *
 * @param state - Workspace state.
 */
export function dropStart(state: WorkspaceState): void {
  state.start?.drop();
}
