/**
 * @file renderView source — the watch set of the active source and the switch burst (spec 09 §
 * M2 rules 3-5): on `activeSource:changed` every watch and the poll of the old source stop, the
 * history and the series are reset, the view returns to live, the selection, the detail read,
 * the rate answer and every popover close, and the new source's reads start. Typed stub of
 * build wave 0 (spec 09 § M17, RV0): the signatures are the contract the other Mission control
 * units build against; build wave 3 (RV4) writes the bodies.
 */
import { notBuilt } from "../stub";
import type { RenderViewCtx, RenderViewState } from "../types";
import type { SourceChange } from "./contract";

/**
 * The switch burst of a source change (M2 rule 3); `mission.source` becomes `change.to`.
 *
 * @param _ctx - Domain context of renderView.
 * @param _change - The source change activeSource emitted.
 * @throws {Error} Until build wave 3: "renderView source/syncSource is not built yet".
 */
export function syncSource(_ctx: RenderViewCtx, _change: SourceChange): void {
  notBuilt("source/syncSource", 3);
}

/**
 * Render shown: starts the § M2 watches and the poll of the active source (scene watches only
 * on the local preview).
 *
 * @param _ctx - Domain context of renderView.
 * @throws {Error} Until build wave 3: "renderView source/startMission is not built yet".
 */
export function startMission(_ctx: RenderViewCtx): void {
  notBuilt("source/startMission", 3);
}

/**
 * Render hidden or onStop: drops every § M2 watch and the poll; the history is kept (M2 rule
 * 5). Teardown-safe: it needs the state only.
 *
 * @param _state - renderView state.
 * @throws {Error} Until build wave 3: "renderView source/stopMission is not built yet".
 */
export function stopMission(_state: RenderViewState): void {
  notBuilt("source/stopMission", 3);
}
