/**
 * @file renderView components (inspector) — the inspector column (spec 09 § M10): the range view of
 * the selection, or the summary of the view. The summary is re-derived at most once a second while
 * live, and never while the pointer is over it or the focus is inside it, so it does not jump under
 * the hand. Without frames it says what the source is doing.
 */
import type { JSX } from "preact";
import { useRef, useState } from "preact/hooks";
import { activeSourcePlugin } from "../../../activeSource";
import { spanWords } from "../../derive/inspector";
import type { InspectorView, MissionState, RenderViewApi, RenderViewCtx } from "../../types";
import { timelineOverlay } from "../instrument/EmptyOverlay";
import { useTicker } from "../useMission";
import { RangeView } from "./RangeView";
import { DragHint, Summary } from "./Summary";

/**
 * Props of `Inspector`.
 */
export type InspectorProps = { readonly ctx: RenderViewCtx; readonly api: RenderViewApi };

/** The summary is re-derived at most this often while live, ms (spec 09 § M12 SUMMARY_EVERY_MS). */
const SUMMARY_EVERY_MS = 1000;

/** The summary kept between re-derivations, and what it was derived for. */
type Kept = {
  view: InspectorView | undefined;
  source: MissionState["source"];
  at: number;
  span: number;
  live: boolean;
  version: number;
};

/**
 * The line the inspector shows without frames.
 *
 * @param ctx - Domain context of renderView.
 * @param name - The source's name.
 * @returns The line.
 */
function emptyLine(ctx: RenderViewCtx, name: string): string {
  const overlay = timelineOverlay(ctx);
  if (overlay === "not-started")
    return "Nothing is running. Start the local preview or connect a device.";
  if (overlay === "no-monitor") return "This game has no frame monitor.";
  if (overlay === "older-agent") return "This game's editor agent is older.";
  return `Waiting for the first frames from ${name}.`;
}

/**
 * The inspector.
 *
 * @param props - ctx and the api.
 * @returns The column.
 */
export function Inspector(props: InspectorProps): JSX.Element {
  const { ctx, api } = props;
  const { mission } = ctx.state;
  const name = ctx.require(activeSourcePlugin).label().name;
  const [holding, setHolding] = useState({ pointer: false, focus: false });
  const kept = useRef<Kept>({
    view: undefined,
    source: undefined,
    at: 0,
    span: 0,
    live: true,
    version: -1
  });
  const frames = mission.history.count > 0;
  useTicker(SUMMARY_EVERY_MS, frames && mission.view.live && mission.selection === undefined);

  let view: InspectorView | undefined;
  if (mission.selection === undefined) {
    const now = performance.now();
    const last = kept.current;
    const same =
      last.view?.kind === "summary" &&
      last.source === mission.source &&
      last.span === mission.view.span &&
      last.live === mission.view.live &&
      last.version === mission.selectionVersion;
    const fresh = mission.view.live && now - last.at < SUMMARY_EVERY_MS;
    if (same && (holding.pointer || holding.focus || fresh)) view = last.view;
    else {
      view = api.inspect();
      kept.current = {
        view,
        source: mission.source,
        at: now,
        span: mission.view.span,
        live: mission.view.live,
        version: mission.selectionVersion
      };
    }
  } else view = api.inspect();

  return (
    <aside
      data-render="inspector"
      data-card
      aria-label="Inspector"
      onPointerEnter={() => setHolding(hold => ({ ...hold, pointer: true }))}
      onPointerLeave={() => setHolding(hold => ({ ...hold, pointer: false }))}
      onFocusIn={() => setHolding(hold => ({ ...hold, focus: true }))}
      onFocusOut={() => setHolding(hold => ({ ...hold, focus: false }))}
    >
      {view?.kind === "range" ? (
        <RangeView ctx={ctx} api={api} view={view} name={name} />
      ) : undefined}
      {view?.kind === "summary" ? (
        <Summary ctx={ctx} api={api} view={view} name={name} />
      ) : undefined}
      {view === undefined ? (
        <section data-part="section">
          <header>
            <div data-part="head">
              <span data-part="title">Last {spanWords(mission.view.span)}</span>
              <span data-part="sub">No frames yet</span>
            </div>
          </header>
          <DragHint />
          <p data-part="empty">{emptyLine(ctx, name)}</p>
        </section>
      ) : undefined}
    </aside>
  );
}
