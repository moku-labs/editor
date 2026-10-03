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
 * @example
 * ```ts
 * const registry = createRegistryApi(ctx);
 * registry.manifest().commands.length; // 14 door commands + module + editor commands
 * ```
 */
export function createRegistryApi(ctx: RegistryCtx): RegistryApi {
  return {
    /**
     * The frozen manifest: descriptors only (cached until the next add); game, page and embedded
     * computed at call time. `panels` is omitted (reserved).
     *
     * @returns The manifest the bridge sends in `hello`.
     * @example
     * ```ts
     * registry.manifest().commands.length; // 14 door commands + module + editor commands
     * ```
     */
    manifest: () => currentManifest(ctx.state, ctx.config),
    /**
     * Looks up a source entry; callers map undefined to -32601 `unknown_id`.
     *
     * @param id - The source id, e.g. "game.history".
     * @returns The entry, or undefined for an unknown id.
     * @example
     * ```ts
     * registry.source("game.history")?.read({ last: 1 }); // [{ path: "home", outcome: "play", … }]
     * ```
     */
    source: id => ctx.state.sources.get(id),
    /**
     * Looks up a command entry (door, module or editor).
     *
     * @param id - The command id, e.g. "game.step".
     * @returns The entry, or undefined for an unknown id.
     * @example
     * ```ts
     * await registry.command("game.step")?.run({ frames: 1 }); // { value: { frame: 1841, … }, state: { … } }
     * ```
     */
    command: id => ctx.state.commands.get(id),
    /**
     * Adds an editor-owned command; call it in onInit (the tools page sees a later add only on
     * the next bridge hello). Refuses a bad or used id, an unknown kind and `cheat`/`raw`.
     *
     * @param entry - The editor command: its descriptor and its run.
     * @example
     * ```ts
     * registry.add({
     *   descriptor: { id: "editor.overlay", title: "Overlay in game", input: { on: "boolean" }, effect: "cosmetic" },
     *   run: async raw => ({ value: checkInput({ on: "boolean" }, raw).on, state: registry.envelope() })
     * });
     * ```
     */
    add: entry => {
      addEditorCommand(ctx.state, entry);
    },
    /**
     * Where the game stands now, for editor commands that run no door (R2, R6).
     *
     * @returns `{ path, frame, tainted }` from game.position, the clock and game.tainted.
     * @example
     * ```ts
     * registry.envelope(); // { path: "board/awaitIntent", frame: 1840, tainted: false }
     * ```
     */
    envelope: () => envelopeOf(requireGame(ctx.config)),
    /**
     * The frame and the pause flag of the game clock (R6); the channel heartbeat reads it.
     *
     * @returns `{ frame, paused }`.
     * @example
     * ```ts
     * registry.clock(); // { frame: 1840, paused: false }
     * ```
     */
    clock: () => clockOf(requireGame(ctx.config))
  };
}
