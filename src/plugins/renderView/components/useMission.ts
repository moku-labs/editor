/**
 * @file renderView plugin — the Preact hooks of Mission control (spec 09 § M14): `useMission`
 * re-renders a component on every `notifyMission(mission)` (Mission control's own store, so its 1 Hz
 * values never re-render the scene cards), `useMissionApi` hands a component the plugin's api over
 * its ctx (the same members the MCP tools call), `useTicker` re-renders on a clock while a value
 * counts up ("Paused · N s behind live"), and `useHoverFrame` re-renders when the shared cursor moves
 * to another frame.
 */
import { useEffect, useLayoutEffect, useMemo, useState } from "preact/hooks";
import { createRenderViewApi } from "../api";
import { subscribeMission } from "../state";
import type { MissionState, RenderViewApi, RenderViewCtx } from "../types";
import { hoverFrame, onHoverFrame } from "../view/hover";

/**
 * Subscribes the component to Mission control's state and returns the selected value of this
 * render. The subscription is a layout effect: it runs before paint, so a `notifyMission` right
 * after the first render is not lost.
 *
 * @param mission - Mission control's state.
 * @param select - Reads what the component shows.
 * @returns The selected value.
 */
export function useMission<T>(mission: MissionState, select: () => T): T {
  const [, setVersion] = useState(0);
  useLayoutEffect(
    () => subscribeMission(mission, () => setVersion(version => version + 1)),
    [mission]
  );
  return select();
}

/**
 * The renderView api over the component's ctx, made once per mount.
 *
 * @param ctx - Domain context of renderView.
 * @returns The api.
 */
export function useMissionApi(ctx: RenderViewCtx): RenderViewApi {
  return useMemo(() => createRenderViewApi(ctx), [ctx]);
}

/**
 * Re-renders the component every `ms` while `on`.
 *
 * @param ms - The period.
 * @param on - Whether the clock runs.
 */
export function useTicker(ms: number, on: boolean): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!on) return;
    const timer = setInterval(() => setTick(tick => tick + 1), ms);
    return () => clearInterval(timer);
  }, [ms, on]);
}

/**
 * The frame under the shared cursor; re-renders the component when it changes.
 *
 * @param mission - Mission control's state.
 * @returns The frame; undefined without a hover.
 */
export function useHoverFrame(mission: MissionState): number | undefined {
  const [, setVersion] = useState(0);
  useLayoutEffect(() => onHoverFrame(mission, () => setVersion(version => version + 1)), [mission]);
  return hoverFrame(mission);
}
