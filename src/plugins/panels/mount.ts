/**
 * @file panels plugin — mount.ts (skeleton stubs, implemented in its wave).
 */
import type { Json, RunResult } from "../registry/protocol";
import type { MountedPanel, PanelRunOrigin, PanelSpec, PanelsCtx } from "./types";

/**
 * Skeleton stub for `mountPanel`; implemented in its wave.
 *
 * @param _spec - The spec.
 * @param _element - The element.
 * @param _ctx - The ctx.
 * @example
 * ```ts
 * mountPanel();
 * ```
 */
export function mountPanel(_spec: PanelSpec, _element: HTMLElement, _ctx: PanelsCtx): MountedPanel {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `runFromPanel`; implemented in its wave.
 *
 * @param _ctx - The ctx.
 * @param _id - The id.
 * @param _input - The input.
 * @param _origin - The origin.
 * @example
 * ```ts
 * runFromPanel();
 * ```
 */
export function runFromPanel(
  _ctx: PanelsCtx,
  _id: string,
  _input: Json | undefined,
  _origin: PanelRunOrigin
): Promise<RunResult> {
  throw new Error("not implemented");
}
