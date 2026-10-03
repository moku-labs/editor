/**
 * @file registry plugin — api factory: manifest, source, command, add, envelope, clock.
 */
import { addEditorCommand, requireGame } from "./catalogue";
import { clockOf, envelopeOf } from "./entries/envelope";
import { currentManifest } from "./manifest";
import type { RegistryApi, RegistryCtx } from "./types";

/**
 * Creates the registry api. Every method reads `ctx.state` at call time, so the catalogue that
 * onInit builds is what the api sees.
 *
 * @param ctx - Domain context of the registry.
 * @returns The registry api.
 */
export function createRegistryApi(ctx: RegistryCtx): RegistryApi {
  return {
    manifest: () => currentManifest(ctx.state, ctx.config),
    source: id => ctx.state.sources.get(id),
    command: id => ctx.state.commands.get(id),
    add: entry => {
      addEditorCommand(ctx.state, entry);
    },
    envelope: () => envelopeOf(requireGame(ctx.config)),
    clock: () => clockOf(requireGame(ctx.config))
  };
}
