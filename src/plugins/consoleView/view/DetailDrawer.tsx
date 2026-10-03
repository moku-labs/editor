/**
 * @file consoleView plugin — the detail drawer of the selected line: time, level, source, frame
 * link, raw event and data as pretty JSON. Its close button and Esc close it.
 */
import type { JSX, VNode } from "preact";
import { formatTime, tagOf } from "../lines";
import type { ConsoleApi, LogLine } from "../types";
import { FrameLink } from "./LogTable";

/**
 * Props of `DetailDrawer`.
 */
export type DetailDrawerProps = { readonly api: ConsoleApi; readonly line: LogLine };

/**
 * The fields of an entry or meta line.
 *
 * @param props - The api and the line.
 * @param props.api - The console api.
 * @param props.line - The line.
 * @returns The property list and the data block.
 */
function Fields(props: { readonly api: ConsoleApi; readonly line: LogLine }): VNode {
  const { api, line } = props;
  if (line.kind === "meta") {
    return (
      <dl data-props>
        <dt>Time</dt>
        <dd data-field="time">{formatTime(line.addedAt)}</dd>
        <dt>Note</dt>
        <dd data-field="text">{line.text}</dd>
      </dl>
    );
  }

  return (
    <>
      <dl data-props>
        <dt>Time</dt>
        <dd data-field="time">{formatTime(line.ts)}</dd>
        <dt>Level</dt>
        <dd data-field="level">
          <span data-tag={tagOf(line.level)} data-level={line.level}>
            {line.level}
          </span>
        </dd>
        <dt>Source</dt>
        <dd data-field="source">{line.source}</dd>
        <dt>Frame</dt>
        <dd data-field="frame">
          {line.frame === undefined ? "—" : <FrameLink api={api} frame={line.frame} tabbable />}
        </dd>
        <dt>Event</dt>
        <dd data-field="event">{line.event}</dd>
      </dl>
      {line.data !== undefined && <pre data-json>{JSON.stringify(line.data, undefined, 2)}</pre>}
    </>
  );
}

/**
 * Esc inside the drawer closes it (before the search, design §4 order).
 *
 * @param api - The console api.
 * @param event - The keydown event.
 */
function onDrawerKey(api: ConsoleApi, event: JSX.TargetedKeyboardEvent<HTMLElement>): void {
  if (event.key !== "Escape") return;
  event.preventDefault();
  event.stopPropagation();
  api.select();
}

/**
 * The bottom drawer of the selected line (max 40 % height). Esc closes it before the search.
 *
 * @param props - The api and the selected line.
 * @returns The drawer element.
 */
export function DetailDrawer(props: DetailDrawerProps): VNode {
  const { api, line } = props;
  return (
    <aside
      data-part="drawer"
      aria-label="Line details"
      tabIndex={-1}
      onKeyDown={event => onDrawerKey(api, event)}
    >
      <header>
        <h2>Line details</h2>
        <button
          type="button"
          data-variant="ghost"
          aria-label="Close details"
          onClick={() => api.select()}
        >
          ×
        </button>
      </header>
      <Fields api={api} line={line} />
    </aside>
  );
}
