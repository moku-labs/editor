/**
 * @file gameView plugin — texts of the views (pure): seconds, the stage badges (F12) and the
 * series result line (D3).
 */
import type { LinkStatus } from "../../registry/protocol";

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
  return String(Math.round(ms / 100) / 10);
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
  return (Math.max(0, ms) / 1000).toFixed(1);
}

/**
 * The link badge of the stage, if any.
 *
 * @param status - The link status.
 * @param now - Date.now().
 * @returns The badge, undefined while live or empty.
 * @example
 * ```ts
 * linkBadge({ kind: "paused", frame: 1841 }, 0)?.text; // "Paused · frame 1841"
 * ```
 */
export function linkBadge(status: LinkStatus, now: number): StageBadge | undefined {
  switch (status.kind) {
    case "paused": {
      return { key: "link", text: `Paused · frame ${status.frame}`, tone: "warn", spinner: false };
    }
    case "silent": {
      const seconds = Math.max(0, Math.round((now - status.since) / 1000));
      const text = `No heartbeat for ${seconds} s · showing frame ${status.lastFrame}`;
      return { key: "link", text, tone: "warn", spinner: false };
    }
    case "lost": {
      const retry = Math.ceil(status.retryInMs / 1000);
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
