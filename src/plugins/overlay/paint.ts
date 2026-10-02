/**
 * @file overlay plugin — paint.ts (skeleton stubs, implemented in its wave).
 */
import type { Json } from "../registry/protocol";
import type {
  Config,
  OverlayCtx,
  OverlayState,
  OverlayView,
  RenderChip,
  RenderNumbers
} from "./types";

/**
 * Skeleton stub for `paint`; implemented in its wave.
 *
 * @param _octx - The octx.
 * @example
 * ```ts
 * paint();
 * ```
 */
export function paint(_octx: OverlayCtx): void {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `viewOf`; implemented in its wave.
 *
 * @param _state - The state.
 * @param _config - The config.
 * @param _now - The now.
 * @example
 * ```ts
 * viewOf();
 * ```
 */
export function viewOf(_state: OverlayState, _config: Readonly<Config>, _now: number): OverlayView {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `renderChips`; implemented in its wave.
 *
 * @param _numbers - The numbers.
 * @param _unavailable - The unavailable.
 * @example
 * ```ts
 * renderChips();
 * ```
 */
export function renderChips(
  _numbers: RenderNumbers | undefined,
  _unavailable: boolean
): readonly RenderChip[] {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `toRenderNumbers`; implemented in its wave.
 *
 * @param _value - The value.
 * @example
 * ```ts
 * toRenderNumbers();
 * ```
 */
export function toRenderNumbers(_value: Json): RenderNumbers | undefined {
  throw new Error("not implemented");
}
