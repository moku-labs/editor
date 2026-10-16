/**
 * @file renderView actions — the Monitoring switches (spec 09 § M7): `editor.perf.sections`
 * with a row's keys, flipped after the answer; the overdraw view through `game.debug { overdraw
 * }`. Typed stub of build wave 0 (spec 09 § M17, RV0): the signatures are the contract the
 * other Mission control units build against; build wave 3 (RV4) writes the bodies.
 */
import { notBuilt } from "../stub";
import type { MonitorSection, RenderViewCtx, SectionsAnswer } from "../types";

/**
 * Runs a row's switch; never rejects.
 *
 * @param _ctx - Domain context of renderView.
 * @param _section - The row.
 * @param _on - On or off.
 * @returns The answer.
 * @throws {Error} Until build wave 3: "renderView actions/runSection is not built yet".
 */
export function runSection(
  _ctx: RenderViewCtx,
  _section: MonitorSection,
  _on: boolean
): Promise<SectionsAnswer> {
  return notBuilt("actions/runSection", 3);
}

/**
 * Runs `game.debug { overdraw }`.
 *
 * @param _ctx - Domain context of renderView.
 * @param _on - On or off.
 * @returns The engine's flag after it (the old one on a refusal).
 * @throws {Error} Until build wave 3: "renderView actions/runOverdraw is not built yet".
 */
export function runOverdraw(_ctx: RenderViewCtx, _on: boolean): Promise<boolean> {
  return notBuilt("actions/runOverdraw", 3);
}
