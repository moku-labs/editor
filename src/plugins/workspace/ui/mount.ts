/**
 * @file workspace plugin — mounting the shell (R3): the tools page entry calls
 * `workspace.mount(el)` after `start()`. The first call creates the frame layer in
 * `document.body`; a later call with another element moves the shell (hosts included) and leaves
 * the frame layer where it is.
 */
import { h, render } from "preact";
import { createFrameLayer, syncFrame } from "../frame/frame";
import { showTheme } from "../prefs/apply";
import type { WorkspaceCtx, WorkspaceState } from "../types";
import { Shell } from "./Shell";

/**
 * Renders the shell into an element. Does nothing after stop.
 *
 * @param ctx - Domain context of workspace.
 * @param element - The mount element (`[data-editor-root]`).
 */
export function mountShell(ctx: WorkspaceCtx, element: HTMLElement): void {
  const { state } = ctx;
  if (state.stopped) return;

  showTheme(state);
  createFrameLayer(ctx);
  const previous = state.dom.root;
  if (previous !== undefined && previous !== element) render(undefined, previous);
  state.dom.root = element;
  render(h(Shell, { ctx }), element);
  syncFrame(ctx);
}

/**
 * Unrenders the shell (onStop).
 *
 * @param state - Workspace state.
 */
export function unmountShell(state: WorkspaceState): void {
  const { root } = state.dom;
  if (root === undefined) return;
  render(undefined, root);
  state.dom.root = undefined;
}
