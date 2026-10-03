/**
 * @file consoleView plugin — the windowed log table: sticky header, frame links, level tags,
 * search hits as `<mark>` elements, meta rows, the fresh-error highlight, keyboard selection and
 * the "N new lines" pill. Log text is rendered as text nodes only.
 */
import type { JSX, VNode } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { splitHits } from "../filter";
import { frameText, frameTitle, tagOf } from "../lines";
import type { ConsoleApi, ConsoleCtx, FrameMark, LogLine } from "../types";

/**
 * Props of `LogTable`.
 */
export type LogTableProps = {
  readonly ctx: ConsoleCtx;
  readonly api: ConsoleApi;
  readonly lines: readonly LogLine[];
  readonly query: string;
  readonly selected: number | undefined;
};

/**
 * Fixed row height in px; windowing is exact with it.
 */
const ROW = 27;

/**
 * Rows rendered above and below the viewport.
 */
const OVERSCAN = 20;

/**
 * Distance from the bottom, in px, that still counts as "at the bottom".
 */
const BOTTOM_SLACK = 4;

/**
 * Rows the sticky header covers at the top of the scroller.
 */
const HEADER_ROWS = 1;

/**
 * The selection step of each arrow key.
 */
const STEP_BY_KEY: ReadonlyMap<string, 1 | -1> = new Map([
  ["ArrowDown", 1],
  ["ArrowUp", -1]
]);

/**
 * Viewport height used before layout gives one.
 */
const FALLBACK_HEIGHT = 600;

/**
 * The column headers.
 */
const COLUMNS = ["Frame", "Level", "Source", "Message"] as const;

/**
 * A frame link: click or Enter emits `workspace:focus-frame` through the api; the row is not
 * selected by it.
 *
 * @param props - The api, the frame mark and whether Tab reaches it.
 * @param props.api - The console api.
 * @param props.frame - The frame mark.
 * @param props.tabbable - True on the selected row and in the drawer.
 * @returns The button.
 */
export function FrameLink(props: {
  readonly api: ConsoleApi;
  readonly frame: FrameMark;
  readonly tabbable: boolean;
}): VNode {
  const { api, frame, tabbable } = props;
  return (
    <button
      type="button"
      data-frame-link
      title={frameTitle(frame)}
      tabIndex={tabbable ? 0 : -1}
      onClick={event => {
        event.stopPropagation();
        api.focusFrame(frame.value);
      }}
    >
      {frameText(frame)}
    </button>
  );
}

/**
 * A cell text with the search hits wrapped in `<mark data-hit>`.
 *
 * @param props - The text and the query.
 * @param props.text - The cell text.
 * @param props.query - The search text.
 * @returns The parts.
 * @example
 * ```tsx
 * <Hits text="missing texture" query="tex" /> // missing <mark data-hit>tex</mark>ture
 * ```
 */
function Hits(props: { readonly text: string; readonly query: string }): VNode {
  const parts = splitHits(props.text, props.query);
  return (
    <>
      {parts.map((part, index) =>
        part.hit ? (
          <mark key={index} data-hit>
            {part.text}
          </mark>
        ) : (
          part.text
        )
      )}
    </>
  );
}

/**
 * One log row: an entry (frame, level, source, message) or a meta row spanning the columns.
 *
 * @param props - The row data.
 * @param props.line - The line.
 * @param props.index - Its index among the visible lines.
 * @param props.api - The console api (for the frame link).
 * @param props.query - The search text.
 * @param props.selected - Whether the drawer shows it.
 * @param props.freshMs - How long a fresh error is highlighted.
 * @returns The row.
 */
function Row(props: {
  readonly line: LogLine;
  readonly index: number;
  readonly api: ConsoleApi;
  readonly query: string;
  readonly selected: boolean;
  readonly freshMs: number;
}): VNode {
  const { line, index, api, query, selected, freshMs } = props;

  if (line.kind === "meta") {
    return (
      <tr data-key={line.key} aria-rowindex={index + 2} aria-selected={selected} data-meta="">
        <td colSpan={4}>{line.text}</td>
      </tr>
    );
  }

  const fresh = line.level === "error" && line.addedAt > Date.now() - freshMs;
  return (
    <tr
      data-key={line.key}
      aria-rowindex={index + 2}
      aria-selected={selected}
      data-level={line.level}
      data-fresh={fresh ? "" : undefined}
    >
      <td data-col="frame">
        {line.frame === undefined ? (
          "—"
        ) : (
          <FrameLink api={api} frame={line.frame} tabbable={selected} />
        )}
      </td>
      <td data-col="level">
        <span data-tag={tagOf(line.level)} data-level={line.level}>
          {line.level}
        </span>
      </td>
      <td data-col="source">
        <Hits text={line.source} query={query} />
      </td>
      <td data-col="message">
        <Hits text={line.message} query={query} />
      </td>
    </tr>
  );
}

/**
 * The key of the row an event happened in.
 *
 * @param target - The event target.
 * @returns The line key, or undefined outside a line row.
 */
function rowKeyOf(target: EventTarget | null): number | undefined {
  if (!(target instanceof Element)) return undefined;
  const key = target.closest<HTMLElement>("tr[data-key]")?.dataset.key;
  return key === undefined ? undefined : Number(key);
}

/**
 * The index the arrow keys move the selection to.
 *
 * @param current - The selected index, or -1.
 * @param step - +1 for ↓, -1 for ↑.
 * @param count - Visible lines.
 * @returns The next index, clamped.
 * @example
 * ```ts
 * nextIndex(-1, 1, 8); // 0
 * ```
 */
function nextIndex(current: number, step: 1 | -1, count: number): number {
  if (current === -1) return step === 1 ? 0 : count - 1;
  return Math.min(count - 1, Math.max(0, current + step));
}

/**
 * Scrolls the list so the row at an index is in view below the sticky header.
 *
 * @param element - The scroller element.
 * @param index - The row index.
 */
function revealRow(element: HTMLElement, index: number): void {
  const top = index * ROW;
  const bottom = top + (1 + HEADER_ROWS) * ROW;
  const height = element.clientHeight;
  if (top < element.scrollTop) element.scrollTop = top;
  else if (height > 0 && bottom > element.scrollTop + height) {
    element.scrollTop = bottom - height;
  }
}

/**
 * Whether a scroller is at its bottom (within 4 px).
 *
 * @param element - The scroller.
 * @returns True when new lines should keep it at the bottom.
 */
function isAtBottom(element: HTMLElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= BOTTOM_SLACK;
}

/**
 * A click anywhere in a line row selects it (one delegated handler; the drawer opens).
 *
 * @param api - The console api.
 * @param target - The click target.
 */
function selectRow(api: ConsoleApi, target: EventTarget | null): void {
  const key = rowKeyOf(target);
  if (key !== undefined) api.select(key);
}

/**
 * The grid keys: ↑/↓ move the selection (and keep it in view), Enter on the grid selects the
 * first line when none is selected, Esc closes the drawer.
 *
 * @param event - The keydown event.
 * @param grid - What the keys act on.
 * @param grid.api - The console api.
 * @param grid.lines - The visible lines.
 * @param grid.selected - The selected key.
 * @param grid.scroller - The scroller, once mounted.
 */
function onGridKey(
  event: JSX.TargetedKeyboardEvent<HTMLTableElement>,
  grid: {
    readonly api: ConsoleApi;
    readonly lines: readonly LogLine[];
    readonly selected: number | undefined;
    readonly scroller: HTMLElement | null;
  }
): void {
  const { api, lines, selected, scroller } = grid;
  const selectedIndex = lines.findIndex(line => line.key === selected);
  const step = STEP_BY_KEY.get(event.key);
  const isEnterOnGrid = event.key === "Enter" && event.target === event.currentTarget;
  const closesDrawer = event.key === "Escape" && selected !== undefined;
  if (step !== undefined) {
    event.preventDefault();
    const index = nextIndex(selectedIndex, step, lines.length);
    api.select(lines[index]?.key);
    if (scroller !== null) revealRow(scroller, index);
  } else if (isEnterOnGrid) {
    event.preventDefault();
    if (selectedIndex === -1) api.select(lines[0]?.key);
  } else if (closesDrawer) {
    event.preventDefault();
    event.stopPropagation();
    api.select();
  }
}

/**
 * The windowed log table: only the rows in view ± 20 render, with spacers above and below.
 *
 * @param props - The ctx, the api, the visible lines, the query and the selected key.
 * @returns The table element.
 */
export function LogTable(props: LogTableProps): VNode {
  const { ctx, api, lines, query, selected } = props;
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const seenKey = useRef(ctx.state.nextKey);
  const [scrollTop, setScrollTop] = useState(0);
  const [unseen, setUnseen] = useState(0);
  const { nextKey } = ctx.state;

  // New lines keep a list scrolled to the bottom there; otherwise they are counted for the pill.
  useLayoutEffect(() => {
    const element = scroller.current;
    const added = lines.filter(line => line.key >= seenKey.current).length;
    seenKey.current = nextKey;
    if (element === null) return;
    if (atBottom.current) element.scrollTop = element.scrollHeight;
    else if (added > 0) setUnseen(count => count + added);
  }, [nextKey]);

  const measured = scroller.current?.clientHeight ?? 0;
  const height = measured > 0 ? measured : FALLBACK_HEIGHT;
  const first = Math.max(0, Math.floor(scrollTop / ROW) - OVERSCAN);
  const end = Math.min(lines.length, Math.ceil((scrollTop + height) / ROW) + OVERSCAN);

  return (
    <div data-part="logtable">
      <div
        ref={scroller}
        data-scroller
        onScroll={event => {
          const element = event.currentTarget;
          atBottom.current = isAtBottom(element);
          if (atBottom.current) setUnseen(0);
          setScrollTop(element.scrollTop);
        }}
      >
        <table
          // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: the log table is one focus stop with arrow-key row selection (spec A6, role grid)
          role="grid"
          aria-label="Console log"
          aria-rowcount={lines.length + 1}
          tabIndex={0}
          onClick={event => selectRow(api, event.target)}
          onKeyDown={event =>
            onGridKey(event, { api, lines, selected, scroller: scroller.current })
          }
        >
          <thead>
            <tr aria-rowindex={1}>
              {COLUMNS.map(column => (
                <th key={column} scope="col">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr data-spacer>
              <td colSpan={4} style={{ height: `${first * ROW}px` }} />
            </tr>
            {lines.slice(first, end).map((line, offset) => (
              <Row
                key={line.key}
                line={line}
                index={first + offset}
                api={api}
                query={query}
                selected={line.key === selected}
                freshMs={ctx.config.freshMs}
              />
            ))}
            <tr data-spacer>
              <td colSpan={4} style={{ height: `${(lines.length - end) * ROW}px` }} />
            </tr>
          </tbody>
        </table>
      </div>
      {unseen > 0 && (
        <button
          type="button"
          data-pill
          onClick={() => {
            if (scroller.current !== null)
              scroller.current.scrollTop = scroller.current.scrollHeight;
            atBottom.current = true;
            setUnseen(0);
          }}
        >
          {unseen === 1 ? "1 new line ↓" : `${unseen} new lines ↓`}
        </button>
      )}
    </div>
  );
}
