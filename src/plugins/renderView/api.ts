/**
 * @file renderView plugin — api factory: the scene cards' refresh, snapshot, reveal, highlight,
 * sortTextures, filterBundle, and Mission control's members (mission, inspect, pause, live, setSpan,
 * seek, select, step, jump, setRate, setSection, setOverdraw, record, mark). Every Mission control
 * member re-renders Mission control after it acts. The contract of each member lives on
 * RenderViewApi in types.ts.
 */
import { activeSourcePlugin } from "../activeSource";
import { linkPlugin } from "../link";
import { workspacePlugin } from "../workspace";
import { filterTo, highlightRef, revealRef, sortBy } from "./actions";
import { cancelDetail, readDetail } from "./actions/detail";
import { lookupFiles } from "./actions/files";
import { runRate } from "./actions/rate";
import { runMark, runRecord } from "./actions/record";
import { runOverdraw, runSection } from "./actions/sections";
import { deriveSnapshot } from "./derive";
import { inspectorView } from "./derive/inspector";
import { missionView } from "./derive/mission";
import { newestEnd } from "./series/rows";
import { rangeSummary } from "./source/contract";
import { listed } from "./source/listed";
import { notifyMission } from "./state";
import type { FrameRange, RenderViewApi, RenderViewCtx } from "./types";
import { jumpTo, noJumpText, selectRange, stepFrame } from "./view/selection";
import {
  behindMs,
  clockEnd,
  keepInHistory,
  liveView,
  pauseView,
  seekView,
  setViewSpan,
  viewEnd
} from "./view/view";
import { refreshRenderView } from "./watch";

/**
 * The live end now: the display clock's right edge, or the newest frame's end before the clock ran.
 *
 * @param ctx - Domain context of renderView.
 * @returns Source-clock ms; undefined without frames.
 */
function liveEndNow(ctx: RenderViewCtx): number | undefined {
  const { mission } = ctx.state;
  return clockEnd(mission.clock, performance.now()) ?? newestEnd(mission.history);
}

/**
 * Starts the detail read of a kept selection and looks up its systems' files.
 *
 * @param ctx - Domain context of renderView.
 * @param range - The selection kept; undefined drops the read.
 */
function followSelection(ctx: RenderViewCtx, range: FrameRange | undefined): void {
  const { mission } = ctx.state;
  if (range === undefined) {
    if (mission.selection === undefined) cancelDetail(mission);
    return;
  }
  readDetail(ctx, range);
  const systems = rangeSummary(mission.history, range.from, range.to).systems.map(
    system => system.name
  );
  void lookupFiles(ctx, systems);
}

/**
 * Creates the renderView api over the plugin state.
 *
 * @param ctx - Domain context of renderView.
 * @returns The api.
 */
export function createRenderViewApi(ctx: RenderViewCtx): RenderViewApi {
  const { mission } = ctx.state;
  const done = <Value>(value: Value): Value => {
    notifyMission(mission);
    return value;
  };
  const changed = (): void => notifyMission(mission);
  return {
    refresh: () => refreshRenderView(ctx),
    snapshot: () => deriveSnapshot(ctx.state),
    reveal: ref => revealRef(ctx, ref),
    highlight: ref => highlightRef(ctx, ref),
    sortTextures: key => sortBy(ctx, key),
    filterBundle: bundle => filterTo(ctx, bundle),
    mission: () => {
      const live = liveEndNow(ctx);
      return missionView(mission, {
        label: ctx.require(activeSourcePlugin).label(),
        monitored: listed(ctx.require(linkPlugin).manifest(), "editor.perf.second"),
        endMs: viewEnd(mission.view, live) ?? 0,
        behindMs: behindMs(mission.view, live)
      });
    },
    inspect: () =>
      mission.source === undefined
        ? undefined
        : inspectorView(mission, viewEnd(mission.view, liveEndNow(ctx))),
    pause: () => {
      if (mission.history.count === 0) return;
      done(pauseView(mission.view, liveEndNow(ctx)));
    },
    live: () => {
      liveView(mission);
      cancelDetail(mission);
      changed();
    },
    setSpan: span => {
      setViewSpan(mission.view, span);
      const live = liveEndNow(ctx);
      if (live !== undefined) keepInHistory(mission.view, mission.history, live);
      changed();
    },
    seek: endMs => {
      const live = liveEndNow(ctx);
      if (live === undefined) return;
      seekView(mission.view, endMs, mission.history, live);
      changed();
    },
    select: range => {
      const kept = selectRange(mission, range, liveEndNow(ctx));
      followSelection(ctx, kept);
      return done(kept);
    },
    step: dir => {
      const frame = stepFrame(mission, dir, liveEndNow(ctx));
      if (frame !== undefined) followSelection(ctx, { from: frame, to: frame });
      return done(frame);
    },
    jump: (kind, dir) => {
      const found = jumpTo(mission, kind, dir, liveEndNow(ctx));
      if (found === undefined) ctx.require(workspacePlugin).toast(noJumpText(kind, dir));
      else followSelection(ctx, found);
      return done(found);
    },
    setRate: choice => runRate(ctx, choice),
    setSection: (section, on) => runSection(ctx, section, on),
    setOverdraw: on => runOverdraw(ctx, on),
    record: (on, label) => runRecord(ctx, on, label),
    mark: label => runMark(ctx, label)
  };
}
