/**
 * @file filesView plugin — the card of a series `index.json`: "Series · <label> · N shots · D s
 * at I ms · from frame F", a tag for shots marked as bug, and "Open contact sheet", which emits
 * the global `workspace:open-sheet` (R4; gameView shows Game and opens the sheet).
 */
import type { VNode } from "preact";
import { useMemo } from "preact/hooks";
import { parseSeriesIndex, seriesSummary } from "../preview/series";
import type { FilesViewCtx, OpenTab } from "../types";

/**
 * Props of `SeriesCard`.
 */
export type SeriesCardProps = { readonly ctx: FilesViewCtx; readonly tab: OpenTab };

/**
 * The series card.
 *
 * @param props - Context and the tab of the index.json.
 * @returns The card.
 */
export function SeriesCard(props: SeriesCardProps): VNode {
  const { ctx, tab } = props;
  const text = tab.buffer ?? tab.saved ?? "";
  const index = useMemo(() => parseSeriesIndex(text), [text]);

  if (index === undefined) {
    return (
      <div data-part="preview" data-preview="series" data-card>
        <p>Not a series index · showing the source</p>
      </div>
    );
  }

  const bugs = index.shots.filter(shot => shot.bug === true).length;
  return (
    <div data-part="preview" data-preview="series" data-card>
      <p>{seriesSummary(index, tab.path)}</p>
      {bugs > 0 && <span data-tag="warn">{bugs} marked as bug</span>}
      <button
        type="button"
        data-variant="primary"
        onClick={() => ctx.emit("workspace:open-sheet", { index: tab.path })}
      >
        Open contact sheet
      </button>
    </div>
  );
}
