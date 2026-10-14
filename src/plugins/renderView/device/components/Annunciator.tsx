/**
 * @file renderView device strip — the annunciator legend (design §4): a small boxed uppercase
 * legend in a state colour. Lit: filled; outlined: secondary; hollow (GC?): dashed with "likely".
 * The colour goes out as the inline custom property `--c`, the strip's only inline style.
 */
import type { VNode } from "preact";

/**
 * The state colours of the strip's legends (tokens on the strip's scope root).
 */
export const TONE_COLOUR = {
  green: "var(--strip-green)",
  amber: "var(--strip-amber)",
  red: "var(--strip-red)",
  ink2: "var(--strip-ink-2)",
  cyan: "var(--strip-cyan)"
} as const;

/**
 * Props of `Annunciator`.
 */
export type AnnunciatorProps = {
  readonly text: string;
  /** A state colour: a token of TONE_COLOUR or a cause hue. */
  readonly colour: string;
  readonly lit?: boolean;
  /** GC?: dashed border and "likely". */
  readonly hollow?: boolean;
  /** "cell" (device row, 20 high), "legend" (legend row, 18 high) or "lead" (record lead, 26 high). */
  readonly size?: "cell" | "legend" | "lead";
  readonly title?: string;
};

/**
 * An annunciator legend.
 *
 * @param props - The text, its colour and how it is drawn.
 * @returns The legend.
 */
export function Annunciator(props: AnnunciatorProps): VNode {
  const { text, colour, lit = false, hollow = false, size = "cell", title } = props;
  return (
    <span
      data-an={size}
      data-lit={lit ? "" : undefined}
      data-hollow={hollow ? "" : undefined}
      title={title}
      style={{ "--c": colour }}
    >
      {text}
      {hollow ? <small>likely</small> : undefined}
    </span>
  );
}
