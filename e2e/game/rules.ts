/**
 * @file The one rule of the tiny e2e game, pure: a tap on the level scores a point. A logic
 * module, so a save of it reloads the game page (e2e/top-bar.spec.ts saves it).
 */

/**
 * The score after one more tap.
 *
 * @param score - The score so far.
 * @returns The new score.
 * @example
 * ```ts
 * addPoint(2); // 3
 * ```
 */
export function addPoint(score: number): number {
  return score + 1;
}
