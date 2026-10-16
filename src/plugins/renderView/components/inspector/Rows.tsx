/**
 * @file renderView components (inspector) — the rows the inspector lists (spec 09 § M10, M15
 * "inspector list row"): the systems grid (name, total, share, max, a 3 px bar), a row button that
 * selects its frames (a dot or diamond, a mono id, the words, the meta), a plain row, the off note
 * with "Turn on", and the short id of a spike group ("f4851–53").
 */
import type { ComponentChildren, JSX } from "preact";
import { oneDecimal } from "../../derive/words";
import type { PaletteKey } from "../../timeline/palette";
import type { MonitorSection, SystemRow } from "../../types";

/**
 * The id of a frame range as a row shows it: "f4851", or "f4851–53" for a group.
 *
 * @param from - The first frame.
 * @param to - The last frame.
 * @returns The id.
 * @example
 * ```ts
 * rowId(4851, 4853); // "f4851–53"
 * ```
 */
export function rowId(from: number, to: number): string {
  if (from === to) return `f${from}`;
  const last = String(to);
  return `f${from}–${last.slice(-Math.max(2, last.length - String(from).length + 2))}`;
}

/**
 * Props of `SystemsGrid`.
 */
export type SystemsGridProps = {
  readonly rows: readonly SystemRow[];
  /** "of view" or "of range". */
  readonly share: string;
  /** "max" or "max frame". */
  readonly max: string;
};

/**
 * The systems grid: name, total, share, max, and a bar of the total against the largest.
 *
 * @param props - The rows and the column words.
 * @returns The grid.
 */
export function SystemsGrid(props: SystemsGridProps): JSX.Element {
  const { rows } = props;
  const largest = Math.max(0.001, ...rows.map(row => row.totalMs));
  return (
    <div data-systems>
      <span data-part="column">name</span>
      <span data-part="column" data-num>
        total
      </span>
      <span data-part="column" data-num>
        {props.share}
      </span>
      <span data-part="column" data-num>
        {props.max}
      </span>
      {rows.map(row => (
        <div key={row.name} data-part="row">
          <span data-part="name" title={row.name}>
            {row.name}
          </span>
          <span data-num>{oneDecimal(row.totalMs)} ms</span>
          <span data-num>{Math.round(row.share * 100)} %</span>
          <span data-num>{oneDecimal(row.maxMs)}</span>
          <span data-part="bar" aria-hidden="true">
            <span style={{ inlineSize: `${Math.round((row.totalMs / largest) * 100)}%` }} />
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Props of `RowButton`.
 */
export type RowButtonProps = {
  /** The mark's shape and colour. */
  readonly mark: { readonly shape: "dot" | "diamond"; readonly colour: PaletteKey } | undefined;
  readonly id: string;
  readonly text: string;
  readonly meta: string | undefined;
  readonly onSelect: (() => void) | undefined;
  readonly children?: ComponentChildren;
};

/**
 * A row: its mark, its mono id, its words and its meta; a button when it selects frames.
 *
 * @param props - The row.
 * @returns The row.
 */
export function RowButton(props: RowButtonProps): JSX.Element {
  const { mark, onSelect } = props;
  const content = (
    <>
      {mark === undefined ? undefined : (
        <i
          data-mark={mark.shape === "dot" ? "dot" : "diamond"}
          data-colour={mark.colour}
          aria-hidden="true"
        />
      )}
      <span data-mono>{props.id}</span>
      <span data-part="grow">{props.text}</span>
      {props.meta === undefined ? undefined : (
        <span data-part="meta" data-mono>
          {props.meta}
        </span>
      )}
      {props.children}
    </>
  );
  return (
    <li>
      {onSelect === undefined ? (
        <span data-row>{content}</span>
      ) : (
        <button type="button" data-row onClick={onSelect}>
          {content}
        </button>
      )}
    </li>
  );
}

/**
 * Props of `OffNote`.
 */
export type OffNoteProps = {
  readonly text: string;
  readonly turnOn: MonitorSection | undefined;
  readonly onTurnOn: (section: MonitorSection) => void;
};

/**
 * The dashed note of a section that is off (with "Turn on") or not measured.
 *
 * @param props - The words and the section to turn on.
 * @returns The note.
 */
export function OffNote(props: OffNoteProps): JSX.Element {
  const { turnOn } = props;
  return (
    <p data-off-message>
      {props.text}
      {turnOn === undefined ? undefined : (
        <button
          type="button"
          data-variant="primary"
          data-size="sm"
          data-action="turn-on"
          onClick={() => props.onTurnOn(turnOn)}
        >
          Turn on
        </button>
      )}
    </p>
  );
}
