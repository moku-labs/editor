/**
 * @file renderView source — the poll (spec 09 § M2 rule 2): while Render is shown and the source is
 * live, one timer every POLL_MS reads `editor.perf.frames { after: the newest frame }` and then
 * `editor.perf.events { after: the next seq }` (the second read starts after the first answers); a
 * read in flight is never doubled; a failed read is retried on the next tick (one debug log per
 * streak); each frames answer with new rows feeds the display clock; a new epoch resets the history
 * and the series; an answer that comes after the poll stopped is dropped.
 */
import { linkPlugin } from "../../link";
import type { Json } from "../../registry/protocol";
import { noteEvents, noteRows } from "../series/overview";
import { newestEnd } from "../series/rows";
import { clearSeries } from "../series/series";
import { notifyMission } from "../state";
import type { MissionState, RenderViewCtx } from "../types";
import { noteArrival } from "../view/clock";
import { clearSelection, dropStaleSelection } from "../view/selection";
import { appendEvents, appendFrames, readFramesWire } from "./contract";
import { isEventsWire } from "./guards";
import { listed } from "./listed";

/** The poll's period, ms (spec 09 § M12). */
export const POLL_MS = 1000;

/**
 * The input of a read after a frame or seq.
 *
 * @param after - The newest frame held, or the next seq; undefined before any.
 * @returns `{ after }`, or `{}` before any.
 */
function afterInput(after: number | undefined): Json {
  return after === undefined ? {} : { after };
}

/**
 * Takes a frames answer: appends it to the history (a new epoch resets the history and the series,
 * and the selection goes), folds the new rows into the overview, notes the arrival on the clock.
 *
 * @param ctx - Domain context of renderView.
 * @param value - The `editor.perf.frames` answer.
 */
function takeFrames(ctx: RenderViewCtx, value: Json): void {
  const { mission } = ctx.state;
  const wire = readFramesWire(value);
  if (wire === undefined) {
    ctx.log.warn("renderView: unexpected source shape", { id: "editor.perf.frames" });
    return;
  }
  const { history, series } = mission;
  const appended = appendFrames(history, wire);
  if (appended.reset) {
    clearSeries(series);
    clearSelection(mission);
  }
  noteRows(series, history, history.count - appended.added);
  const end = newestEnd(history);
  if (appended.added > 0 && end !== undefined) noteArrival(mission.clock, end, performance.now());
  dropStaleSelection(mission);
}

/**
 * Takes an events answer: appends it (the lines become marks there) and flags the overview.
 *
 * @param ctx - Domain context of renderView.
 * @param value - The `editor.perf.events` answer.
 */
function takeEvents(ctx: RenderViewCtx, value: Json): void {
  const { mission } = ctx.state;
  if (!isEventsWire(value)) {
    ctx.log.warn("renderView: unexpected source shape", { id: "editor.perf.events" });
    return;
  }
  const added = appendEvents(mission.history, value);
  noteEvents(mission.series, mission.history, mission.history.eventCount - added);
  mission.poll.eventsAfter = mission.history.eventsNext;
}

/**
 * Whether an answer still belongs to the running poll (not stopped, not restarted, same source).
 *
 * @param mission - Mission control's state.
 * @param timer - The poll's timer when the read started.
 * @param source - The source when the read started.
 * @returns Whether to take it.
 */
function current(
  mission: MissionState,
  timer: MissionState["poll"]["timer"],
  source: MissionState["source"]
): boolean {
  return mission.poll.timer === timer && mission.source === source;
}

/**
 * One tick: the frames read, then the events read; appends both to the history and notes the
 * arrival on the clock. Nothing while a read is in flight or the source does not list the feed.
 *
 * @param ctx - Domain context of renderView.
 * @returns When both reads settled (never rejects).
 * @example
 * ```ts
 * await pollOnce(ctx); // editor.perf.frames { after: 4860 }, then editor.perf.events { after: 813 }
 * ```
 */
export async function pollOnce(ctx: RenderViewCtx): Promise<void> {
  const { mission } = ctx.state;
  const { poll, history } = mission;
  const link = ctx.require(linkPlugin);
  const manifest = link.manifest();
  if (poll.inFlight || !listed(manifest, "editor.perf.frames")) return;
  const { timer } = poll;
  const { source } = mission;
  poll.inFlight = true;
  try {
    const newest = history.count > 0 ? history.frame[history.count - 1] : undefined;
    const frames = await link.read("editor.perf.frames", afterInput(newest));
    if (!current(mission, timer, source)) return;
    takeFrames(ctx, frames);
    if (listed(manifest, "editor.perf.events")) {
      const events = await link.read("editor.perf.events", afterInput(history.eventsNext));
      if (!current(mission, timer, source)) return;
      takeEvents(ctx, events);
    }
    poll.failing = false;
    notifyMission(mission);
  } catch (error) {
    if (current(mission, timer, source) && !poll.failing) {
      ctx.log.debug("renderView:poll-failed", {
        message: error instanceof Error ? error.message : String(error)
      });
    }
    poll.failing = true;
  } finally {
    if (poll.timer === timer) poll.inFlight = false;
  }
}

/**
 * Starts the poll of the active source (idempotent): a read at once, then one every POLL_MS.
 *
 * @param ctx - Domain context of renderView.
 * @example
 * ```ts
 * startPoll(ctx); // Render shown, the source lists editor.perf.frames
 * ```
 */
export function startPoll(ctx: RenderViewCtx): void {
  const { poll } = ctx.state.mission;
  if (poll.timer !== undefined) return;
  poll.timer = setInterval(() => void pollOnce(ctx), POLL_MS);
  void pollOnce(ctx);
}

/**
 * Stops the poll; a read in flight is dropped when it answers.
 *
 * @param mission - Mission control's state.
 * @example
 * ```ts
 * stopPoll(mission);
 * mission.poll.timer; // undefined
 * ```
 */
export function stopPoll(mission: MissionState): void {
  clearInterval(mission.poll.timer);
  mission.poll.timer = undefined;
  mission.poll.inFlight = false;
}
