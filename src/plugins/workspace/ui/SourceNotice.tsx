/**
 * @file workspace plugin — W10, the shell's disconnect notice (spec 11 § 5.3, design S6): a
 * transient bar in the shell grid's second row, under the top bar, full width, in every
 * workspace, while `activeSource.notice()` holds. Text (the first sentence bold), Reconnect (Use
 * for a device that is back), Dismiss, and a timer line that shrinks to the notice's end (still,
 * dimmed, while Reconnect waits with no end). The region is a polite status that stays in the
 * document, so a notice that appears is announced. The notice closes by activeSource's timer
 * without an event; this component repaints at its end on its own.
 */
import type { VNode } from "preact";
import { useLayoutEffect, useMemo } from "preact/hooks";
import { activeSourcePlugin } from "../../activeSource";
import type { SourceNotice as Notice } from "../../activeSource/types";
import { Icon } from "../../panels/shared/icons";
import { dismissNotice, noticeParts, reconnectFromNotice } from "../source";
import type { WorkspaceCtx, WorkspaceState } from "../types";
import { useWorkspace } from "./store";

/**
 * Props of `SourceNotice`.
 */
export type SourceNoticeProps = { readonly ctx: WorkspaceCtx };

/**
 * The unplug glyph of the notice: a plug with its two prongs and cable, struck through (16 px,
 * the stroke of the shared icon set).
 *
 * @returns The SVG.
 */
function UnplugIcon(): VNode {
  return (
    <svg
      data-icon="unplug"
      width={16}
      height={16}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.4"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M6 2v2.5M10 2v2.5M4.5 4.5h7V7a3.5 3.5 0 0 1-7 0zM8 10.5V14M2 2l12 12" />
    </svg>
  );
}

/**
 * Repaints the shell when a notice with an end reaches it: activeSource closes it by its own
 * timer and emits nothing.
 *
 * @param state - Workspace state.
 * @param until - The notice's end (epoch ms); undefined or infinite for none.
 */
function useNoticeEnd(state: WorkspaceState, until: number | undefined): void {
  useLayoutEffect(() => {
    const timer =
      until === undefined || !Number.isFinite(until)
        ? undefined
        : setTimeout(
            () => {
              state.ui.bump();
            },
            Math.max(0, until - Date.now()) + 1
          );
    return () => {
      clearTimeout(timer);
    };
  }, [state, until]);
}

/**
 * The notice bar.
 *
 * @param props - The context and the notice.
 * @param props.ctx - Domain context of workspace.
 * @param props.notice - The notice that shows.
 * @returns The bar.
 */
function NoticeBar(props: { readonly ctx: WorkspaceCtx; readonly notice: Notice }): VNode {
  const { ctx, notice } = props;
  const pinned = !Number.isFinite(notice.until);
  const { lead, rest } = noticeParts(notice.text);
  // The timer line runs once per notice, from what is left of it when it first shows.
  const left = useMemo(() => Math.max(0, notice.until - Date.now()), [notice.until]);

  return (
    <div data-part="bar" data-pinned={pinned ? "" : undefined}>
      <UnplugIcon />
      <p data-part="message">
        {lead !== "" && <b>{lead}</b>}
        {rest}
      </p>
      <button
        type="button"
        data-variant="outline"
        data-size="sm"
        data-action="reconnect"
        onClick={() => reconnectFromNotice(ctx, notice)}
      >
        {notice.back ? "Use" : "Reconnect"}
      </button>
      <button
        type="button"
        data-variant="ghost"
        data-action="dismiss"
        aria-label="Dismiss"
        title="Dismiss"
        onClick={() => dismissNotice(ctx)}
      >
        <Icon name="close" />
      </button>
      <i
        data-part="timer"
        aria-hidden="true"
        style={pinned ? undefined : { "--notice-ms": `${left}ms` }}
      />
    </div>
  );
}

/**
 * The disconnect notice region of the shell.
 *
 * @param props - The workspace domain context.
 * @returns The region, with the bar while the notice holds.
 */
export function SourceNotice(props: SourceNoticeProps): VNode {
  const { ctx } = props;
  const { state } = ctx;
  useWorkspace(state.ui, () => state.ui.version);
  const notice = ctx.require(activeSourcePlugin).notice();
  useNoticeEnd(state, notice?.until);
  const shown = notice !== undefined && notice.until > Date.now();

  return (
    <div data-ui="source-notice" role="status" aria-live="polite">
      {shown && <NoticeBar ctx={ctx} notice={notice} />}
    </div>
  );
}
