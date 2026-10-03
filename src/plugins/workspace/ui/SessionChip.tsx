/**
 * @file workspace plugin — the session chip of the top bar: the short id of the chosen session
 * with its connect time; with more than one session it opens a menu (game, page, "embedded",
 * connect time) whose rows call `link.choose`.
 */
import type { VNode } from "preact";
import { linkPlugin } from "../../link";
import type { SessionInfo } from "../../registry/protocol";
import { closePopover, openPopover } from "../actions";
import type { WorkspaceCtx } from "../types";
import { usePopover } from "./popover";
import { useElement, useWorkspace } from "./store";
import { clockTime } from "./text";

/**
 * Props of `SessionChip`.
 */
export type SessionChipProps = { readonly ctx: WorkspaceCtx };

/**
 * Longest id shown in the chip.
 */
const SHORT_ID = 8;

/**
 * Picks a session from the menu.
 *
 * @param ctx - Domain context of workspace.
 * @param session - The session.
 * @example
 * ```ts
 * choose(ctx, session);
 * ```
 */
function choose(ctx: WorkspaceCtx, session: SessionInfo): void {
  closePopover(ctx.state, "session");
  ctx
    .require(linkPlugin)
    .choose(session.id)
    .catch((error: unknown) => {
      ctx.log.warn("workspace:choose-failed", { session: session.id, error: String(error) });
    });
}

/**
 * The session chip and its menu.
 *
 * @param props - The workspace domain context.
 * @returns The chip.
 * @example
 * ```tsx
 * <SessionChip ctx={ctx} />
 * ```
 */
export function SessionChip(props: SessionChipProps): VNode {
  const { ctx } = props;
  const { state } = ctx;
  useWorkspace(state.ui, () => state.ui.version);
  const menu = useElement<HTMLElement>();
  const link = ctx.require(linkPlugin);
  const sessions = link.sessions();
  const current = link.session();
  const info = sessions.find(session => session.id === current);
  const many = sessions.length > 1;
  const open = many && state.popover === "session";
  usePopover(menu, open, state, "session");

  if (current === undefined) {
    return (
      <span data-ui="session-chip" data-chip data-empty>
        no session
      </span>
    );
  }
  return (
    <span data-ui="session-chip">
      <button
        type="button"
        data-chip
        data-popover-anchor="session"
        title={info === undefined ? current : `connected ${clockTime(info.connectedAt)}`}
        aria-haspopup={many ? "menu" : undefined}
        aria-expanded={many ? open : undefined}
        onClick={() => {
          if (!many) return;
          if (open) closePopover(state, "session");
          else openPopover(state, "session");
        }}
      >
        {current.slice(0, SHORT_ID)}
      </button>
      {many && (
        <div data-ui="session-menu" popover="manual" role="menu" ref={menu.ref}>
          {open &&
            sessions.map(session => (
              <button
                type="button"
                role="menuitemradio"
                aria-checked={session.id === current}
                key={session.id}
                onClick={() => choose(ctx, session)}
              >
                <span data-mono>{session.game}</span>
                <span data-muted>{session.page}</span>
                {session.embedded && <span data-tag="acc">embedded</span>}
                <span data-mono data-muted>
                  {clockTime(session.connectedAt)}
                </span>
              </button>
            ))}
        </div>
      )}
    </span>
  );
}
