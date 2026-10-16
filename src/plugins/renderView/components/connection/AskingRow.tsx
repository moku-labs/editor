/**
 * @file renderView components (connection) — an "Asking to link" row (spec 09 § M7, spec 11 § 0.2):
 * "{model} at {address}", "type the code on its screen", the 4-digit code input (numeric, one-time
 * code, Enter submits), Link and Refuse; a wrong code reads "That code does not match. Try again.";
 * while `moku-editor perf` owns the pairing, "Confirm in the terminal …" and no input.
 */
import type { JSX } from "preact";
import { confirmCode, refuseTicket, setCode } from "../../actions/connect";
import type { AskingRow as AskingRowView } from "../../derive/connect";
import type { RenderViewCtx } from "../../types";
import { MissionIcon } from "../icons";
import { Spinner } from "../parts";
import { start } from "../start";

/**
 * Props of `AskingRow`.
 */
export type AskingRowProps = { readonly ctx: RenderViewCtx; readonly row: AskingRowView };

/**
 * One phone asking to link.
 *
 * @param props - ctx and the row.
 * @returns The row.
 */
export function AskingRow(props: AskingRowProps): JSX.Element {
  const { ctx, row } = props;
  const { mission } = ctx.state;
  const { connect } = mission;
  const code = connect.codes.get(row.ticket) ?? "";
  const pending = connect.pending === row.ticket;
  const onSubmit = (event: Event): void => {
    event.preventDefault();
    if (code.length === 4) start(ctx, confirmCode(ctx, row.ticket, code));
  };
  return (
    <li data-asking-row data-ticket={row.ticket}>
      <span data-part="tile">
        <MissionIcon name="phone" />
      </span>
      <div data-part="text">
        <b>Asking to link: {row.title}</b>
        <span>{row.sub}</span>
      </div>
      {row.input ? (
        <form data-part="code-form" onSubmit={onSubmit}>
          <input
            type="text"
            inputMode="numeric"
            autocomplete="one-time-code"
            maxLength={4}
            pattern="[0-9]{4}"
            placeholder="0000"
            aria-label={`4-digit code shown on ${row.title}`}
            value={code}
            onInput={event =>
              setCode(mission, row.ticket, event.currentTarget.value.replaceAll(/\D/gu, ""))
            }
          />
          <button
            type="submit"
            data-variant="primary"
            data-size="sm"
            disabled={pending || code.length !== 4}
          >
            {pending ? <Spinner /> : undefined}
            Link
          </button>
          <button
            type="button"
            data-variant="ghost"
            data-size="sm"
            disabled={pending}
            onClick={() => start(ctx, refuseTicket(ctx, row.ticket))}
          >
            Refuse
          </button>
        </form>
      ) : undefined}
      {connect.error?.key === row.ticket ? (
        <p data-part="error" role="alert">
          {connect.error.message}
        </p>
      ) : undefined}
    </li>
  );
}
