/**
 * @file registry plugin — the onInit body: validates the config, then adds every door source and
 * command and every module entry, in catalogue order. Throws on a duplicate or invalid id.
 */
import type { RegistryCtx } from "./types";

/**
 * Validates config and builds the catalogue into state (door entries, then modules).
 *
 * @param _ctx - Domain context of the registry.
 * @example
 * ```ts
 * createAgentPlugin("registry", { onInit: buildCatalogue });
 * ```
 */
export function buildCatalogue(_ctx: RegistryCtx): void {
  throw new Error("not implemented");
}
