/**
 * @file renderView source — the watch set of the active source and the switch burst (spec 09 § M2
 * rules 1–5, M13): Render shown starts `editor.perf.second`, `editor.perf.passes` and
 * `editor.recorder` watches and the poll, each only when the manifest lists it; Render hidden drops
 * them and keeps the history; on `activeSource:changed` every watch and the poll of the old source
 * stop, the history, the series and the clock are reset, the view returns to live, the selection,
 * the detail read, the answers and the popovers close, and the new source's reads start (no scene
 * watch on a device, R4).
 */
import { linkPlugin } from "../../link";
import type { Json } from "../../registry/protocol";
import { cancelDetail } from "../actions/detail";
import { closePopover } from "../actions/popover";
import { newestEnd } from "../series/rows";
import { addSecond } from "../series/samples";
import { clearSeries } from "../series/series";
import { notify, notifyMission } from "../state";
import type { RenderViewCtx, RenderViewState } from "../types";
import { resetDisplayClock } from "../view/clock";
import { clearSelection } from "../view/selection";
import { startScene, stopScene } from "../watch";
import type { PerfSecond, SourceChange } from "./contract";
import { appendSample, appendSecond, clearPerfHistory } from "./contract";
import { isPassesWire, isPerfSecond, isRecorderSource } from "./guards";
import { listed } from "./listed";
import { startPoll, stopPoll } from "./poll";

/**
 * The page's time origin of a second (its epoch as a number).
 *
 * @param second - The source's second.
 * @returns Epoch ms; null when not known.
 * @example
 * ```ts
 * timeOriginOf(second); // 1_792_000_000_000.5
 * ```
 */
export function timeOriginOf(second: PerfSecond | undefined): number | null {
  const origin =
    second?.epoch === undefined || second.epoch === null ? Number.NaN : Number(second.epoch);
  // eslint-disable-next-line unicorn/no-null -- null: no time origin yet
  return Number.isFinite(origin) ? origin : null;
}

/**
 * The source-clock time of a second's sample (its epoch-ms `t` less the page's origin), else the
 * history's newest frame end.
 *
 * @param ctx - Domain context of renderView.
 * @param second - The second.
 * @returns Source-clock ms.
 */
function secondTime(ctx: RenderViewCtx, second: PerfSecond): number {
  const origin = timeOriginOf(second);
  const sample = second.sample;
  if (sample !== null && origin !== null) return sample.t - origin;
  return newestEnd(ctx.state.mission.history) ?? 0;
}

/**
 * Warns about a value of another shape (dropped, never shown).
 *
 * @param ctx - Domain context of renderView.
 * @param id - The source id.
 */
function shapeWarning(ctx: RenderViewCtx, id: string): void {
  ctx.log.warn("renderView: unexpected source shape", { id });
}

/**
 * Takes an `editor.perf.second` value: the newest second, its sample into the history (the
 * per-second systems a range falls back on) and its 1 Hz series.
 *
 * @param ctx - Domain context of renderView.
 * @param value - The watched value.
 */
function onSecond(ctx: RenderViewCtx, value: Json): void {
  if (!isPerfSecond(value)) {
    shapeWarning(ctx, "editor.perf.second");
    return;
  }
  const { mission } = ctx.state;
  mission.second = value;
  if (value.sample !== null) appendSample(mission.history, value.sample);
  addSecond(mission.series, value, secondTime(ctx, value), mission.source?.kind !== "device");
  notifyMission(mission);
}

/**
 * Takes an `editor.perf.passes` value: the raw second for the panel, its summary into the history.
 *
 * @param ctx - Domain context of renderView.
 * @param value - The watched value; null before the agent's first full second.
 */
function onPasses(ctx: RenderViewCtx, value: Json): void {
  const { mission } = ctx.state;
  if (value === null) {
    mission.passes = value;
  } else if (isPassesWire(value)) {
    mission.passes = value;
    appendSecond(mission.history, value);
  } else {
    shapeWarning(ctx, "editor.perf.passes");
    return;
  }
  notifyMission(mission);
}

/**
 * Takes an `editor.recorder` value.
 *
 * @param ctx - Domain context of renderView.
 * @param value - The watched value.
 */
function onRecorder(ctx: RenderViewCtx, value: Json): void {
  if (!isRecorderSource(value)) {
    shapeWarning(ctx, "editor.recorder");
    return;
  }
  ctx.state.mission.recorder = value;
  notifyMission(ctx.state.mission);
}

/** The watches of § M2 and their handlers. */
const WATCHES: readonly (readonly [string, (ctx: RenderViewCtx, value: Json) => void])[] = [
  ["editor.perf.second", onSecond],
  ["editor.perf.passes", onPasses],
  ["editor.recorder", onRecorder]
];

/**
 * Render shown: starts the § M2 watches of the active source the manifest lists, and the poll when
 * it lists the frames feed. Nothing while Render is hidden, without a source, or already started.
 *
 * @param ctx - Domain context of renderView.
 * @example
 * ```ts
 * startMission(ctx); // editor.perf.second, editor.perf.passes, editor.recorder watched; the poll runs
 * ```
 */
export function startMission(ctx: RenderViewCtx): void {
  const { state } = ctx;
  const { mission } = state;
  if (!state.active || mission.source === undefined || mission.watches.length > 0) return;
  const link = ctx.require(linkPlugin);
  const manifest = link.manifest();
  for (const [id, handler] of WATCHES) {
    if (!listed(manifest, id)) continue;
    mission.watches.push(link.watch(id, undefined, value => handler(ctx, value)));
  }
  if (listed(manifest, "editor.perf.frames")) startPoll(ctx);
}

/**
 * Render hidden or onStop: drops every § M2 watch and the poll; the history is kept (M2 rule 5).
 * Teardown-safe: it needs the state only.
 *
 * @param state - renderView state.
 * @example
 * ```ts
 * stopMission(state);
 * state.mission.watches; // []
 * ```
 */
export function stopMission(state: RenderViewState): void {
  const { mission } = state;
  const stops = mission.watches;
  mission.watches = [];
  for (const stop of stops) stop();
  stopPoll(mission);
}

/**
 * The manifest changed (a session attached, a reload): the watches and the poll start over with what
 * the new manifest lists.
 *
 * @param ctx - Domain context of renderView.
 * @example
 * ```ts
 * link.onManifest(() => restartMission(ctx));
 * ```
 */
export function restartMission(ctx: RenderViewCtx): void {
  stopMission(ctx.state);
  startMission(ctx);
}

/**
 * Forgets everything of the old source: the history, the series, the clock, live view, the
 * selection and the detail read, the last values, the answers in flight and the file cache.
 *
 * @param state - renderView state.
 */
function forgetSource(state: RenderViewState): void {
  const { mission } = state;
  cancelDetail(mission);
  clearPerfHistory(mission.history);
  clearSeries(mission.series);
  resetDisplayClock(mission.clock);
  mission.view.live = true;
  mission.view.endMs = 0;
  clearSelection(mission);
  mission.second = undefined;
  mission.passes = undefined;
  mission.recorder = undefined;
  mission.telemetry = undefined;
  mission.rate.pending = undefined;
  mission.rate.answer = undefined;
  mission.sectionPending = undefined;
  mission.hoverMs = undefined;
  mission.files.clear();
}

/**
 * The switch burst of a source change (M2 rule 3): the old source's watches and poll stop, its data
 * is forgotten, every popover closes (the Connect panel stays when `keepConnect`, for its success
 * alert), `mission.source` becomes `change.to`, the scene watches follow (none on a device, R4) and
 * the new source's reads start.
 *
 * @param ctx - Domain context of renderView.
 * @param change - The source change activeSource emitted.
 * @param keepConnect - Leave the Connect panel open (a switch to a device while it is open).
 * @example
 * ```ts
 * syncSource(ctx, { from: local, to: phone, reason: "connected", at: Date.now() }, false);
 * ctx.state.mission.history.count; // 0 until the phone's first frames
 * ```
 */
export function syncSource(ctx: RenderViewCtx, change: SourceChange, keepConnect: boolean): void {
  const { state } = ctx;
  const { mission } = state;
  stopMission(state);
  forgetSource(state);
  if (!keepConnect || mission.popover !== "connect") closePopover(mission);
  mission.source = change.to;
  if (change.to.kind === "device") stopScene(ctx);
  else if (state.active) startScene(ctx);
  startMission(ctx);
  notifyMission(mission);
  notify(state);
}
