/**
 * @file registry plugin — api factory: manifest, source, command, add, envelope, clock, game, build.
 */
import { addEditorCommand, addEditorSource, requireGame } from "./catalogue";
import { clockOf, envelopeOf } from "./entries/envelope";
import { buildOf, currentManifest } from "./manifest";
import type { RegistryApi, RegistryCtx } from "./types";

/**
 * Creates the registry api. Every method reads `ctx.state` at call time, so the catalogue that
 * onInit builds is what the api sees. `add` tells a source (it has `read`) from a command.
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
      if ("read" in entry) addEditorSource(ctx.state, entry, ctx.log);
      else addEditorCommand(ctx.state, entry, ctx);
    },
    envelope: () => envelopeOf(requireGame(ctx.config)),
    clock: () => clockOf(requireGame(ctx.config)),
    game: () => requireGame(ctx.config),
    build: () => buildOf(ctx.state)
  };
}
