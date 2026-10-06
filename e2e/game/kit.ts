/**
 * @file The authoring helpers of the tiny e2e game, bound to its types once. The asset key is the
 * one font of `manifest.json`; the game has no strings of its own.
 */
import { defineGame } from "@moku-labs/game";
import type { Player, Session } from "./state";

/** The one asset of the game: the body font the engine ships, copied in by e2e/prepare-game.ts. */
export type AssetKey = "tiny.font-body";

/** Every text style the game draws with: the two of the engine and the three of its feature. */
export type TextStyleKey = "body" | "digits" | "tiny.title" | "tiny.button" | "tiny.score";

/**
 * The authoring helpers of the tiny game (`defineGame` bound to its player, session, assets and
 * text styles): nodes, the flow, the feature, its projections, bundles, scenes and styles.
 *
 * @example
 * ```ts
 * const home = defineNode({ outcomes: { play: type() }, rest: true, checkpoint: true });
 * ```
 */
export const {
  defineNode,
  defineFlow,
  defineFeature,
  projection,
  defineBundles,
  defineScene,
  defineTextStyles,
  defineStyle
} = defineGame<{
  player: Player;
  session: Session;
  assets: AssetKey;
  bundles: "tiny";
  scenes: "home" | "level";
  strings: Record<string, never>;
  textStyles: TextStyleKey;
}>();
