/**
 * @file workspace plugin — the Hot reload switch (round 2 R6, D-23): Bun HMR reloads the game page
 * after a save and the bridge restores its state. The state is link's (`hotReload()`, published by
 * the hub); only the bin owns it. Bun 1.3.14 cannot switch HMR on a running server, so the server
 * refuses a change (pages README, spike) and the switch says how to change it: a toast, and the
 * hint in its tooltip until the state changes. The top-bar switch (900 px and wider), the ⋯ menu
 * row and key H drive it.
 */
import { linkPlugin } from "../link";
import type { HotReload } from "../registry/protocol";
import { showToast } from "./toasts";
import type { WorkspaceCtx } from "./types";

/**
 * The part of the workspace ctx the switch needs.
 */
type HotReloadCtx = Pick<WorkspaceCtx, "state" | "config" | "require">;

/**
 * What the switch says when the server refused a change, or cannot take one.
 *
 * @param current - link's hot reload state, undefined before the hub reported it.
 * @param asked - The value that was asked for.
 * @returns How to change hot reload.
 * @example
 * ```ts
 * refusalHint({ hmr: true, owner: "bin" }, false); // "Start the bin with --no-hmr to turn hot reload off"
 * ```
 */
export function refusalHint(current: HotReload | undefined, asked: boolean): string {
  if (current === undefined) return "The editor server has not reported hot reload yet";
  if (current.owner === "server") return "The game's own server sets hot reload";
  return asked
    ? "Start the bin without --no-hmr to turn hot reload on"
    : "Start the bin with --no-hmr to turn hot reload off";
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
 * Shows the server's answer: a change toasts the new state; a refusal keeps the hint for the
 * tooltip and toasts it.
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
 * Asks the server for hot reload on or off through link and shows the answer. After stop it only
 * reports the answer.
 *
 * @param ctx - State, config and require.
 * @param on - The asked value.
 * @returns link's answer: true when the server answers with its HMR equal to `on` (never
 * rejects).
 */
export async function setHotReload(ctx: HotReloadCtx, on: boolean): Promise<boolean> {
  const link = ctx.require(linkPlugin);
  const accepted = await link.setHotReload(on);
  if (!ctx.state.stopped) showAnswer(ctx, on, accepted, link.hotReload());
  return accepted;
}

/**
 * Flips hot reload (the switch, the ⋯ menu row, key H). A game's own server or an unknown state
 * cannot change: the hint toasts and nothing is asked.
 *
 * @param ctx - State, config and require.
 */
export function toggleHotReload(ctx: HotReloadCtx): void {
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
