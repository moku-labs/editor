/**
 * @file workspace plugin — W9, the source pill of the top bar (spec 11 § 5.3): "Local preview"
 * (neutral) or "<name> · by wire / on the network" (indigo tint), with a dot that is live while the
 * source's session is listed and heard and away otherwise. It opens the source menu (top layer,
 * under `[data-popover-anchor="source"]`): the local preview and every linked device, each with
 * Use, and Connect device…. Every Use goes through activeSource (`source.ts`).
 */
import type { VNode } from "preact";
import { activeSourcePlugin } from "../../activeSource";
import { linkPlugin } from "../../link";
import type { SessionInfo } from "../../registry/protocol";
import { closePopover, openPopover } from "../actions";
import { pageHasGameFrame } from "../frame/start";
import { chooseSource, deviceName, linkWords, openConnectPanel, sourcePill } from "../source";
import type { WorkspaceCtx } from "../types";
import { usePopover } from "./popover";
import { useElement, useWorkspace } from "./store";

/**
 * Props of `SourcePill`.
 */
export type SourcePillProps = { readonly ctx: WorkspaceCtx };

/**
 * One source of the menu.
 */
type SourceRowProps = {
  readonly name: string;
  readonly detail: string;
  /** The detail is an address: mono. */
  readonly mono: boolean;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly onUse: () => void;
};

/**
 * A row of the source menu: the name, the detail and "Use" unless it is the source or cannot act.
 *
 * @param props - The row.
 * @returns The row.
 */
function SourceRow(props: SourceRowProps): VNode {
  const { checked, disabled } = props;
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      aria-disabled={disabled ? "true" : undefined}
      onClick={() => {
        if (!disabled) props.onUse();
      }}
    >
      <span data-part="name">{props.name}</span>
      <span data-part="detail" data-mono={props.mono ? "" : undefined}>
        {props.detail}
      </span>
      {!checked && !disabled && <span data-part="use">Use</span>}
    </button>
  );
}

/**
 * The rows of the open source menu.
 *
 * @param props - The workspace domain context.
 * @param props.ctx - Domain context of workspace.
 * @returns The rows.
 */
function SourceRows(props: { readonly ctx: WorkspaceCtx }): VNode {
  const { ctx } = props;
  const link = ctx.require(linkPlugin);
  const current = ctx.require(activeSourcePlugin).current();
  const sessions = link.sessions();
  const directory = link.published("devices");
  const own = sessions.find(session => session.id === link.ownSession());
  const devices = sessions.flatMap(session =>
    session.device === undefined ? [] : [{ session, device: session.device }]
  );

  /**
   * Closes the menu and makes a session the source.
   *
   * @param session - The session.
   */
  const use = (session: SessionInfo): void => {
    closePopover(ctx.state, "source");
    chooseSource(ctx, session);
  };

  let localDetail = "This page's game";
  if (own === undefined)
    localDetail = pageHasGameFrame(ctx) ? "Not started" : "No game on this page";

  return (
    <>
      <SourceRow
        name="Local preview"
        detail={localDetail}
        mono={false}
        checked={current.kind === "local"}
        disabled={own === undefined}
        onUse={() => {
          if (own !== undefined) use(own);
        }}
      />
      {devices.map(({ session, device }) => (
        <SourceRow
          key={session.id}
          name={deviceName(device, directory)}
          detail={`${linkWords(device.link)} · ${device.address}`}
          mono
          checked={current.kind === "device" && current.session === session.id}
          disabled={false}
          onUse={() => use(session)}
        />
      ))}
      <hr />
      <button
        type="button"
        role="menuitem"
        data-action="connect-device"
        onClick={() => openConnectPanel(ctx)}
      >
        Connect device…
      </button>
    </>
  );
}

/**
 * The source menu (top layer), placed under the pill.
 *
 * @param props - The workspace domain context.
 * @returns The menu.
 */
function SourceMenu(props: SourcePillProps): VNode {
  const { ctx } = props;
  const { state } = ctx;
  useWorkspace(state.ui, () => state.ui.version);
  const menu = useElement<HTMLElement>();
  const open = state.popover === "source";
  usePopover(menu, open, state, "source");

  return (
    <div data-ui="source-menu" popover="manual" role="menu" aria-label="Source" ref={menu.ref}>
      {open && <SourceRows ctx={ctx} />}
    </div>
  );
}

/**
 * The source pill and its menu.
 *
 * @param props - The workspace domain context.
 * @returns The pill.
 */
export function SourcePill(props: SourcePillProps): VNode {
  const { ctx } = props;
  const { state } = ctx;
  useWorkspace(state.ui, () => state.ui.version);
  const source = ctx.require(activeSourcePlugin);
  const current = source.current();
  const session = ctx
    .require(linkPlugin)
    .sessions()
    .find(item => item.id === current.session);
  const view = sourcePill(source.label(), session);
  const open = state.popover === "source";
  const text = view.via === undefined ? view.name : `${view.name} · ${view.via}`;

  return (
    <span data-ui="source-pill" data-kind={view.kind} data-state={view.live ? "live" : "away"}>
      <button
        type="button"
        data-popover-anchor="source"
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Source: ${text}${view.live ? "" : " (away)"} · choose the source`}
        onClick={() => {
          if (open) closePopover(state, "source");
          else openPopover(state, "source");
        }}
      >
        <span data-dot aria-hidden="true" />
        <span data-part="name">{view.name}</span>
        {view.via !== undefined && <span data-part="via">{` · ${view.via}`}</span>}
      </button>
      <SourceMenu ctx={ctx} />
    </span>
  );
}
