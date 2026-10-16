/**
 * @file registry plugin — state factory.
 */
import type { RegistryState } from "./types";

/**
 * Creates the initial registry state: empty maps, no manifest and no build read yet.
 *
 * @returns Fresh maps for sources, commands, origins, unavailable sources and probes, and
 *   `manifest: undefined`, `build: undefined`.
 */
export function createRegistryState(): RegistryState {
  return {
    sources: new Map(),
    commands: new Map(),
    origins: new Map(),
    manifest: undefined,
    unavailable: new Map(),
    probes: new Map(),
    build: undefined
  };
}
