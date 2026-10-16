/**
 * @file overlay plugin — pure formatting of the numbers and times the overlay prints, and the
 * colour tokens the view models name.
 */

/**
 * The colour tokens of the stylesheet (styles/tokens.ts) as `--c` values.
 */
export const COLOUR = {
  ink: "var(--ink)",
  ink2: "var(--ink-2)",
  measured: "var(--measured)",
  caution: "var(--caution)",
  warning: "var(--warning)",
  live: "var(--live)",
  budget: "var(--budget)"
} as const;

/** The no-break space that groups digits. */
const NBSP = " ";

/** Bytes in a KB and an MB (decimal, as a file manager prints them). */
const KB = 1000;
const MB = 1_000_000;

/** Milliseconds in a second, a minute and an hour. */
const SECOND = 1000;
const MINUTE = 60_000;
const HOUR = 3_600_000;

/**
 * Two digits, zero-padded.
 *
 * @param value - A whole number from 0 to 99.
 * @returns The text.
 * @example
 * ```ts
 * twoDigits(3); // "03"
 * ```
 */
function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * A whole number with its thousands grouped by a no-break space.
 *
 * @param value - The number.
 * @returns The text.
 * @example
 * ```ts
 * groupDigits(1840); // "1 840"
 * ```
 */
export function groupDigits(value: number): string {
  const digits = String(Math.abs(Math.round(value)));
  const groups: string[] = [];
  for (let end = digits.length; end > 0; end -= 3)
    groups.unshift(digits.slice(Math.max(0, end - 3), end));
  return `${value < 0 ? "-" : ""}${groups.join(NBSP)}`;
}

/**
 * A size: whole KB under 1 MB, MB with one decimal above.
 *
 * @param bytes - The size in bytes.
 * @returns The text.
 * @example
 * ```ts
 * sizeText(412_000); // "412 KB"
 * ```
 */
export function sizeText(bytes: number): string {
  return bytes < MB ? `${Math.round(bytes / KB)} KB` : `${(bytes / MB).toFixed(1)} MB`;
}

/**
 * A recording clock: `mm:ss`, `h:mm:ss` past an hour.
 *
 * @param ms - Milliseconds since the start.
 * @returns The text.
 * @example
 * ```ts
 * clockText(192_000); // "03:12"
 * ```
 */
export function clockText(ms: number): string {
  const whole = Math.max(0, Math.floor(ms / SECOND));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const seconds = whole % 60;
  if (hours > 0) return `${hours}:${twoDigits(minutes)}:${twoDigits(seconds)}`;
  return `${twoDigits(minutes)}:${twoDigits(seconds)}`;
}

/**
 * A log time with tenths: `mm:ss.s`.
 *
 * @param ms - Milliseconds since the log started.
 * @returns The text.
 * @example
 * ```ts
 * logTime(191_020); // "03:11.0"
 * ```
 */
export function logTime(ms: number): string {
  const minutes = Math.floor(ms / MINUTE);
  const seconds = (ms % MINUTE) / SECOND;
  return `${twoDigits(minutes)}:${seconds.toFixed(1).padStart(4, "0")}`;
}

/**
 * The local `HH:MM` of an epoch moment.
 *
 * @param epoch - Epoch ms.
 * @returns The text.
 * @example
 * ```ts
 * hourMinute(new Date(2026, 9, 14, 15, 32).getTime()); // "15:32"
 * ```
 */
export function hourMinute(epoch: number): string {
  const date = new Date(epoch);
  return `${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`;
}

/**
 * One decimal, or "—" for a value that is not a finite number.
 *
 * @param value - The number.
 * @returns The text.
 * @example
 * ```ts
 * oneDecimal(18.24); // "18.2"
 * ```
 */
export function oneDecimal(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(1) : "—";
}

/**
 * A whole number, or "—" for a value that is not a finite number.
 *
 * @param value - The number.
 * @returns The text.
 * @example
 * ```ts
 * wholeText(211.6); // "212"
 * ```
 */
export function wholeText(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? String(Math.round(value)) : "—";
}

/**
 * Whole seconds between two moments.
 *
 * @param from - Epoch ms of the earlier moment.
 * @param now - Epoch ms now.
 * @returns The seconds, at least 0.
 * @example
 * ```ts
 * secondsBetween(1000, 2400); // 1
 * ```
 */
export function secondsBetween(from: number, now: number): number {
  return Math.max(0, Math.round((now - from) / SECOND));
}

/**
 * A duration as short as the compact card's header needs (header fit test): whole seconds under a
 * minute, then whole minutes, then whole hours, the unit's letter right after the number.
 *
 * @param ms - The duration, ms (negative reads as 0).
 * @returns "12s", "4m" or "2h".
 * @example
 * ```ts
 * shortDuration(192_000); // "3m"
 * ```
 */
export function shortDuration(ms: number): string {
  const elapsed = Math.max(0, ms);
  if (elapsed < MINUTE) return `${Math.floor(elapsed / SECOND)}s`;
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`;
  return `${Math.floor(elapsed / HOUR)}h`;
}

/**
 * How long the screen has rested, short (`shortDuration`); "" without a start.
 *
 * @param since - Epoch ms of the first resting frame (perf's `activity.idleSince`), or null.
 * @param now - Epoch ms now.
 * @returns "12s", "4m", "2h" or "".
 * @example
 * ```ts
 * idleForText(1000, 13_400); // "12s"
 * ```
 */
export function idleForText(since: number | null, now: number): string {
  return since === null ? "" : shortDuration(now - since);
}
