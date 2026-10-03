/**
 * @file renderView plugin — derive.ts (skeleton stubs, implemented in its wave).
 */
import type { SceneSnapshot } from "../gameView/types";
import type {
  AssetsUsage,
  ReleaseEntry,
  RenderSnapshot,
  RenderViewConfig,
  RenderViewState
} from "./types";

/**
 * Skeleton stub for `deriveSnapshot`; implemented in its wave.
 *
 * @param _state - The state.
 * @param _config - The config.
 * @example
 * ```ts
 * deriveSnapshot();
 * ```
 */
export function deriveSnapshot(
  _state: RenderViewState,
  _config: Readonly<RenderViewConfig>
): RenderSnapshot {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `updateTextureUse`; implemented in its wave.
 *
 * @param _state - The state.
 * @param _scene - The scene.
 * @example
 * ```ts
 * updateTextureUse();
 * ```
 */
export function updateTextureUse(_state: RenderViewState, _scene: SceneSnapshot): void {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `releasesOf`; implemented in its wave.
 *
 * @param _previous - The previous.
 * @param _next - The next.
 * @param _frame - The frame.
 * @example
 * ```ts
 * releasesOf();
 * ```
 */
export function releasesOf(
  _previous: ReadonlyMap<string, { tier: string; mb: number }>,
  _next: AssetsUsage,
  _frame: number
): readonly ReleaseEntry[] {
  throw new Error("not implemented");
}
