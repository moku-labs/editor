/**
 * @file gameView plugin — the series popover (D3) in the browser top layer (R4): duration and
 * interval chips, the planned shots, a warning above `seriesWarnShots`, the folder, Cancel and
 * ● Start; the recording view (F10) replaces the body while a series runs.
 */
import type { VNode } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import { plannedShots, stamp } from "../capture/naming";
import { recordSeries, setPopover } from "../capture/series";
import type { GameViewCtx } from "../types";
import { setSeriesDuration, setSeriesInterval } from "../view-state";
import { RecordingView } from "./RecordingView";
import { resultText, secondsText } from "./text";
import { useGameView } from "./useGameView";

/**
 * Props of `SeriesPopover`.
 */
export type SeriesPopoverProps = { readonly ctx: GameViewCtx };

/**
 * Props of a chip radio group.
 */
type ChipsProps = {
  readonly label: string;
  readonly values: readonly number[];
  readonly value: number;
  readonly text: (value: number) => string;
  readonly onChoose: (value: number) => void;
};

/**
 * A row of chips as a radio group.
 *
 * @param props - Label, values, the current value, the chip text and the choose callback.
 * @returns The group.
 * @example
 * ```tsx
 * <Chips label="Duration" values={[1000, 2000]} value={2000} text={ms => `${ms / 1000} s`} onChoose={choose} />
 * ```
 */
function Chips(props: ChipsProps): VNode {
  const { label, values, value, text, onChoose } = props;
  return (
    <div role="radiogroup" aria-label={label} data-part="chips">
      {values.map(option => (
        // biome-ignore lint/a11y/useSemanticElements: chips of a radio group, styled as one row
        <button
          key={option}
          type="button"
          role="radio"
          data-chip=""
          aria-checked={option === value}
          onClick={() => onChoose(option)}
        >
          {text(option)}
        </button>
      ))}
    </div>
  );
}

/**
 * Shows a popover element in the top layer where the Popover API exists.
 *
 * @param element - The popover element.
 * @example
 * ```ts
 * showInTopLayer(popoverRef.current);
 * ```
 */
export function showInTopLayer(element: HTMLElement | null): void {
  if (element === null || typeof element.showPopover !== "function") return;
  try {
    element.showPopover();
  } catch {
    // Already open, or the element left the document: nothing to show.
  }
}

/**
 * The series popover.
 *
 * @param props - The gameView domain context.
 * @returns The popover, undefined while closed.
 * @example
 * ```tsx
 * <SeriesPopover ctx={ctx} />
 * ```
 */
export function SeriesPopover(props: SeriesPopoverProps): VNode | undefined {
  const { ctx } = props;
  const { state, config } = ctx;
  const open = useGameView(state, () => state.series.popover);
  const element = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (open) showInTopLayer(element.current);
  }, [open]);
  if (!open) return;

  const { durationMs, intervalMs, recording } = state.series;
  const shots = plannedShots(durationMs, intervalMs);
  const folder = `${config.capturesDir}/series-${stamp(new Date())}/`;

  return (
    <div
      data-game="series"
      popover="manual"
      role="dialog"
      aria-label="Record a series"
      ref={element}
    >
      {recording === undefined ? (
        <>
          <h2>Record a series</h2>
          <Chips
            label="Duration"
            values={config.seriesDurationsMs}
            value={durationMs}
            text={ms => `${secondsText(ms)} s`}
            onChoose={ms => setSeriesDuration(state, ms)}
          />
          <Chips
            label="Interval"
            values={config.seriesIntervalsMs}
            value={intervalMs}
            text={ms => `${ms} ms`}
            onChoose={ms => setSeriesInterval(state, ms)}
          />
          <p data-part="result">{resultText(shots, durationMs, intervalMs)}</p>
          {shots > config.seriesWarnShots && (
            <p data-part="warning" role="alert">
              {`! ${shots} shots is a large series.`}
            </p>
          )}
          <p data-part="folder">{`Saves to ${folder} with index.json`}</p>
          <footer>
            <button type="button" data-variant="ghost" onClick={() => setPopover(ctx, false)}>
              Cancel
            </button>
            <button
              type="button"
              data-variant="primary"
              onClick={() => recordSeries(ctx, { durationMs, intervalMs })}
            >
              ● Start
            </button>
          </footer>
        </>
      ) : (
        <RecordingView ctx={ctx} recording={recording} />
      )}
    </div>
  );
}
