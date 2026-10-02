/**
 * @file registry plugin — api factory: manifest, source, command, add, envelope, clock.
 */
import type { RegistryApi, RegistryCtx } from "./types";

/**
 * Creates the registry api.
 *
 * @param _ctx - Domain context of the registry.
 * @example
 * ```ts
 * const registry = createRegistryApi(ctx);
 * registry.manifest().commands.length; // 13 door commands + module + editor commands
 * ```
 */
export function createRegistryApi(_ctx: RegistryCtx): RegistryApi {
  throw new Error("not implemented");
}
