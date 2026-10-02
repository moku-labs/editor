/**
 * @file workspace plugin — prefs/theme.ts (skeleton stubs, implemented in its wave).
 */
import type { Theme } from "../types";

/**
 * Skeleton stub for `effectiveTheme`; implemented in its wave.
 *
 * @param _theme - The theme.
 * @param _theme.chosen - The chosen.
 * @param _theme.os - The os.
 * @example
 * ```ts
 * effectiveTheme();
 * ```
 */
export function effectiveTheme(_theme: {
  readonly chosen: Theme | undefined;
  readonly os: Theme;
}): Theme {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `applyTheme`; implemented in its wave.
 *
 * @param _theme - The theme.
 * @param _root - The root.
 * @example
 * ```ts
 * applyTheme();
 * ```
 */
export function applyTheme(_theme: Theme, _root: HTMLElement): void {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `watchOsTheme`; implemented in its wave.
 *
 * @param _onChange - The onChange.
 * @example
 * ```ts
 * watchOsTheme();
 * ```
 */
export function watchOsTheme(_onChange: (theme: Theme) => void): () => void {
  throw new Error("not implemented");
}
