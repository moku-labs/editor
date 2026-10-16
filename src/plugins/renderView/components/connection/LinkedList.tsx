/**
 * @file renderView components (connection) — "Linked devices" under both tabs of the Connect panel
 * (spec 09 § M7): each phone linked in this run, how it is linked, its online dot or "away", its
 * latency, and "Use" (activeSource.useDevice) or "In use" for the current source. Nothing while no
 * phone is linked.
 */
import type { JSX } from "preact";
import { activeSourcePlugin } from "../../../activeSource";
import { useSession } from "../../actions/connect";
import { linkedRow } from "../../derive/connect";
import type { RenderViewCtx } from "../../types";
import { MissionIcon } from "../icons";
import { Spinner } from "../parts";
import { start } from "../start";

/**
 * Props of `LinkedList`.
 */
export type LinkedListProps = { readonly ctx: RenderViewCtx };

/**
 * The linked devices; nothing while none is linked.
 *
 * @param props - ctx.
 * @returns The list, or nothing.
 */
export function LinkedList(props: LinkedListProps): JSX.Element | null {
  const { ctx } = props;
  const activeSource = ctx.require(activeSourcePlugin);
  const linked = activeSource.directory()?.linked ?? [];
  // eslint-disable-next-line unicorn/no-null -- Preact renders null for "nothing"
  if (linked.length === 0) return null;
  const current = ctx.state.mission.source ?? activeSource.current();
  const { connect } = ctx.state.mission;
  return (
    <section data-part="linked">
      <h4>Linked devices</h4>
      <ul data-part="devices">
        {linked.map(entry => {
          const row = linkedRow(entry, current);
          const { action } = row;
          return (
            <li key={row.id} data-linked-row data-device-id={row.id}>
              <span data-part="tile">
                <MissionIcon name={row.how === "by wire" ? "wire" : "wifi"} />
              </span>
              <div data-part="text">
                <b>{row.title}</b>
                <span>
                  {row.how} · <span data-dot={row.online ? "live" : "calm"} aria-hidden="true" />{" "}
                  {row.latency}
                </span>
              </div>
              <div data-part="right">
                {action?.kind === "in-use" ? <span data-tag="ok">In use</span> : undefined}
                {action?.kind === "use" && connect.pending === action.session ? (
                  <Spinner />
                ) : undefined}
                {action?.kind === "use" && connect.pending !== action.session ? (
                  <button
                    type="button"
                    data-variant="outline"
                    data-size="sm"
                    data-action="use"
                    onClick={() => start(ctx, useSession(ctx, action.session))}
                  >
                    Use
                  </button>
                ) : undefined}
              </div>
              {action?.kind === "use" && connect.error?.key === action.session ? (
                <p data-part="error" role="alert">
                  {connect.error.message}
                </p>
              ) : undefined}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
