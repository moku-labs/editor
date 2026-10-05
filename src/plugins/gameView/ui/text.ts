/**
 * @file gameView plugin — texts of the views (pure): seconds, the stage badges (F12), the
 * series result line (D3) and one value of the Styles list (finding 4).
 */
import type { Json, LinkStatus } from "../../registry/protocol";
import { isReloading } from "../../registry/protocol";

/**
 * Milliseconds in a second.
 */
const MS_PER_SECOND = 1000;

/**
 * Milliseconds in a tenth of a second.
 */
const MS_PER_TENTH = 100;

/**
 * Tenths in a second.
 */
const TENTHS_PER_SECOND = 10;

/**
 * One stage badge.
 */
export type StageBadge = {
  readonly key: string;
  readonly text: string;
  readonly tone: "warn" | "error" | "rec" | "info";
  readonly spinner: boolean;
};

/**
 * Milliseconds as seconds without trailing zeros.
 *
 * @param ms - Milliseconds.
 * @returns "2", "0.2", "20".
 * @example
 * ```ts
 * secondsText(200); // "0.2"
 * ```
 */
export function secondsText(ms: number): string {
  return String(Math.round(ms / MS_PER_TENTH) / TENTHS_PER_SECOND);
}

/**
 * Elapsed time with one decimal.
 *
 * @param ms - Milliseconds.
 * @returns "0.9".
 * @example
 * ```ts
 * elapsedText(912); // "0.9"
 * ```
 */
export function elapsedText(ms: number): string {
  return (Math.max(0, ms) / MS_PER_SECOND).toFixed(1);
}

/**
 * The link badge of the stage, if any.
 *
 * @param status - The link status.
 * @param now - Date.now().
 * @returns The badge, undefined while live, empty or in an expected reload (U9: the frame
 * spinner of workspace is the one indicator).
 * @example
 * ```ts
 * linkBadge({ kind: "paused", frame: 1841 }, 0)?.text; // "Paused · frame 1841"
 * linkBadge({ kind: "lost", reason: "socket_closed", lastFrame: 1825, retryInMs: 1000, reloading: true }, 0); // undefined
 * ```
 */
export function linkBadge(status: LinkStatus, now: number): StageBadge | undefined {
  switch (status.kind) {
    case "paused": {
      return { key: "link", text: `Paused · frame ${status.frame}`, tone: "warn", spinner: false };
    }
    case "silent": {
      const seconds = Math.max(0, Math.round((now - status.since) / MS_PER_SECOND));
      const text = `No heartbeat for ${seconds} s · showing frame ${status.lastFrame}`;
      return { key: "link", text, tone: "warn", spinner: false };
    }
    case "lost": {
      if (isReloading(status)) return undefined;
      const retry = Math.ceil(status.retryInMs / MS_PER_SECOND);
      const text = `Game page reloaded, reconnecting · retry in ${retry} s · last frame ${status.lastFrame}`;
      return { key: "link", text, tone: "error", spinner: true };
    }
    case "connecting": {
      return { key: "link", text: "Connecting", tone: "info", spinner: true };
    }
    default: {
      return undefined;
    }
  }
}

/**
 * A text cut in the middle to at most `max` characters, so both ends of a path stay readable.
 *
 * @param text - The text.
 * @param max - The most characters shown, the "…" included.
 * @returns The text, or its start, "…" and its end.
 * @example
 * ```ts
 * middleEllipsis(".moku/captures/2026-09-24-1012-board.png", 36); // ".moku/captures/20…-24-1012-board.png"
 * ```
 */
export function middleEllipsis(text: string, max: number): string {
  if (text.length <= max) return text;
  const keep = max - 1;
  const head = Math.floor(keep / 2);
  return `${text.slice(0, head)}…${text.slice(text.length - (keep - head))}`;
}

/**
 * The series result line: planned shots, length and interval.
 *
 * @param shots - Planned shots.
 * @param durationMs - Length.
 * @param intervalMs - Interval.
 * @returns "20 shots · 2 s at 100 ms".
 * @example
 * ```ts
 * resultText(20, 2000, 100); // "20 shots · 2 s at 100 ms"
 * ```
 */
export function resultText(shots: number, durationMs: number, intervalMs: number): string {
  return `${shots} shots · ${secondsText(durationMs)} s at ${intervalMs} ms`;
}

/**
 * One style value as text: strings, numbers and booleans as they are, an object as
 * `key value` pairs joined by ` · `, an array joined by `, `; nested values the same way.
 *
 * @param value - A style value.
 * @returns The text.
 * @example
 * ```ts
 * styleValue({ top: 266, right: 72, bottom: 64, left: 72 }); // "top 266 · right 72 · bottom 64 · left 72"
 * styleValue(["safeArea.top", 12]); // "safeArea.top, 12"
 * ```
 */
export function styleValue(value: Json): string {
  if (Array.isArray(value)) return value.map(item => styleValue(item)).join(", ");
  if (value !== null && typeof value === "object") {
    return Object.entries(value)
      .map(([key, item]) => `${key} ${styleValue(item)}`)
      .join(" · ");
  }
  return String(value);
}
