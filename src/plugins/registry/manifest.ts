/**
 * @file registry plugin — the manifest: descriptors only, page and embedded computed at call time.
 */
import type { Manifest } from "./protocol";
import type { RegistryConfig, RegistryState } from "./types";

/**
 * Builds the frozen manifest from the entries (fresh frozen descriptors, never door objects).
 *
 * @param _state - Registry state.
 * @param _name - Display name of the game.
 * @example
 * ```ts
 * const manifest = buildManifest(state, "merge-game 0.0.0");
 * ```
 */
export function buildManifest(_state: RegistryState, _name: string): Manifest {
  throw new Error("not implemented");
}

/**
 * The page URL (cut to 2048 characters) and whether the page runs inside the tools page frame.
 *
 * @example
 * ```ts
 * pageInfo(); // { page: "", embedded: false } in Bun
 * ```
 */
export function pageInfo(): { page: string; embedded: boolean } {
  throw new Error("not implemented");
}

/**
 * The display name: config.name, else document.title, else "game".
 *
 * @param _config - Resolved registry config.
 * @example
 * ```ts
 * gameName({ game, modules: [], name: "merge-game 0.0.0" }); // "merge-game 0.0.0"
 * ```
 */
export function gameName(_config: Readonly<RegistryConfig>): string {
  throw new Error("not implemented");
}
