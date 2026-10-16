/**
 * @file renderView components (connection) — the Connect panel's "By wire" tab (spec 09 § M7): two
 * columns. "Android by USB": the help line, the phones adb lists by phase (Connect, a spinner while
 * the game starts, Use or Connected for a linked phone, the warnings of an unauthorized or release
 * build; a rejection under its row), "No phone on USB …" or the adb-missing line. "iPhone and iPad":
 * the fixed line that there is no iOS debug build to link yet.
 */
import type { JSX } from "preact";
import { activeSourcePlugin } from "../../../activeSource";
import { connectSerial, useSession } from "../../actions/connect";
import type { CableRow } from "../../derive/connect";
import {
  ADB_MISSING,
  CABLE_EMPTY,
  CABLE_HELP,
  CABLE_TITLE,
  cableRow,
  IPHONE_LINE
} from "../../derive/connect";
import type { RenderViewCtx } from "../../types";
import { MissionIcon } from "../icons";
import { CodeText, Spinner } from "../parts";
import { start } from "../start";

/**
 * Props of `WireTab`.
 */
export type WireTabProps = { readonly ctx: RenderViewCtx };

/**
 * The right side of a phone's row.
 *
 * @param props - ctx and the row.
 * @param props.ctx - Domain context of renderView.
 * @param props.row - The row.
 * @returns The action.
 */
function RowAction(props: { readonly ctx: RenderViewCtx; readonly row: CableRow }): JSX.Element {
  const { ctx, row } = props;
  const { action } = row;
  if (ctx.state.mission.connect.pending === row.key) {
    return (
      <span data-part="pending">
        <Spinner />
        Connecting…
      </span>
    );
  }
  switch (action.kind) {
    case "connect": {
      return (
        <button
          type="button"
          data-variant="primary"
          data-size="sm"
          data-action="connect-device"
          onClick={() => start(ctx, connectSerial(ctx, row.key))}
        >
          Connect
        </button>
      );
    }
    case "use": {
      return (
        <button
          type="button"
          data-variant="outline"
          data-size="sm"
          data-action="use"
          onClick={() => start(ctx, useSession(ctx, action.session))}
        >
          Use
        </button>
      );
    }
    case "spinner": {
      return (
        <span data-part="pending">
          <Spinner />
          {action.text}
        </span>
      );
    }
    default: {
      return <span data-tag={action.tone === "muted" ? "mut" : action.tone}>{action.text}</span>;
    }
  }
}

/**
 * The "By wire" tab.
 *
 * @param props - ctx.
 * @returns The tab's content.
 */
export function WireTab(props: WireTabProps): JSX.Element {
  const { ctx } = props;
  const activeSource = ctx.require(activeSourcePlugin);
  const directory = activeSource.directory();
  const current = ctx.state.mission.source ?? activeSource.current();
  const linked = directory?.linked ?? [];
  const rows = (directory?.wire ?? []).map(device => cableRow(device, current, linked));
  const { error } = ctx.state.mission.connect;
  const adbMissing = directory?.adb.available === false;
  return (
    <div data-part="columns" data-columns="wire">
      <section data-part="cell">
        <h4>{CABLE_TITLE}</h4>
        <p data-part="help">
          <CodeText text={CABLE_HELP} />
        </p>
        <ul data-part="devices">
          {adbMissing ? <li data-part="empty">{ADB_MISSING}</li> : undefined}
          {!adbMissing && rows.length === 0 ? <li data-part="empty">{CABLE_EMPTY}</li> : undefined}
          {rows.map(row => (
            <li
              key={row.key}
              data-device-row
              data-serial={row.key}
              aria-disabled={row.disabled ? "true" : undefined}
            >
              <span data-part="tile">
                <MissionIcon name="wire" />
              </span>
              <div data-part="text">
                <b>{row.title}</b>
                <span>{row.sub}</span>
              </div>
              <div data-part="right">
                <RowAction ctx={ctx} row={row} />
              </div>
              {error?.key === row.key ? (
                <p data-part="error" role="alert">
                  {error.message}
                </p>
              ) : undefined}
            </li>
          ))}
        </ul>
      </section>
      <section data-part="cell">
        <h4>iPhone and iPad</h4>
        <p data-part="help">{IPHONE_LINE}</p>
      </section>
    </div>
  );
}
