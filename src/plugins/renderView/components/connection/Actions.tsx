/**
 * @file renderView components (connection) — the actions of the bar (spec 09 § M7): the muted note
 * and "Start local preview" on the local preview, the Monitoring button ("{n} on, ~{x} ms") with its
 * popover, Record, the Connect split button ("Connect device" / "Switch device", its menu and the
 * Connect panel) and, on a device, "Use local preview" (the phone stays linked).
 */
import type { JSX } from "preact";
import { activeSourcePlugin } from "../../../activeSource";
import { linkPlugin } from "../../../link";
import { closeConnect, openConnect, startLocal, useLocalPreview } from "../../actions/connect";
import { togglePopover } from "../../actions/popover";
import { splitMenu } from "../../derive/connect";
import { actionsNote } from "../../derive/connection";
import { memoryMeasured } from "../../derive/mission";
import { monitoringRows, monitoringTotals } from "../../derive/monitoring";
import { commandAllowed } from "../../source/listed";
import { notifyMission } from "../../state";
import type { RenderViewCtx } from "../../types";
import { MissionIcon } from "../icons";
import { start } from "../start";
import { ConnectPanel } from "./ConnectPanel";
import { MonitoringPopover } from "./MonitoringPopover";
import { Popover } from "./Popover";
import { RecordControl } from "./RecordControl";

/**
 * Props of `Actions`.
 */
export type ActionsProps = { readonly ctx: RenderViewCtx };

/**
 * The Monitoring button's small text: "{n} on, ~{x} ms", or "{n} on" without a measured cost.
 *
 * @param ctx - Domain context of renderView.
 * @returns The words; undefined before the first monitoring state.
 */
function monitoringSmall(ctx: RenderViewCtx): string | undefined {
  const { mission } = ctx.state;
  const second = mission.second;
  const monitor = second?.monitor;
  if (second === undefined || monitor === undefined) return undefined;
  const rows = monitoringRows({
    monitor,
    caps: second.caps,
    memoryMeasured: memoryMeasured(mission),
    control: commandAllowed(ctx.require(linkPlugin).manifest(), "editor.perf.sections")
  });
  return monitoringTotals(monitor, rows, second.budgetMs, mission.source?.kind === "device").button;
}

/**
 * The Monitoring button and its popover.
 *
 * @param props - ctx and whether nothing runs.
 * @param props.ctx - Domain context of renderView.
 * @param props.disabled - Nothing is running.
 * @returns The anchor.
 */
function MonitoringButton(props: {
  readonly ctx: RenderViewCtx;
  readonly disabled: boolean;
}): JSX.Element {
  const { ctx, disabled } = props;
  const { mission } = ctx.state;
  const open = mission.popover === "monitoring";
  const small = monitoringSmall(ctx);
  return (
    <span data-anchor>
      <button
        type="button"
        data-variant="outline"
        data-popover-trigger="monitoring"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          togglePopover(mission, "monitoring");
          notifyMission(mission);
        }}
      >
        <MissionIcon name="gauge" />
        Monitoring
        {small === undefined ? undefined : <small>{small}</small>}
      </button>
      {open ? <MonitoringPopover ctx={ctx} /> : undefined}
    </span>
  );
}

/**
 * The Connect split button: the main part opens the Connect panel, the chevron its menu.
 *
 * @param props - ctx and whether a device is the source.
 * @param props.ctx - Domain context of renderView.
 * @param props.device - A device is the source ("Switch device").
 * @returns The anchor.
 */
function ConnectSplit(props: {
  readonly ctx: RenderViewCtx;
  readonly device: boolean;
}): JSX.Element {
  const { ctx, device } = props;
  const { mission } = ctx.state;
  const variant = device ? "outline" : "primary";
  const size = device ? undefined : "lg";
  const items = splitMenu(ctx.require(activeSourcePlugin).directory());
  return (
    <span data-anchor>
      <span data-split>
        <button
          type="button"
          data-variant={variant}
          data-size={size}
          data-popover-trigger="connect"
          data-action="connect"
          aria-haspopup="dialog"
          aria-expanded={mission.popover === "connect"}
          onClick={() => {
            if (mission.popover === "connect") closeConnect(mission);
            else openConnect(ctx);
          }}
        >
          <MissionIcon name="phone" />
          {device ? "Switch device" : "Connect device"}
        </button>
        <button
          type="button"
          data-variant={variant}
          data-size={size}
          data-part="chevron"
          data-popover-trigger="split"
          aria-label="Ways to connect"
          aria-haspopup="menu"
          aria-expanded={mission.popover === "split"}
          onClick={() => {
            togglePopover(mission, "split");
            notifyMission(mission);
          }}
        >
          <MissionIcon name="chevron" size={14} />
        </button>
      </span>
      {mission.popover === "split" ? (
        <Popover ctx={ctx} id="split" role="menu" label="Ways to connect">
          {items.map(item => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              data-tab={item.id}
              onClick={() => (item.id === "linked" ? openConnect(ctx) : openConnect(ctx, item.id))}
            >
              <MissionIcon name={item.id === "network" ? "wifi" : "wire"} />
              <span>
                {item.label}
                <small>{item.sub}</small>
              </span>
            </button>
          ))}
        </Popover>
      ) : undefined}
      {mission.popover === "connect" ? <ConnectPanel ctx={ctx} /> : undefined}
    </span>
  );
}

/**
 * The actions of the bar.
 *
 * @param props - ctx.
 * @returns The actions.
 */
export function Actions(props: ActionsProps): JSX.Element {
  const { ctx } = props;
  const source = ctx.state.mission.source ?? ctx.require(activeSourcePlugin).current();
  const notStarted = source.kind === "local" && source.session === null;
  const device = source.kind === "device";
  const note = actionsNote(source);
  return (
    <div data-part="actions">
      {note === undefined ? undefined : <span data-part="note">{note}</span>}
      {notStarted ? (
        <button
          type="button"
          data-variant="outline"
          data-action="start-local"
          onClick={() => start(ctx, startLocal(ctx))}
        >
          <MissionIcon name="play" size={14} />
          Start local preview
        </button>
      ) : undefined}
      <MonitoringButton ctx={ctx} disabled={notStarted} />
      <RecordControl ctx={ctx} />
      <ConnectSplit ctx={ctx} device={device} />
      {device ? (
        <button
          type="button"
          data-variant="ghost"
          data-action="use-local"
          title="The phone stays linked; switch back from Linked devices"
          onClick={() => start(ctx, useLocalPreview(ctx))}
        >
          <MissionIcon name="unplug" />
          Use local preview
        </button>
      ) : undefined}
    </div>
  );
}
