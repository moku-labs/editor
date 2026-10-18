/**
 * @file renderView components (connection) — the Connect panel (spec 09 § M7 Connect panel, spec 11
 * § 0 honest v1 texts): "Connect a device" with its note, the tabs "By wire" / "On the network"
 * (`role="tablist"`), the success alert of a switch to a device, the tab's content, the linked devices
 * under both tabs and "Stop device mode" while the tools page owns device mode. Its scan lease is held
 * while it is open (openConnect / closePopover).
 */
import type { JSX } from "preact";
import { activeSourcePlugin } from "../../../activeSource";
import { stopDeviceMode } from "../../actions/connect";
import { CONNECT_NOTE, connectedAlert, STOP_TITLE } from "../../derive/connect";
import { notifyMission } from "../../state";
import type { RenderViewCtx } from "../../types";
import { MissionIcon } from "../icons";
import { start } from "../start";
import { LinkedList } from "./LinkedList";
import { NetworkTab } from "./NetworkTab";
import { Popover, PopoverHead } from "./Popover";
import { WireTab } from "./WireTab";

/**
 * Props of `ConnectPanel`.
 */
export type ConnectPanelProps = { readonly ctx: RenderViewCtx };

/** The two tabs. */
const TABS = [
  { id: "wire", label: "By wire", icon: "wire" },
  { id: "network", label: "On the network", icon: "wifi" }
] as const;

/**
 * The Connect panel.
 *
 * @param props - ctx.
 * @returns The panel.
 */
export function ConnectPanel(props: ConnectPanelProps): JSX.Element {
  const { ctx } = props;
  const { mission } = ctx.state;
  const { connect } = mission;
  const directory = ctx.require(activeSourcePlugin).directory();
  const alert = connect.alert === undefined ? undefined : connectedAlert(connect.alert);
  return (
    <Popover ctx={ctx} id="connect" label="Connect a device">
      <div data-connect-panel data-tab={connect.tab}>
        <PopoverHead ctx={ctx} id="connect" title="Connect a device">
          <span data-part="note">{CONNECT_NOTE}</span>
        </PopoverHead>
        <div role="tablist" aria-label="Ways to connect">
          {TABS.map(tab => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              data-tab={tab.id}
              aria-selected={connect.tab === tab.id}
              onClick={() => {
                connect.tab = tab.id;
                notifyMission(mission);
              }}
            >
              <MissionIcon name={tab.icon} />
              {tab.label}
            </button>
          ))}
        </div>
        {alert === undefined ? undefined : (
          <div data-alert="ok" role="status">
            <b>{alert.strong}</b>
            <p>{alert.rest}</p>
          </div>
        )}
        <div role="tabpanel" aria-label={connect.tab === "wire" ? "By wire" : "On the network"}>
          {connect.tab === "wire" ? <WireTab ctx={ctx} /> : <NetworkTab ctx={ctx} />}
          <LinkedList ctx={ctx} />
        </div>
        {directory?.mode.owner === "connect" ? (
          <footer>
            <button
              type="button"
              data-variant="ghost"
              data-action="stop-devices"
              title={STOP_TITLE}
              disabled={connect.pending === "stop"}
              onClick={() => start(ctx, stopDeviceMode(ctx))}
            >
              Stop device mode
            </button>
          </footer>
        ) : undefined}
      </div>
    </Popover>
  );
}
