/**
 * @file flowView render module — the history timeline (B4), far right: 40 px closed (clock button,
 * 20 dots newest first, trail dots accent, rejected red) or 288 px open (rows: frame label, path,
 * `outcome → next`, payload). The dot labels live in `HistoryLabels`, a layer inside the canvas
 * clip box, right-aligned to the canvas edge, 38 px apart: they can never cover the Inspector (M3).
 */
import type { VNode } from "preact";
import type { FlowActions, FlowCtx, Rect } from "../types";
import { useFlowStore } from "../useFlowStore";
import type { HistoryRow } from "./types";

/**
 * Dots shown while closed.
 */
const MAX_DOTS = 20;

/**
 * y of the first dot (under the clock button).
 */
const DOT_TOP = 48;

/**
 * Distance between dots.
 */
const DOT_PITCH = 22;

/**
 * Smallest distance between two labels.
 */
const LABEL_GAP = 38;

/**
 * Width of a label.
 */
const LABEL_W = 260;

/**
 * Height of a label.
 */
const LABEL_H = 24;

/**
 * Props of `HistoryStrip` and `HistoryLabels`.
 */
export type HistoryStripProps = {
  readonly ctx: FlowCtx;
  readonly actions: FlowActions;
  /** History rows, newest first. */
  readonly rows: readonly HistoryRow[];
};

/**
 * The label rects of some dots: right-aligned to the canvas edge, in dot order, at least 38 px apart.
 *
 * @param dots - Entry index and dot y.
 * @param canvasWidth - Width of the canvas (the Inspector starts there).
 * @param labelWidth - Width of a label.
 * @returns One rect per dot, inside [0, canvasWidth].
 * @example
 * ```ts
 * labelLayout([{ index: 3, y: 48 }], 900, 260); // [{ x: 640, y: 36, w: 260, h: 24 }]
 * ```
 */
export function labelLayout(
  dots: readonly { readonly index: number; readonly y: number }[],
  canvasWidth: number,
  labelWidth: number
): Rect[] {
  const w = Math.min(labelWidth, canvasWidth);
  const rects: Rect[] = [];
  let last = Number.NEGATIVE_INFINITY;
  for (const dot of dots.toSorted((a, b) => a.y - b.y)) {
    const y = Math.max(dot.y - LABEL_H / 2, last + LABEL_GAP);
    last = y;
    rects.push({ x: Math.max(0, canvasWidth - w), y, w, h: LABEL_H });
  }
  return rects;
}

/**
 * The history strip.
 *
 * @param props - Context, actions and the rows.
 * @returns The strip.
 */
export function HistoryStrip(props: HistoryStripProps): VNode {
  const { ctx, actions, rows } = props;
  const [open, selected] = useFlowStore(ctx, state => [
    state.focus.historyOpen,
    state.focus.historySelected
  ]);
  return (
    <aside
      data-flow="history-strip"
      data-chrome=""
      data-open={open ? "" : undefined}
      aria-label="History"
    >
      <button
        type="button"
        data-action="history"
        aria-pressed={open}
        title="History (H)"
        onClick={() => actions.focus.history()}
      >
        <span data-part="clock" aria-hidden="true" />
      </button>
      {open ? (
        <div data-part="list">
          <p data-part="title">{`History · ${rows.length} edges · newest first`}</p>
          <div role="listbox" aria-label="History edges">
            {rows.map(row => (
              <div
                key={row.index}
                data-flow="history-row"
                role="option"
                aria-selected={selected === row.index}
                data-trail={row.trail ? "" : undefined}
                data-rejected={row.rejected ? "" : undefined}
                tabIndex={0}
                onClick={() => actions.focus.selectHistory(row.index)}
                onKeyDown={event => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  actions.focus.selectHistory(row.index);
                }}
              >
                <code data-part="frame">{row.label}</code>
                <code data-part="path">{row.path}</code>
                <span data-part="outcome">
                  {row.rejected ? `✕ ${row.outcome} → ${row.next}` : `${row.outcome} → ${row.next}`}
                </span>
                <code data-part="payload" title={row.payload}>
                  {row.payload}
                </code>
              </div>
            ))}
          </div>
        </div>
      ) : (
        rows
          .slice(0, MAX_DOTS)
          .map(row => (
            <button
              key={row.index}
              type="button"
              data-flow="history-dot"
              data-index={row.index}
              data-trail={row.trail ? "" : undefined}
              data-rejected={row.rejected ? "" : undefined}
              data-selected={selected === row.index ? "" : undefined}
              aria-label={`${row.path} · ${row.outcome} · ${row.label}`}
              onClick={() => actions.focus.selectHistory(row.index)}
              onPointerEnter={() => actions.focus.hoverHistory(row.index)}
              onPointerLeave={() => actions.focus.hoverHistory()}
            />
          ))
      )}
    </aside>
  );
}

/**
 * The dot labels (node · outcome · frame) of the newest, the selected and the hovered dot, shown
 * on hover or selection, inside the canvas clip box (M3).
 *
 * @param props - Context, actions and the rows.
 * @returns The label layer.
 */
export function HistoryLabels(props: HistoryStripProps): VNode {
  const { ctx, rows } = props;
  const [open, hover, selected] = useFlowStore(ctx, state => [
    state.focus.historyOpen,
    state.focus.historyHover,
    state.focus.historySelected
  ]);
  const width = useFlowStore(ctx, state => state.camera.viewport.w, "camera");
  const shown = rows.slice(0, MAX_DOTS);
  const wanted = new Set([shown[0]?.index, hover, selected].filter(index => index !== undefined));
  const visible =
    open || (hover === undefined && selected === undefined)
      ? []
      : shown.filter(row => wanted.has(row.index));
  const dots = visible.map(row => ({
    index: row.index,
    y: DOT_TOP + shown.indexOf(row) * DOT_PITCH + DOT_PITCH / 2
  }));
  const rects = labelLayout(dots, width, LABEL_W);
  return (
    <div data-flow="history-labels" data-chrome="" aria-hidden="true">
      {visible.map((row, index) => (
        <span
          key={row.index}
          data-label=""
          style={{ top: `${rects[index]?.y ?? 0}px`, maxWidth: `${LABEL_W}px` }}
        >
          {`${row.path} · ${row.outcome} · ${row.label}`}
        </span>
      ))}
    </div>
  );
}
