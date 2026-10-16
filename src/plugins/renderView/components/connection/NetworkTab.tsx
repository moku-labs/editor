/**
 * @file renderView components (connection) — the Connect panel's "On the network" tab (spec 09 §
 * M7): "Listen on the network" while the LAN listener is off (nothing is scanned); listening, the
 * address the phone dials (large, copyable), "Waiting for a phone to dial {lan}" and what to do on the
 * phone; the phones asking to link, each with its 4-digit code; and the help text, always.
 */
import type { JSX } from "preact";
import { activeSourcePlugin } from "../../../activeSource";
import { listenNetwork } from "../../actions/connect";
import { askingRow, NETWORK_HELP, networkView } from "../../derive/connect";
import type { RenderViewCtx } from "../../types";
import { MissionIcon } from "../icons";
import { CodeText, Spinner } from "../parts";
import { start } from "../start";
import { AskingRow } from "./AskingRow";

/**
 * Props of `NetworkTab`.
 */
export type NetworkTabProps = { readonly ctx: RenderViewCtx };

/**
 * Copies a text to the clipboard (a refusal is logged: the address stays on screen to type).
 *
 * @param ctx - Domain context of renderView.
 * @param text - The text.
 */
function copy(ctx: RenderViewCtx, text: string): void {
  const clipboard = globalThis.navigator?.clipboard;
  if (clipboard !== undefined) start(ctx, clipboard.writeText(text));
}

/**
 * The listener part of the tab: listen, or the address and the waiting line.
 *
 * @param props - ctx.
 * @param props.ctx - Domain context of renderView.
 * @returns The part.
 */
function Listener(props: { readonly ctx: RenderViewCtx }): JSX.Element {
  const { ctx } = props;
  const view = networkView(ctx.require(activeSourcePlugin).directory());
  const { connect } = ctx.state.mission;
  if (view.kind === "listen") {
    return (
      <div data-part="listen">
        <button
          type="button"
          data-variant="primary"
          data-action="listen"
          disabled={connect.pending === "network"}
          onClick={() => start(ctx, listenNetwork(ctx))}
        >
          {connect.pending === "network" ? <Spinner /> : <MissionIcon name="wifi" size={14} />}
          Listen on the network
        </button>
        <p data-part="help">{view.note}</p>
        {connect.error?.key === "network" ? (
          <p data-part="error" role="alert">
            {connect.error.message}
          </p>
        ) : undefined}
      </div>
    );
  }
  return (
    <div data-part="listening">
      <p data-part="address">
        <span data-mono>{view.address}</span>
        <button
          type="button"
          data-variant="ghost"
          data-size="icon"
          aria-label="Copy the address"
          onClick={() => copy(ctx, view.address)}
        >
          <MissionIcon name="copy" />
        </button>
      </p>
      <p data-part="waiting">
        <Spinner />
        {view.waiting}
      </p>
      <p data-part="help">
        <CodeText text={view.instructions} />
      </p>
    </div>
  );
}

/**
 * The "On the network" tab.
 *
 * @param props - ctx.
 * @returns The tab's content.
 */
export function NetworkTab(props: NetworkTabProps): JSX.Element {
  const { ctx } = props;
  const directory = ctx.require(activeSourcePlugin).directory();
  const asking =
    directory === undefined ? [] : directory.asking.map(ask => askingRow(ask, directory.confirmIn));
  return (
    <div data-part="columns" data-columns="network">
      <section data-part="cell">
        <Listener ctx={ctx} />
        {asking.length === 0 ? undefined : (
          <ul data-part="devices">
            {asking.map(row => (
              <AskingRow key={row.ticket} ctx={ctx} row={row} />
            ))}
          </ul>
        )}
        <p data-part="note">
          <CodeText text={NETWORK_HELP} />
        </p>
      </section>
    </div>
  );
}
