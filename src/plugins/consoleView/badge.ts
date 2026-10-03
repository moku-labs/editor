/**
 * @file consoleView plugin — the Console rail badge (B2): warn + error count, red when any error.
 */
import { workspacePlugin } from "../workspace";
import type { Badge } from "../workspace/types";
import { countLevels } from "./filter";
import type { ConsoleCtx, LevelCounts } from "./types";

/**
 * The rail badge of the counts: none without warnings and errors; else warn + error, red when
 * any error, labelled with the non-zero parts.
 *
 * @param counts - Entry counts per level.
 * @returns The badge, or undefined.
 * @example
 * ```ts
 * badgeOf({ all: 9, debug: 0, info: 6, warn: 2, error: 1 }); // { count: 3, tone: "error", label: "2 warn · 1 error" }
 * ```
 */
export function badgeOf(counts: LevelCounts): Badge | undefined {
  const { warn, error } = counts;
  if (warn + error === 0) return undefined;

  const parts: string[] = [];
  if (warn > 0) parts.push(`${warn} warn`);
  if (error > 0) parts.push(`${error} error`);
  return { count: warn + error, tone: error > 0 ? "error" : "warn", label: parts.join(" · ") };
}

/**
 * Sends the badge of the held lines to the workspace rail (R4 workspace api).
 *
 * @param ctx - Domain context of consoleView.
 * @example
 * ```ts
 * pushBadge(ctx); // the rail shows "2" in amber after the design log
 * ```
 */
export function pushBadge(ctx: ConsoleCtx): void {
  ctx.require(workspacePlugin).badge("console", badgeOf(countLevels(ctx.state.lines)));
}
