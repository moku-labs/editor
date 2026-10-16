/**
 * @file renderView derive — the sparkline cards' numbers and tags (spec 09 § M9): FPS, frame
 * time, draw calls, textures, GPU passes; waiting shows dashes, never zeros. Pure. Typed stub
 * of build wave 0 (spec 09 § M17, RV0): the signatures are the contract the other Mission
 * control units build against; build wave 3 (RV3) writes the bodies.
 */
import { notBuilt } from "../stub";

/**
 * The tag colour of a card's headline.
 *
 * @example
 * ```ts
 * const tag: CardTag = "warn"; // FPS below the display rate
 * ```
 */
export type CardTag = "ok" | "warn" | "muted";

/**
 * The FPS card's tag: warn below the display rate, ok at it, muted while waiting.
 *
 * @param _fps - The view's fps; null while waiting.
 * @param _displayHz - The display's rate.
 * @returns The tag.
 * @throws {Error} Until build wave 3: "renderView derive/fpsTag is not built yet".
 */
export function fpsTag(_fps: number | null, _displayHz: number | null): CardTag {
  return notBuilt("derive/fpsTag", 3);
}
