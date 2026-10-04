/**
 * @file registry plugin — state factory.
 */
import type { RegistryState } from "./types";

/**
 * Creates the initial registry state: empty maps and no manifest.
 *
 * @returns Fresh maps for sources, commands, origins, unavailable sources and probes, and
 *   `manifest: undefined`.
 */
export function createRegistryState(): RegistryState {
  return {
    sources: new Map(),
    commands: new Map(),
    origins: new Map(),
    manifest: undefined,
    unavailable: new Map(),
    probes: new Map()
  };
}
