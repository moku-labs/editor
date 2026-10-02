/**
 * @file registry plugin — state factory.
 */
import type { RegistryConfig, RegistryState } from "./types";

/**
 * Creates the initial registry state: empty maps and no manifest.
 *
 * @param _ctx - Minimal context.
 * @param _ctx.config - Resolved plugin config.
 * @example
 * ```ts
 * const state = createRegistryState({ config: { game: undefined, modules: [], name: undefined } });
 * ```
 */
export function createRegistryState(_ctx: {
  readonly config: Readonly<RegistryConfig>;
}): RegistryState {
  throw new Error("not implemented");
}
