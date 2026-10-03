/**
 * @file workspace plugin — the workspace hosts: one `<section data-workspace-host>` per workspace,
 * created with `document.createElement` on first use (also before mount, so panels can render in
 * its onStart), attached by the shell through a ref and never rendered into by Preact (the
 * foreign DOM rule): panels owns their content.
 */
import type { WorkspaceId, WorkspaceState } from "./types";
import { WORKSPACE_IDS, WORKSPACE_LABELS } from "./workspaces";

/**
 * The host element of a workspace, created on the first call; the same element for the life of
 * the app.
 *
 * @param state - Workspace state.
 * @param ws - The workspace.
 * @returns The host.
 * @example
 * ```ts
 * panels.mountInto("flow", hostOf(ctx.state, "flow"));
 * ```
 */
export function hostOf(state: WorkspaceState, ws: WorkspaceId): HTMLElement {
  const existing = state.dom.hosts.get(ws);
  if (existing !== undefined) return existing;

  const host = document.createElement("section");
  host.dataset.workspaceHost = ws;
  host.setAttribute("aria-label", WORKSPACE_LABELS[ws]);
  host.hidden = ws !== state.active;
  state.dom.hosts.set(ws, host);
  return host;
}

/**
 * Attaches every host to the shell container (append moves it from an older container) and
 * shows only the active one.
 *
 * @param state - Workspace state.
 * @param container - The shell's host container.
 * @example
 * ```ts
 * useLayoutEffect(() => attachHosts(ctx.state, containerRef.current!));
 * ```
 */
export function attachHosts(state: WorkspaceState, container: HTMLElement): void {
  for (const ws of WORKSPACE_IDS) {
    const host = hostOf(state, ws);
    if (host.parentElement !== container) container.append(host);
    host.hidden = ws !== state.active;
  }
}

/**
 * Removes every host from the page and forgets them (onStop).
 *
 * @param state - Workspace state.
 * @example
 * ```ts
 * removeHosts(ctx.state);
 * ```
 */
export function removeHosts(state: WorkspaceState): void {
  for (const host of state.dom.hosts.values()) host.remove();
  state.dom.hosts.clear();
}
