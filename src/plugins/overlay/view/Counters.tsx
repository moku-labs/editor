/**
 * @file overlay plugin — the counters (C2, C7, C8): the cells with the drawn / loop rate suffix,
 * the More row (or the compact card's More / Less key) and the More text (D1). No switch of any
 * kind: the kept-pictures A/B is the engine's door command.
 */
import type { VNode } from "preact";
import type { OverlayActions } from "../actions";
import type { CounterCell, FramesView, RateSuffix } from "../model/types";
import { ChevronIcon } from "./icons";

/** The More row's one-line summary. */
const SUMMARY = "systems, filters, kept, redraws, views, heap, insets, backend, canvas, device";

/**
 * The rate suffix of the drawn / loop cell (amber after an automatic fall back).
 *
 * @param props - The suffix.
 * @param props.rate - The rate suffix.
 * @returns The suffix.
 */
function Rate(props: { readonly rate: RateSuffix }): VNode {
  return (
    <small data-part="rate" data-caution={props.rate.caution ? "" : undefined}>
      {` ${props.rate.text}`}
    </small>
  );
}

/**
 * One counter cell: label over value, the rate suffix (after the value, or on the label line of
 * the compact card) and the unit.
 *
 * @param props - The cell.
 * @param props.cell - The counter cell.
 * @returns The cell.
 */
function Cell(props: { readonly cell: CounterCell }): VNode {
  const { cell } = props;
  const rate = cell.rate === undefined ? undefined : <Rate rate={cell.rate} />;
  return (
    <div
      data-counter={cell.key}
      data-span={String(cell.span)}
      data-caution={cell.caution ? "" : undefined}
      title={cell.title}
    >
      <i>
        {cell.label}
        {cell.ratePlace === "label" ? rate : undefined}
      </i>
      <b>
        {cell.value}
        {cell.ratePlace === "value" ? rate : undefined}
        {cell.unit === "" ? undefined : <small>{cell.unit}</small>}
      </b>
    </div>
  );
}

/**
 * The counters, the More key and the More text.
 *
 * @param props - The Frames view and the actions.
 * @param props.frames - The Frames view.
 * @param props.actions - The actions.
 * @returns The counters.
 */
export function Counters(props: {
  readonly frames: FramesView;
  readonly actions: OverlayActions;
}): VNode {
  const { frames, actions } = props;
  const label = frames.more ? "Less" : "More";
  const state = frames.more ? "open" : "closed";
  return (
    <>
      <div data-part="counters" data-compact={frames.compact ? "" : undefined}>
        {frames.counters.map(cell => (
          <Cell key={cell.key} cell={cell} />
        ))}
        {frames.compact ? (
          <button
            type="button"
            data-more={state}
            aria-expanded={frames.more}
            aria-label={frames.more ? "Fewer counters" : "More counters"}
            onClick={actions.more}
          >
            <ChevronIcon />
            <span>{label}</span>
          </button>
        ) : undefined}
      </div>
      {frames.compact ? undefined : (
        <button
          type="button"
          data-part="more"
          data-more={state}
          aria-expanded={frames.more}
          onClick={actions.more}
        >
          <b>{label}</b>
          <span>{SUMMARY}</span>
          <ChevronIcon />
        </button>
      )}
      {frames.more ? (
        <p data-part="xtra">
          <span data-part="systems" title="Slowest systems this second">
            systems: <b>{frames.systems}</b>
          </span>
          {frames.parts.map((part, index) => (
            <span key={part.label}>
              {index === 0 ? "" : " · "}
              {part.label} <b>{part.value}</b>
              {part.rest}
            </span>
          ))}
        </p>
      ) : undefined}
    </>
  );
}
