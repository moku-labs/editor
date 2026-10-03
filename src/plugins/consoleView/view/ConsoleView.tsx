/**
 * @file consoleView plugin — the Console workspace (A6): toolbar, the log table or the Console's
 * own empty state (F5), and the detail drawer of the selected line.
 */
import type { VNode } from "preact";
import { useMemo } from "preact/hooks";
import type { LinkStatus } from "../../registry/protocol";
import { createConsoleApi } from "../api";
import { emptyStateOf } from "../filter";
import type { ConsoleCtx } from "../types";
import { DetailDrawer } from "./DetailDrawer";
import { LogTable } from "./LogTable";
import { Toolbar } from "./Toolbar";
import { useConsole } from "./useConsole";

/**
 * Props of `ConsoleView`.
 *
 * @example
 * ```tsx
 * const props: ConsoleViewProps = { ctx, status: { kind: "live", frame: 1840 } };
 * ```
 */
export type ConsoleViewProps = { readonly ctx: ConsoleCtx; readonly status: LinkStatus };

/**
 * Whether a link status means a game is attached now.
 *
 * @param status - The link status.
 * @returns True while live, paused or silent.
 * @example
 * ```ts
 * isAttached({ kind: "paused", frame: 3 }); // true
 * ```
 */
function isAttached(status: LinkStatus): boolean {
  return status.kind === "live" || status.kind === "paused" || status.kind === "silent";
}

/**
 * The Console workspace: re-renders on every console change and on the link status of the panel.
 *
 * @param props - The ctx and the link status of this render.
 * @returns The workspace element.
 * @example
 * ```tsx
 * <ConsoleView ctx={ctx} status={tools.status} />
 * ```
 */
export function ConsoleView(props: ConsoleViewProps): VNode {
  const { ctx, status } = props;
  const api = useMemo(() => createConsoleApi(ctx), [ctx]);
  const view = useConsole(api, () => ({
    lines: api.lines(),
    visible: api.visible(),
    counts: api.counts(),
    filter: api.filter(),
    preserve: api.preserve(),
    selected: api.selected()
  }));
  const connected = ctx.state.everConnected || isAttached(status);
  const empty = emptyStateOf(view.lines, view.visible, connected);

  return (
    <div data-part="console">
      <Toolbar
        ctx={ctx}
        api={api}
        counts={view.counts}
        level={view.filter.level}
        query={view.filter.query}
        preserve={view.preserve}
      />
      <div data-body>
        {view.visible.length > 0 && (
          <LogTable
            ctx={ctx}
            api={api}
            lines={view.visible}
            query={view.filter.query}
            selected={view.selected?.key}
          />
        )}
        {empty !== undefined && (
          <p data-empty role="status">
            {empty}
          </p>
        )}
      </div>
      {view.selected !== undefined && <DetailDrawer api={api} line={view.selected} />}
    </div>
  );
}
