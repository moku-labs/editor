/**
 * @file workspace plugin — the Hot reload switch (round 2 R6, D-23, D-32): Bun HMR reloads the
 * game page after a save and the bridge restores its state. The state is link's (`hotReload()`,
 * published by the hub); only the bin owns it. A switch restarts the bin's server with HMR flipped
 * on the same port, and the game page must load again to gain or drop Bun's HMR client: workspace
 * takes the checkpoint before it asks, waits for this tab's game to connect to the restarted
 * server, then reloads the frame and restores the checkpoint. A game's own server refuses, and a
 * switch can fail: then the switch says how to change hot reload, as a toast and in its tooltip
 * until the state changes. The top-bar switch (900 px and wider), the ⋯ menu row and key H drive
 * it.
 */
import { linkPlugin } from "../link";
import type { LinkApi } from "../link/types";
import type { HotReload } from "../registry/protocol";
import type { Taken } from "./frame/reload";
import { nextManifest, reloadFrame, takeCheckpoint } from "./frame/reload";
import { showToast } from "./toasts";
import type { WorkspaceCtx } from "./types";

/**
 * What the switch says when the server refused a change (a game's own server), when the bin
 * could not switch, or when the state is not known yet.
 *
 * @param current - link's hot reload state, undefined before the hub reported it.
 * @param asked - The value that was asked for.
 * @returns How to change hot reload.
 * @example
 * ```ts
 * refusalHint({ hmr: true, owner: "bin" }, false);
 * // "Could not switch · start the bin with --no-hmr to turn hot reload off"
 * ```
 */
export function refusalHint(current: HotReload | undefined, asked: boolean): string {
  if (current === undefined) return "The editor server has not reported hot reload yet";
  if (current.owner === "server") return "The game's own server sets hot reload";
  return asked
    ? "Could not switch · start the bin without --no-hmr to turn hot reload on"
    : "Could not switch · start the bin with --no-hmr to turn hot reload off";
}

/**
 * True when the switch can ask for a change: only the bin owns hot reload.
 *
 * @param current - link's hot reload state.
 * @returns Whether a click asks the server.
 * @example
 * ```ts
 * canSwitchHotReload({ hmr: false, owner: "server" }); // false
 * ```
 */
export function canSwitchHotReload(current: HotReload | undefined): boolean {
  return current?.owner === "bin";
}

/**
 * The tooltip of the switch: key, state, who sets it, and the hint of the last refusal.
 *
 * @param current - link's hot reload state.
 * @param note - The hint kept after a refusal.
 * @returns The title.
 * @example
 * ```ts
 * hotReloadTitle({ hmr: true, owner: "bin" }, undefined);
 * // "Hot reload (H): on · Bun reloads the game after a save and keeps its state"
 * ```
 */
export function hotReloadTitle(current: HotReload | undefined, note: string | undefined): string {
  const base = baseTitle(current);
  return note === undefined ? base : `${base} · ${note}`;
}

/**
 * The tooltip without a refusal hint.
 *
 * @param current - link's hot reload state.
 * @returns The title.
 * @example
 * ```ts
 * baseTitle(undefined); // "Hot reload (H): waiting for the editor server"
 * ```
 */
function baseTitle(current: HotReload | undefined): string {
  if (current === undefined) return "Hot reload (H): waiting for the editor server";

  const state = `Hot reload (H): ${current.hmr ? "on" : "off"}`;
  if (current.owner === "server") return `${state} · the game's own server sets it`;
  return current.hmr
    ? `${state} · Bun reloads the game after a save and keeps its state`
    : `${state} · a save does not reload the game`;
}

/**
 * Shows the server's answer: a change toasts the new state; a refusal or a failure keeps the hint
 * for the tooltip and toasts it.
 *
 * @param ctx - State and config.
 * @param on - The asked value.
 * @param accepted - Whether the server made the change.
 * @param current - link's state after the answer.
 */
function showAnswer(
  ctx: Pick<WorkspaceCtx, "state" | "config">,
  on: boolean,
  accepted: boolean,
  current: HotReload | undefined
): void {
  const { state } = ctx;
  state.hotReloadNote = accepted ? undefined : refusalHint(current, on);
  showToast(ctx, state.hotReloadNote ?? `Hot reload ${on ? "on" : "off"}`);
  state.ui.bump();
}

/**
 * Asks link and shows the answer. After stop it only reports the answer.
 *
 * @param ctx - Domain context of workspace.
 * @param link - The link api.
 * @param on - The asked value.
 * @returns link's answer.
 */
async function ask(ctx: WorkspaceCtx, link: LinkApi, on: boolean): Promise<boolean> {
  const accepted = await link.setHotReload(on);
  if (!ctx.state.stopped) showAnswer(ctx, on, accepted, link.hotReload());
  return accepted;
}

/**
 * Waits for this tab's game to connect to the restarted server: then the server serves again and
 * the frame can load. A game outside the editor is not waited for. The listener is armed before
 * this returns.
 *
 * @param ctx - Domain context of workspace.
 * @param link - The link api.
 * @param signal - Ends the wait when the switch did not happen.
 * @returns Resolves once the game is back, or the wait ended (timeout, stop or abort).
 */
async function gameBack(ctx: WorkspaceCtx, link: LinkApi, signal: AbortSignal): Promise<void> {
  if (link.manifest()?.embedded === false) return;
  await nextManifest(ctx, link, ctx.config.reloadTimeoutMs, signal);
}

/**
 * Reloads the frame with the checkpoint taken before the switch, once the game is back (or the
 * wait ended): the page gains or drops Bun's HMR client.
 *
 * @param ctx - Domain context of workspace.
 * @param back - The wait for the game on the restarted server.
 * @param taken - The checkpoint taken before the switch.
 */
async function reloadWhenBack(ctx: WorkspaceCtx, back: Promise<void>, taken: Taken): Promise<void> {
  await back;
  if (!ctx.state.stopped) await reloadFrame(ctx, { restore: true }, taken);
}

/**
 * Switches the bin's hot reload (D-32): the checkpoint and the wait for the game come first,
 * because the bin restarts its server right after it answers; an accepted switch then reloads
 * the frame, a failed one ends the wait.
 *
 * @param ctx - Domain context of workspace.
 * @param link - The link api.
 * @param on - The asked value.
 * @returns link's answer.
 */
async function switchServer(ctx: WorkspaceCtx, link: LinkApi, on: boolean): Promise<boolean> {
  const taken = await takeCheckpoint(ctx, link);
  const cancel = new AbortController();
  const back = gameBack(ctx, link, cancel.signal);

  const accepted = await ask(ctx, link, on);
  if (accepted && !ctx.state.stopped) void reloadWhenBack(ctx, back, taken);
  else cancel.abort();
  return accepted;
}

/**
 * Asks the server for hot reload on or off through link and shows the answer. A change the bin
 * can make (it owns the server, HMR differs) restarts its server and reloads the game frame with
 * its state (D-32). After stop it only reports the answer.
 *
 * @param ctx - Domain context of workspace.
 * @param on - The asked value.
 * @returns link's answer: true when the bin owns the server and its HMR now equals `on`; false
 * otherwise. Never rejects.
 */
export function setHotReload(ctx: WorkspaceCtx, on: boolean): Promise<boolean> {
  const link = ctx.require(linkPlugin);
  const current = link.hotReload();
  const switches = canSwitchHotReload(current) && current?.hmr !== on;
  return switches ? switchServer(ctx, link, on) : ask(ctx, link, on);
}

/**
 * Flips hot reload (the switch, the ⋯ menu row, key H). A game's own server or an unknown state
 * cannot change: the hint toasts and nothing is asked.
 *
 * @param ctx - Domain context of workspace.
 */
export function toggleHotReload(ctx: WorkspaceCtx): void {
  const current = ctx.require(linkPlugin).hotReload();
  if (current === undefined || !canSwitchHotReload(current)) {
    showToast(ctx, refusalHint(current, !(current?.hmr ?? false)));
    return;
  }
  void setHotReload(ctx, !current.hmr);
}

/**
 * Follows link's hot reload state: each new state drops the last refusal hint and re-renders the
 * shell (onStart).
 *
 * @param ctx - State and require.
 * @returns Stops following.
 */
export function watchHotReload(ctx: Pick<WorkspaceCtx, "state" | "require">): () => void {
  const { state } = ctx;
  return ctx.require(linkPlugin).onHotReload(() => {
    state.hotReloadNote = undefined;
    state.ui.bump();
  });
}
