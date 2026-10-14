/**
 * @file perf/graph — the label strings the painter builds, each only when its cached key changed
 * (the readout, the caption, the axis, the tape and the rate labels). Pure.
 */

/**
 * A number with one decimal.
 *
 * @param value - The number.
 * @returns The text.
 * @example
 * ```ts
 * oneDecimal(8.333); // "8.3"
 * ```
 */
export function oneDecimal(value: number): string {
  return value.toFixed(1);
}

/**
 * The caption of a row: its frame, and its place among the spikes when it is one.
 *
 * @param frame - The frame number.
 * @param ordinal - Its 1-based place among the spikes; 0 when it is not a spike.
 * @param count - Spikes in the window.
 * @returns The caption.
 * @example
 * ```ts
 * captionOf(4812, 5, 6); // "frame 4812, spike 5/6"
 * ```
 */
export function captionOf(frame: number, ordinal: number, count: number): string {
  return ordinal === 0 ? `frame ${frame}` : `frame ${frame}, spike ${ordinal}/${count}`;
}

/**
 * The cache key of a caption.
 *
 * @param frame - The frame number.
 * @param ordinal - Its place among the spikes.
 * @param count - Spikes in the window.
 * @returns The key.
 * @example
 * ```ts
 * captionKeyOf(4812, 5, 6); // "4812:5/6"
 * ```
 */
export function captionKeyOf(frame: number, ordinal: number, count: number): string {
  return `${frame}:${ordinal}/${count}`;
}

/**
 * The time-axis label of a second before now, with a true minus sign (U+2212).
 *
 * @param seconds - Whole seconds before now.
 * @returns The label.
 * @example
 * ```ts
 * axisLabel(6); // "−6 s"
 * ```
 */
export function axisLabel(seconds: number): string {
  return `−${seconds} s`;
}

/**
 * The text of a cause's flag: its legend, with "likely" for the hollow (GC?) one.
 *
 * @param legend - The cause's legend.
 * @param hollow - Whether the cause is a hint (GC?).
 * @returns The flag text.
 * @example
 * ```ts
 * flagText("GC?", true); // "GC? likely"
 * ```
 */
export function flagText(legend: string, hollow: boolean): string {
  return hollow ? `${legend} likely` : legend;
}
