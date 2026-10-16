/**
 * @file renderView derive — the small word helpers every Mission control string uses (spec 09 § M7–
 * M10, "text is text"): numbers with one or two decimals, mm:ss, MB, an error's first line and its
 * wire reason, and a line with strong parts the components render in bold. Pure.
 */
import { ERROR_PREFIX } from "../../registry/protocol";

/**
 * A part of a line drawn strong (bold): "**3** spikes in view".
 *
 * @example
 * ```ts
 * const part: Strong = { strong: "3" };
 * ```
 */
export type Strong = { readonly strong: string };

/**
 * A line of words with strong parts.
 *
 * @example
 * ```ts
 * const line: Line = [{ strong: "40" }, " textures, 68 % of budget"];
 * ```
 */
export type Line = readonly (string | Strong)[];

/**
 * The tone of a tag or an em: calm text, a good state, a warning, an error, the accent, muted.
 *
 * @example
 * ```ts
 * const tone: Tone = "warn"; // "Connected, waiting"
 * ```
 */
export type Tone = "plain" | "ok" | "warn" | "error" | "acc" | "muted";

/**
 * A tag: its words, its tone and an optional title (the hover text).
 *
 * @example
 * ```ts
 * const tag: Tag = { text: "engine differs", tone: "warn", title: "Phone runs 0.15.0+9c41e0, computer has 0.15.1+1ab7f2" };
 * ```
 */
export type Tag = { readonly text: string; readonly tone: Tone; readonly title?: string };

/** The dash shown for a value that is not known: never 0. */
export const DASH = "—";

/**
 * A strong part.
 *
 * @param text - Its words.
 * @returns The part.
 * @example
 * ```ts
 * strong("41.3"); // { strong: "41.3" }
 * ```
 */
export function strong(text: string): Strong {
  return { strong: text };
}

/**
 * A number with at most one decimal, ".0" dropped.
 *
 * @param value - The number.
 * @returns The text.
 * @example
 * ```ts
 * oneDecimal(2.8125); // "2.8"
 * oneDecimal(3); // "3"
 * ```
 */
export function oneDecimal(value: number): string {
  return String(Math.round(value * 10) / 10);
}

/**
 * A number with at most two decimals, trailing zeros dropped.
 *
 * @param value - The number.
 * @returns The text.
 * @example
 * ```ts
 * twoDecimals(0.854); // "0.85"
 * ```
 */
export function twoDecimals(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/**
 * A duration in seconds: two decimals under 1 s, else one.
 *
 * @param ms - The duration.
 * @returns "0.85 s", "6.2 s".
 * @example
 * ```ts
 * secondsText(850); // "0.85 s"
 * ```
 */
export function secondsText(ms: number): string {
  return `${ms < 1000 ? twoDecimals(ms / 1000) : oneDecimal(ms / 1000)} s`;
}

/**
 * Minutes and seconds of a duration, both two digits.
 *
 * @param ms - The duration.
 * @returns "mm:ss".
 * @example
 * ```ts
 * mmss(42_000); // "00:42"
 * ```
 */
export function mmss(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * Bytes in MB with one decimal (10⁶ bytes).
 *
 * @param bytes - The size.
 * @returns "3.1".
 * @example
 * ```ts
 * mbText(3_100_000); // "3.1"
 * ```
 */
export function mbText(bytes: number): string {
  return (bytes / 1_000_000).toFixed(1);
}

/**
 * The first line of an error's message, without the editor's prefix.
 *
 * @param error - What a call rejected with.
 * @returns The words.
 * @example
 * ```ts
 * messageOf(new Error("[moku-editor] No debug game answered on SM-A266B.\n  Start the debug build.")); // "No debug game answered on SM-A266B."
 * ```
 */
export function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const first = text.split("\n", 1)[0] ?? "";
  return first.startsWith(ERROR_PREFIX) ? first.slice(ERROR_PREFIX.length) : first;
}

/**
 * The wire reason of a refusal, its dashes and underscores made one (`"dev-only"` and `"dev_only"`
 * both read `"dev_only"`).
 *
 * @param error - What a call rejected with.
 * @returns The reason; undefined for an error without one.
 * @example
 * ```ts
 * reasonOf(new ProtocolError(-32_009, "[moku-editor] refused", { reason: "dev_only" })); // "dev_only"
 * ```
 */
export function reasonOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const data: unknown = Reflect.get(error, "data");
  if (typeof data !== "object" || data === null) return undefined;
  const reason: unknown = Reflect.get(data, "reason");
  return typeof reason === "string" ? reason.replaceAll("-", "_") : undefined;
}
