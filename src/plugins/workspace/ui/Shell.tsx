/**
 * @file workspace plugin — the shell grid: top bar 44 px, rail 52 px, content with the workspace
 * hosts (foreign DOM attached by ref), stale bar, status cards, toasts, palette.
 */
import type { VNode } from "preact";
import type { WorkspaceCtx } from "../types";

/**
 * Props of the shell.
 */
export type ShellProps = { readonly ctx: WorkspaceCtx };

/**
 * The tools shell, rendered by `workspace.mount(el)`.
 *
 * @param _props - The workspace domain context.
 * @example
 * ```tsx
 * render(<Shell ctx={ctx} />, element);
 * ```
 */
export function Shell(_props: ShellProps): VNode {
  throw new Error("not implemented");
}
