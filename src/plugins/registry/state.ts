/**
 * @file registry plugin — state factory.
 */
import type { RegistryState } from "./types";

/**
 * Creates the initial registry state: empty maps and no manifest.
 *
 * @returns Fresh maps for sources, commands and origins, and `manifest: undefined`.
 * @example
 * ```ts
 * const state = createRegistryState();
 * state.sources.size; // 0
 * ```
 */
export function createRegistryState(): RegistryState {
  return { sources: new Map(), commands: new Map(), origins: new Map(), manifest: undefined };
}
