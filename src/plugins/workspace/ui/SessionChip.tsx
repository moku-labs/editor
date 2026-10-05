/**
 * @file workspace plugin — the session chip of the top bar (900 px and wider): the short id of the
 * chosen session with its connect time; with more than one session it opens the session menu
 * (game, page, "embedded", connect time) whose rows call `link.choose`. Below 900 px the chip is
 * gone: the link pill names the session and opens the same menu (`SessionMenu`, anchored to
 * `[data-popover-anchor="session"]`).
 */
import type { VNode } from "preact";
import { linkPlugin } from "../../link";
import type { SessionInfo } from "../../registry/protocol";
import { closePopover, openPopover } from "../actions";
import type { WorkspaceCtx } from "../types";
import { usePopover } from "./popover";
import { useElement, useWorkspace } from "./store";
import { clockTime, heldNames } from "./text";

/**
 * Props of `SessionChip` and `SessionMenu`.
 */
export type SessionChipProps = { readonly ctx: WorkspaceCtx };

/**
 * Longest id shown in the chip.
 */
const SHORT_ID = 8;

/**
 * The sessions as the chip, the pill and the menu read them.
 */
export type SessionsView = {
  readonly sessions: readonly SessionInfo[];
  /** The chosen session id. */
  readonly current: string | undefined;
  /** The chosen session's info, when listed. */
  readonly info: SessionInfo | undefined;
  /** More than one session: the menu can open. */
  readonly many: boolean;
};

/**
 * Reads the sessions from link. While the link reloads, the chosen session is the last one shown
 * (`heldNames`, U9: the chip keeps its id and its width).
 *
 * @param ctx - Domain context of workspace.
 * @returns The sessions, the chosen one and whether there are several.
 */
export function sessionsView(ctx: WorkspaceCtx): SessionsView {
  const link = ctx.require(linkPlugin);
  const sessions = link.sessions();
  const current = link.session() ?? heldNames(ctx.state.link, ctx.state.shown).session;
  return {
    sessions,
    current,
    info: sessions.find(session => session.id === current),
    many: sessions.length > 1
  };
}

/**
 * Opens a closed session menu, closes an open one; does nothing with one session.
 *
 * @param ctx - Domain context of workspace.
 * @param many - Whether there is more than one session.
 */
export function toggleSessionMenu(ctx: WorkspaceCtx, many: boolean): void {
  if (!many) return;
  if (ctx.state.popover === "session") closePopover(ctx.state, "session");
  else openPopover(ctx.state, "session");
}

/**
 * Picks a session from the menu.
 *
 * @param ctx - Domain context of workspace.
 * @param session - The session.
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
 * The session menu (top layer), placed under `[data-popover-anchor="session"]`. Render it only
 * while there is more than one session.
 *
 * @param props - The workspace domain context.
 * @returns The menu.
 */
export function SessionMenu(props: SessionChipProps): VNode {
  const { ctx } = props;
  const { state } = ctx;
  useWorkspace(state.ui, () => state.ui.version);
  const menu = useElement<HTMLElement>();
  const { sessions, current, many } = sessionsView(ctx);
  const open = many && state.popover === "session";
  usePopover(menu, open, state, "session");

  return (
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
  );
}

/**
 * The session chip and its menu.
 *
 * @param props - The workspace domain context.
 * @returns The chip.
 */
export function SessionChip(props: SessionChipProps): VNode {
  const { ctx } = props;
  const { state } = ctx;
  useWorkspace(state.ui, () => state.ui.version);
  const { current, info, many } = sessionsView(ctx);
  const open = many && state.popover === "session";

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
        onClick={() => toggleSessionMenu(ctx, many)}
      >
        {current.slice(0, SHORT_ID)}
      </button>
      {many && <SessionMenu ctx={ctx} />}
    </span>
  );
}
