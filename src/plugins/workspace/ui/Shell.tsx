/**
 * @file workspace plugin — the shell grid: top bar 44 px, rail 52 px, content with the workspace
 * hosts (foreign DOM attached by ref), stale bar, status cards, the preview, toasts, palette.
 */
import type { VNode } from "preact";
import { useLayoutEffect } from "preact/hooks";
import { attachHosts } from "../hosts";
import { Palette } from "../palette/Palette";
import type { WorkspaceCtx } from "../types";
import { Preview } from "./Preview";
import { Rail } from "./Rail";
import { StaleBar } from "./StaleBar";
import { cardKind, StatusCard } from "./StatusCard";
import { useElement, useWorkspace } from "./store";
import { Toasts } from "./Toasts";
import { TopBar } from "./TopBar";

/**
 * Props of the shell.
 */
export type ShellProps = { readonly ctx: WorkspaceCtx };

/**
 * The tools shell, rendered by `workspace.mount(el)`.
 *
 * @param props - The workspace domain context.
 * @returns The shell.
 */
export function Shell(props: ShellProps): VNode {
  const { ctx } = props;
  const { state } = ctx;
  useWorkspace(state.ui, () => state.ui.version);
  const hosts = useElement<HTMLDivElement>();
  const card = cardKind(state);

  useLayoutEffect(() => {
    if (hosts.current !== undefined) attachHosts(state, hosts.current);
  });

  return (
    <div data-ui="shell" data-workspace={state.active}>
      <TopBar ctx={ctx} />
      <Rail ctx={ctx} />
      <main data-shell-main>
        <StaleBar ctx={ctx} />
        <div
          data-shell-hosts
          data-faded={card === undefined ? undefined : ""}
          inert={card !== undefined}
          ref={hosts.ref}
        />
        <StatusCard ctx={ctx} />
        <Preview ctx={ctx} />
      </main>
      <Toasts ctx={ctx} />
      <Palette ctx={ctx} />
    </div>
  );
}
