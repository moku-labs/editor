/**
 * @file workspace plugin — F1 toasts: one line, at most three (the oldest drops), each hides after
 * `toastMs`; hover or focus pauses it and leaving restarts its time. The Toasts component renders
 * `state.toasts`; every file write of the editor ends with one naming the file (contracts §6).
 */
import type { WorkspaceConfig, WorkspaceState } from "./types";

/**
 * At most this many toasts are visible.
 *
 * @example
 * ```ts
 * state.toasts.length <= MAX_TOASTS;
 * ```
 */
export const MAX_TOASTS = 3;

/**
 * The part of the workspace ctx the toasts need.
 */
export type ToastCtx = {
  readonly config: Readonly<WorkspaceConfig>;
  readonly state: WorkspaceState;
};

/**
 * Starts the hide timer of a toast.
 *
 * @param ctx - Config and state.
 * @param id - The toast id.
 * @returns The timer.
 * @example
 * ```ts
 * toast.timer = startTimer(ctx, toast.id);
 * ```
 */
function startTimer(ctx: ToastCtx, id: number): ReturnType<typeof setTimeout> {
  return setTimeout(() => {
    dismissToast(ctx.state, id);
  }, ctx.config.toastMs);
}

/**
 * Shows a toast; `file` renders in mono after a middle dot. Does nothing after stop.
 *
 * @param ctx - Config and state.
 * @param message - One line.
 * @param file - A file path to name, optional.
 * @example
 * ```ts
 * showToast(ctx, "✓ Note saved", ".moku/notes/2026-09-24-first-top-item.md");
 * ```
 */
export function showToast(ctx: ToastCtx, message: string, file?: string): void {
  const { state } = ctx;
  if (state.stopped) return;

  const id = state.nextToastId;
  state.nextToastId += 1;
  state.toasts.push({ id, message, file, timer: startTimer(ctx, id) });

  while (state.toasts.length > MAX_TOASTS) {
    const oldest = state.toasts.shift();
    clearTimeout(oldest?.timer);
  }
  state.ui.bump();
}

/**
 * Removes a toast and clears its timer.
 *
 * @param state - Workspace state.
 * @param id - The toast id.
 * @example
 * ```ts
 * dismissToast(ctx.state, toast.id);
 * ```
 */
export function dismissToast(state: WorkspaceState, id: number): void {
  const index = state.toasts.findIndex(toast => toast.id === id);
  if (index === -1) return;

  const [toast] = state.toasts.splice(index, 1);
  clearTimeout(toast?.timer);
  state.ui.bump();
}

/**
 * Pauses the hide timer of a toast (pointer over it or focus in it).
 *
 * @param ctx - Config and state.
 * @param id - The toast id.
 * @example
 * ```ts
 * <div onPointerEnter={() => pauseToast(ctx, toast.id)} />
 * ```
 */
export function pauseToast(ctx: ToastCtx, id: number): void {
  const toast = ctx.state.toasts.find(entry => entry.id === id);
  if (toast === undefined) return;

  clearTimeout(toast.timer);
  toast.timer = undefined;
}

/**
 * Restarts the full hide time of a paused toast.
 *
 * @param ctx - Config and state.
 * @param id - The toast id.
 * @example
 * ```ts
 * <div onPointerLeave={() => resumeToast(ctx, toast.id)} />
 * ```
 */
export function resumeToast(ctx: ToastCtx, id: number): void {
  const toast = ctx.state.toasts.find(entry => entry.id === id);
  if (toast === undefined) return;

  clearTimeout(toast.timer);
  toast.timer = startTimer(ctx, id);
}

/**
 * Removes every toast and its timer (onStop).
 *
 * @param state - Workspace state.
 * @example
 * ```ts
 * clearToasts(ctx.state);
 * ```
 */
export function clearToasts(state: WorkspaceState): void {
  for (const toast of state.toasts) clearTimeout(toast.timer);
  state.toasts = [];
}
