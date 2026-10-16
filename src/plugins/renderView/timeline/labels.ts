/**
 * @file renderView timeline — the painters' cached strings and text widths (spec 09 § M11
 * "allocation-free per frame"): a label is built once per key (axis labels by second, flag text by
 * group, GC and rate chips by event) and its width measured once per font, never per paint. Every
 * cache is bounded: past LABELS_MAX entries it starts over (a long session with changing values).
 */
import type { PaintContext } from "./layout";

/** Entries a label or width cache keeps before it starts over. */
export const LABELS_MAX = 1024;

/** The fonts of the canvases (spec 09 § M15 Typography: canvas text 500 / 600 12 px). */
export const FONTS = {
  mono500: '500 12px "Geist Mono", ui-monospace, monospace',
  mono600: '600 12px "Geist Mono", ui-monospace, monospace',
  sans500: '500 12px "Geist", system-ui, sans-serif',
  sans600: '600 12px "Geist", system-ui, sans-serif'
} as const;

/** One of the canvas fonts. */
export type FontId = keyof typeof FONTS;

/**
 * The painters' caches: label strings by numeric key, one map per kind, and text widths per font.
 *
 * @example
 * ```ts
 * const labels: LabelCache = createLabelCache();
 * labelOf(labels.axis, 5, 5, axisText); // "−5 s"
 * ```
 */
export type LabelCache = {
  /** Axis labels by whole seconds before the right edge. */
  readonly axis: Map<number, string>;
  /** Spike flag text by cause code and value. */
  readonly flag: Map<number, string>;
  /** Chips of events (GC, rate change, compile) by event seq. */
  readonly event: Map<number, string>;
  /** Text widths per font. */
  readonly widths: Readonly<Record<FontId, Map<string, number>>>;
};

/**
 * Makes empty caches.
 *
 * @returns The caches.
 * @example
 * ```ts
 * createLabelCache().axis.size; // 0
 * ```
 */
export function createLabelCache(): LabelCache {
  return {
    axis: new Map(),
    flag: new Map(),
    event: new Map(),
    widths: { mono500: new Map(), mono600: new Map(), sans500: new Map(), sans600: new Map() }
  };
}

/**
 * Forgets every label (a source switch: event seqs start over).
 *
 * @param cache - The caches.
 * @example
 * ```ts
 * clearLabels(scene.labels);
 * scene.labels.event.size; // 0
 * ```
 */
export function clearLabels(cache: LabelCache): void {
  cache.axis.clear();
  cache.flag.clear();
  cache.event.clear();
}

/**
 * The label of a key, built by `make(input)` the first time. `make` is a module function, so the call
 * allocates nothing once the label is cached.
 *
 * @param map - The cache of this kind of label.
 * @param key - The label's key.
 * @param input - What `make` builds it from.
 * @param make - Builds the label.
 * @returns The label.
 * @example
 * ```ts
 * labelOf(labels.axis, 5, 5, axisText); // "−5 s", built once
 * ```
 */
export function labelOf<Input>(
  map: Map<number, string>,
  key: number,
  input: Input,
  make: (input: Input) => string
): string {
  const known = map.get(key);
  if (known !== undefined) return known;
  if (map.size >= LABELS_MAX) map.clear();
  const made = make(input);
  map.set(key, made);
  return made;
}

/**
 * The width of a text in a font, measured once (the caller has set `g.font` to that font).
 *
 * @param cache - The caches.
 * @param g - The context.
 * @param font - The font in use.
 * @param text - The text.
 * @returns CSS px.
 * @example
 * ```ts
 * g.font = FONTS.mono600;
 * widthOf(labels, g, "mono600", "JS 22.4 ms"); // 70.1
 * ```
 */
export function widthOf(cache: LabelCache, g: PaintContext, font: FontId, text: string): number {
  const widths = cache.widths[font];
  const known = widths.get(text);
  if (known !== undefined) return known;
  if (widths.size >= LABELS_MAX) widths.clear();
  const width = g.measureText(text).width;
  widths.set(text, width);
  return width;
}

/**
 * An axis label: whole seconds before the right edge with a true minus (U+2212).
 *
 * @param seconds - Seconds before the edge.
 * @returns The label.
 * @example
 * ```ts
 * axisText(5); // "−5 s"
 * ```
 */
export function axisText(seconds: number): string {
  return `−${seconds} s`;
}

/**
 * A number of ms with one decimal, trailing ".0" dropped.
 *
 * @param ms - The number.
 * @returns The text.
 * @example
 * ```ts
 * msText(22.43); // "22.4"
 * ```
 */
export function msText(ms: number): string {
  return String(Math.round(ms * 10) / 10);
}
