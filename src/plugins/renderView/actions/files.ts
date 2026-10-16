/**
 * @file renderView actions — the inspector's file links (spec 09 § M10): `system:<name>` looked
 * up once per session through the project index, and the `workspace:open-file` emission. Typed
 * stub of build wave 0 (spec 09 § M17, RV0): the signatures are the contract the other Mission
 * control units build against; build wave 3 (RV4) writes the bodies.
 */
import { notBuilt } from "../stub";
import type { RenderViewCtx } from "../types";

/**
 * Where a system is defined (cached in `mission.files`).
 *
 * @param _ctx - Domain context of renderView.
 * @param _system - A system name.
 * @returns The file and line; null for an engine system or an unresolved name.
 * @throws {Error} Until build wave 3: "renderView actions/systemFile is not built yet".
 */
export function systemFile(
  _ctx: RenderViewCtx,
  _system: string
): Promise<{ readonly path: string; readonly line: number } | null> {
  return notBuilt("actions/systemFile", 3);
}

/**
 * Emits `workspace:open-file { path, line }` and toasts "Open in editor: …".
 *
 * @param _ctx - Domain context of renderView.
 * @param _path - The file.
 * @param _line - The line.
 * @throws {Error} Until build wave 3: "renderView actions/openFile is not built yet".
 */
export function openFile(_ctx: RenderViewCtx, _path: string, _line: number): void {
  notBuilt("actions/openFile", 3);
}
