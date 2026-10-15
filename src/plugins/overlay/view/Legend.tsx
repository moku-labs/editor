/**
 * @file overlay plugin — the annunciator legend: boxed text in its colour (`--c`), lit = filled,
 * hollow = dashed, with an optional spike glyph and small word.
 */
import type { VNode } from "preact";
import type { LegendView } from "../model/types";
import { SpikeGlyph } from "./icons";

/**
 * Props of `Legend`: the legend, the spike glyph, and the stable markers it carries.
 */
export type LegendProps = {
  readonly legend: LegendView;
  readonly glyph?: boolean;
  /** The `data-link` marker of a link legend. */
  readonly link?: string;
  /** The `data-rec` marker of the REC legend. */
  readonly rec?: boolean;
};

/**
 * A legend view.
 *
 * @param text - The text.
 * @param colour - The CSS colour for `--c`.
 * @param lit - Filled.
 * @param title - The tooltip.
 * @returns The legend view.
 * @example
 * ```ts
 * legendOf("STALE", "var(--caution)", true).lit; // true
 * ```
 */
export function legendOf(text: string, colour: string, lit = false, title?: string): LegendView {
  return { text, colour, lit, hollow: false, title, small: undefined };
}

/**
 * The legend.
 *
 * @param props - The legend and its markers.
 * @returns The legend element.
 */
export function Legend(props: LegendProps): VNode {
  const { legend } = props;
  return (
    <span
      data-legend=""
      data-lit={legend.lit ? "" : undefined}
      data-hollow={legend.hollow ? "" : undefined}
      data-link={props.link}
      data-rec={props.rec === true ? "" : undefined}
      style={`--c: ${legend.colour}`}
      title={legend.title}
    >
      {props.glyph === true ? <SpikeGlyph /> : undefined}
      {legend.text}
      {legend.small === undefined ? undefined : <small>{legend.small}</small>}
    </span>
  );
}
