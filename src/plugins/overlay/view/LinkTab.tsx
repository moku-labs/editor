/**
 * @file overlay plugin — the Link tab (C6, F3): the four mode keys, the computer address with
 * Connect / Pair (an `overlay:connect` intent, never a bridge call), the pairing code, the STALE
 * caution, the live box with the engine line, the last-seen line, the no-bridge note.
 */
import type { VNode } from "preact";
import type { OverlayActions } from "../actions";
import { COLOUR } from "../model/format";
import type { EngineLineView, LinkTabView } from "../model/types";
import { EngineLine } from "./EngineLine";
import { Legend, legendOf } from "./Legend";

/**
 * The Link tab.
 *
 * @param props - The Link tab view, the engine line and the actions.
 * @param props.tab - The Link tab view.
 * @param props.engine - The engine line (inline under the live box).
 * @param props.actions - The actions.
 * @returns The tab's content.
 */
export function LinkTab(props: {
  readonly tab: LinkTabView;
  readonly engine: EngineLineView;
  readonly actions: OverlayActions;
}): VNode {
  const { tab, actions } = props;
  const { address } = tab;
  return (
    <>
      <div data-part="modes">
        {tab.keys.map(key => (
          <div
            key={key.kind}
            data-part="mode"
            data-link={key.kind}
            data-lit={key.lit ? "" : undefined}
            data-candidate={key.candidate ? "" : undefined}
            style={`--c: ${key.colour}`}
          >
            <b>{key.word}</b>
            <i>{key.sub}</i>
          </div>
        ))}
      </div>
      {address === undefined ? undefined : (
        <div data-part="address">
          <span data-part="address-label">Computer address</span>
          <input
            data-part="field"
            type="text"
            inputMode="url"
            value={address.value}
            placeholder={address.placeholder}
            readOnly={address.readOnly}
            disabled={address.disabled}
            aria-label="Computer address"
            onInput={event => {
              actions.addressDraft(event.currentTarget.value);
            }}
          />
          {address.action === undefined ? (
            <span data-part="tag">{address.tag}</span>
          ) : (
            <button
              type="button"
              data-part="button"
              data-action={address.action}
              disabled={address.disabled}
              onClick={actions.connect}
            >
              {address.action === "pair" ? "Pair" : "Connect"}
            </button>
          )}
        </div>
      )}
      {tab.error === undefined ? undefined : (
        <p data-part="hint" role="alert">
          {tab.error}
        </p>
      )}
      {tab.pairing === undefined ? undefined : (
        <div data-pairing={tab.pairing}>
          <div data-part="code">{tab.pairing}</div>
          <p>
            <b>Waiting for the computer</b>
            Type this code in the moku-editor perf terminal to confirm the phone.
          </p>
        </div>
      )}
      {tab.caution === undefined ? undefined : (
        <div data-caution="">
          <Legend legend={legendOf("STALE", COLOUR.caution, true)} />
          <p>
            This phone runs engine <b>{tab.caution.phone}</b>, the computer has{" "}
            <b>{tab.caution.computer}</b>. Rebuild the game so the logs match.
          </p>
        </div>
      )}
      {tab.live === undefined ? undefined : (
        <div data-part="live">
          <b>{tab.live.title}</b>
          <span>{tab.live.text}</span>
        </div>
      )}
      {tab.engineInline ? <EngineLine engine={props.engine} inline /> : undefined}
      {tab.seen === undefined ? undefined : (
        <p data-part="seen">
          Last seen <b>{tab.seen.value}</b>
          {tab.seen.rest}
        </p>
      )}
      {tab.note === undefined ? undefined : <p data-part="note">{tab.note}</p>}
    </>
  );
}
