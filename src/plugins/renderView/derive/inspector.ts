/**
 * @file renderView derive — the inspector (spec 09 § M10): the summary of the view, or the
 * range view of the selection from rangeSummary and the detail read. Pure. Typed stub of build
 * wave 0 (spec 09 § M17, RV0): the signatures are the contract the other Mission control units
 * build against; build wave 3 (RV3) writes the bodies.
 */
import { notBuilt } from "../stub";
import type { InspectorView, MissionState } from "../types";

/**
 * The inspector's view.
 *
 * @param _mission - Mission control's state (history, selection, detail, files, view).
 * @param _endMs - The view's end now, source clock.
 * @returns The summary or range view; undefined without frames.
 * @throws {Error} Until build wave 3: "renderView derive/inspectorView is not built yet".
 */
export function inspectorView(
  _mission: MissionState,
  _endMs: number | undefined
): InspectorView | undefined {
  return notBuilt("derive/inspectorView", 3);
}
