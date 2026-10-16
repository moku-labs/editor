/**
 * @file renderView actions — Record, Stop and Mark (spec 09 § M7): `editor.record { on, label
 * }` and `{ mark }`; the page sends no origin (the hub stamps it). Typed stub of build wave 0
 * (spec 09 § M17, RV0): the signatures are the contract the other Mission control units build
 * against; build wave 3 (RV4) writes the bodies.
 */
import { notBuilt } from "../stub";
import type { RecordAnswer, RenderViewCtx } from "../types";

/**
 * Runs Record or Stop; never rejects.
 *
 * @param _ctx - Domain context of renderView.
 * @param _on - Record or Stop.
 * @param _label - The log's label.
 * @returns The answer.
 * @throws {Error} Until build wave 3: "renderView actions/runRecord is not built yet".
 */
export function runRecord(
  _ctx: RenderViewCtx,
  _on: boolean,
  _label: string | undefined
): Promise<RecordAnswer> {
  return notBuilt("actions/runRecord", 3);
}

/**
 * Runs a mark; an empty label becomes "mark {n + 1}".
 *
 * @param _ctx - Domain context of renderView.
 * @param _label - The mark's label.
 * @returns The answer's `marked`.
 * @throws {Error} Until build wave 3: "renderView actions/runMark is not built yet".
 */
export function runMark(_ctx: RenderViewCtx, _label: string | undefined): Promise<boolean> {
  return notBuilt("actions/runMark", 3);
}
