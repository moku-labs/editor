/**
 * @file renderView actions — the detail read of a selection (spec 09 § M10): one
 * `editor.perf.detail { from, to }` read DETAIL_DELAY_MS after a selection settles (a drag does not
 * spam reads), its frames merged with appendFrames and its nodes kept for that exact range; a late
 * answer for a replaced or cleared selection is dropped; no read when the source does not list it.
 */
import { linkPlugin } from "../../link";
import { messageOf } from "../derive/words";
import { noteRows } from "../series/overview";
import { appendFrames } from "../source/contract";
import { isDetailWire } from "../source/guards";
import { listed } from "../source/listed";
import { notifyMission } from "../state";
import type { MissionState, RenderViewCtx } from "../types";
import type { FrameRange } from "../view/types";

/** The settle time before a detail read, ms (spec 09 § M12). */
export const DETAIL_DELAY_MS = 150;

/**
 * Whether the detail read of a range is still the one the page waits for.
 *
 * @param mission - Mission control's state.
 * @param range - The range read.
 * @returns Whether its answer applies.
 */
function stillWanted(mission: MissionState, range: FrameRange): boolean {
  const { detail, selection } = mission;
  return detail.kind === "loading" && selection?.from === range.from && selection.to === range.to;
}

/**
 * Reads the detail of a range and keeps it (unless the selection moved on meanwhile).
 *
 * @param ctx - Domain context of renderView.
 * @param range - The settled selection.
 * @returns When it settled (never rejects).
 */
async function fetchDetail(ctx: RenderViewCtx, range: FrameRange): Promise<void> {
  const { mission } = ctx.state;
  mission.detailTimer = undefined;
  try {
    const value = await ctx
      .require(linkPlugin)
      .read("editor.perf.detail", { from: range.from, to: range.to });
    if (!stillWanted(mission, range)) return;
    if (!isDetailWire(value)) {
      mission.detail = { kind: "failed", range, message: "unexpected answer" };
      return;
    }
    if (value.frames !== null) {
      const added = appendFrames(mission.history, value.frames).added;
      noteRows(mission.series, mission.history, mission.history.count - added);
    }
    mission.detail = { kind: "shown", range, reason: value.reason, nodes: value.nodes };
  } catch (error) {
    if (stillWanted(mission, range))
      mission.detail = { kind: "failed", range, message: messageOf(error) };
  } finally {
    notifyMission(mission);
  }
}

/**
 * Schedules the detail read of a selection: a newer selection replaces it; a source that does not
 * list `editor.perf.detail` gets none (the inspector keeps the history's view).
 *
 * @param ctx - Domain context of renderView.
 * @param range - The settled selection.
 * @example
 * ```ts
 * readDetail(ctx, { from: 4810, to: 4860 }); // one read 150 ms later
 * ```
 */
export function readDetail(ctx: RenderViewCtx, range: FrameRange): void {
  const { mission } = ctx.state;
  cancelDetail(mission);
  if (!listed(ctx.require(linkPlugin).manifest(), "editor.perf.detail")) return;
  mission.detail = { kind: "loading", range };
  mission.detailTimer = setTimeout(() => void fetchDetail(ctx, range), DETAIL_DELAY_MS);
}

/**
 * Drops a scheduled or running detail read (a cleared selection, a source switch, onStop).
 *
 * @param mission - Mission control's state.
 * @example
 * ```ts
 * cancelDetail(mission);
 * mission.detail; // { kind: "idle" }
 * ```
 */
export function cancelDetail(mission: MissionState): void {
  clearTimeout(mission.detailTimer);
  mission.detailTimer = undefined;
  mission.detail = { kind: "idle" };
}
