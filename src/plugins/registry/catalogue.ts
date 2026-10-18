/**
 * @file registry plugin — the onInit body: validates the config, then adds every door source and
 * command, every module entry and the overlay toggles source, in catalogue order; `add` for editor
 * commands and sources. Every command entry emits `registry:command`. Throws on a duplicate or
 * invalid id.
 */
import type { Log } from "@moku-labs/common/browser";
import { commands } from "@moku-labs/game/control";
import { sources } from "@moku-labs/game/inspect";
import { commandEntry, guardEntry } from "./entries/command-entry";
import { editorProbeOf, guardSource } from "./entries/editor-source";
import { probeOf } from "./entries/probe";
import { withRunEvent } from "./entries/run-event";
import { sourceEntry } from "./entries/source-entry";
import { togglesSource } from "./entries/toggles";
import { checkDescriptor } from "./entries/validate";
import type {
  CommandEntry,
  DoorCommand,
  DoorSource,
  GameLike,
  Origin,
  RegistryConfig,
  RegistryCtx,
  RegistryState,
  SourceEntry
} from "./types";

/**
 * What the run event of a command entry needs: the registry's emit and log.
 */
type RunEvents = Pick<RegistryCtx, "emit" | "log">;

/**
 * The configured game, or the missing-game error.
 *
 * @param config - Resolved registry config.
 * @returns The game app.
 * @throws {Error} `[moku-editor] registry.game is missing.` when it is undefined.
 */
export function requireGame(config: Readonly<RegistryConfig>): GameLike {
  if (config.game !== undefined) return config.game;

  throw new Error(
    "[moku-editor] registry.game is missing.\n  Pass pluginConfigs.registry.game: the app your game made with createApp."
  );
}

/**
 * True when the value has what the doors call on every frame: time and the flow state.
 *
 * @param game - The configured game (anything at run time).
 * @returns Whether it is a game app.
 * @example
 * ```ts
 * isGameApp(Promise.resolve(app)); // false
 * ```
 */
function isGameApp(game: GameLike): boolean {
  const time = game?.time;

  return (
    typeof time?.snapshot === "function" &&
    typeof time.onFrame === "function" &&
    typeof time.isPaused === "function" &&
    typeof game.flow?.state === "function"
  );
}

/**
 * Claims an id in the one namespace of sources and commands.
 *
 * @param state - Registry state.
 * @param id - The id.
 * @param origin - Where the entry came from.
 * @throws {Error} `[moku-editor] Duplicate registry id …` when it is taken.
 */
function claim(state: RegistryState, id: string, origin: Origin): void {
  if (state.origins.has(id)) {
    throw new Error(
      `[moku-editor] Duplicate registry id "${id}".\n  Each source and command id must be unique; rename one of them.`
    );
  }

  state.origins.set(id, origin);
  state.manifest = undefined;
}

/**
 * Checks and adds the door, module or registry sources. Each door source also gets its probe
 * (module and registry sources are never probed).
 *
 * @param ctx - Domain context of the registry.
 * @param ctx.state - Registry state.
 * @param ctx.log - The registry log, handed to every entry.
 * @param game - The game app.
 * @param doors - The sources.
 * @param origin - "door", "module" or "registry".
 */
function addSources(
  ctx: { readonly state: RegistryState; readonly log: Log.LogApi },
  game: GameLike,
  doors: readonly DoorSource[],
  origin: Origin
): void {
  const { state, log } = ctx;

  for (const door of doors) {
    checkDescriptor("source", door);
    claim(state, door.id, origin);
    state.sources.set(door.id, sourceEntry(game, door, log, state.unavailable));
    if (origin === "door") state.probes.set(door.id, probeOf(game, door, log, state.unavailable));
  }
}

/**
 * Checks and adds the door or module commands (any effect, cheat and raw included), each wrapped
 * so its runs emit `registry:command`.
 *
 * @param ctx - Domain context of the registry.
 * @param game - The game app.
 * @param doors - The commands.
 * @param origin - "door" or "module".
 */
function addCommands(
  ctx: RegistryCtx,
  game: GameLike,
  doors: readonly DoorCommand[],
  origin: Origin
): void {
  for (const door of doors) {
    checkDescriptor("command", door);
    claim(ctx.state, door.id, origin);
    ctx.state.commands.set(
      door.id,
      withRunEvent(commandEntry(game, door, ctx.log), ctx.emit, ctx.log)
    );
  }
}

/**
 * Adds the registry source `editor.toggles` when the door and module commands hold at least one
 * overlay toggle (an entry with `value()`); a game without toggles keeps its manifest unchanged.
 *
 * @param ctx - Domain context of the registry.
 * @param game - The game app.
 */
function addToggles(ctx: RegistryCtx, game: GameLike): void {
  const toggles = [...ctx.state.commands.values()].filter(entry => entry.value !== undefined);

  if (toggles.length > 0) addSources(ctx, game, [togglesSource(toggles)], "registry");
}

/**
 * The editor entries of the state (sources, their probes, commands), in add order: a rebuild keeps
 * them, while door, module and registry entries are built again.
 *
 * @param state - Registry state.
 * @returns The kept entries.
 */
function editorEntriesOf(state: RegistryState): {
  readonly sources: readonly (readonly [string, SourceEntry])[];
  readonly probes: readonly (readonly [string, () => void])[];
  readonly commands: readonly (readonly [string, CommandEntry])[];
} {
  const isEditor = ([id]: readonly [string, unknown]): boolean =>
    state.origins.get(id) === "editor";

  return {
    sources: [...state.sources].filter(entry => isEditor(entry)),
    probes: [...state.probes].filter(entry => isEditor(entry)),
    commands: [...state.commands].filter(entry => isEditor(entry))
  };
}

/**
 * Validates config and builds the catalogue into state: door entries, then modules in config
 * order, then `editor.toggles` when the game has toggles, then the editor sources and commands
 * already added, in add order (with their probes).
 *
 * @param ctx - Domain context of the registry.
 * @throws {Error} The missing-game, not-an-app, duplicate-id and descriptor errors; a `TypeError`
 *   for an unknown overlay marker or a toggle without value(app).
 */
export function buildCatalogue(ctx: RegistryCtx): void {
  const game = requireGame(ctx.config);

  if (!isGameApp(game)) {
    throw new Error(
      "[moku-editor] registry.game is not a game app.\n  Pass the object createApp returned, not a promise or a config."
    );
  }

  const { state } = ctx;
  const editor = editorEntriesOf(state);

  state.sources.clear();
  state.commands.clear();
  state.origins.clear();
  state.unavailable.clear();
  state.probes.clear();
  state.manifest = undefined;

  addSources(ctx, game, Object.values(sources), "door");
  addCommands(ctx, game, Object.values(commands), "door");

  for (const module of ctx.config.modules) {
    addSources(ctx, game, module.sources ?? [], "module");
    addCommands(ctx, game, module.commands ?? [], "module");
  }

  addToggles(ctx, game);

  for (const [id, entry] of editor.sources) {
    claim(state, id, "editor");
    state.sources.set(id, entry);
  }
  for (const [id, probe] of editor.probes) state.probes.set(id, probe);
  for (const [id, entry] of editor.commands) {
    claim(state, id, "editor");
    state.commands.set(id, entry);
  }
}

/**
 * Adds an editor-owned command: no overlay marker (the overlay lists only the game's commands), a
 * dotted unused id, known input kinds, and no `cheat` or `raw` effect (editor commands bypass the
 * game's journal). Stores the guarded copy, wrapped so its runs emit `registry:command`, and drops
 * the manifest cache.
 *
 * @param state - Registry state.
 * @param entry - The editor command.
 * @param events - The registry's emit and log, for the run event.
 * @throws {Error} The invalid-id, duplicate-id, effect and input-kind errors; a `TypeError` for an
 *   overlay marker.
 */
export function addEditorCommand(
  state: RegistryState,
  entry: CommandEntry,
  events: RunEvents
): void {
  const { id, effect } = entry.descriptor;

  if (entry.descriptor.overlay !== undefined) {
    throw new TypeError(
      `[moku-editor] Editor command "${id}" cannot set overlay.\n  The overlay lists only the game's commands.`
    );
  }

  checkDescriptor("command", entry.descriptor);

  if (effect === "cheat" || effect === "raw") {
    throw new Error(
      `[moku-editor] Editor command "${id}" cannot have effect "${effect}".\n  Cheat and raw commands taint the session; define them in the game's .dev module.`
    );
  }

  claim(state, id, "editor");
  state.commands.set(id, withRunEvent(guardEntry(entry), events.emit, events.log));
}

/**
 * Adds an editor-owned source: a dotted unused id, known input kinds and changes key. Stores the
 * guarded copy and, when the entry gives a probe, the probe the manifest build runs; drops the
 * manifest cache.
 *
 * @param state - Registry state.
 * @param entry - The editor source.
 * @param log - The registry log.
 * @throws {Error} The invalid-id, duplicate-id, input-kind and changes errors.
 */
export function addEditorSource(state: RegistryState, entry: SourceEntry, log: Log.LogApi): void {
  const { id } = entry.descriptor;

  checkDescriptor("source", entry.descriptor);
  claim(state, id, "editor");
  state.sources.set(id, guardSource(entry, log, state.unavailable));
  if (entry.probe !== undefined) state.probes.set(id, editorProbeOf(entry, log, state.unavailable));
}
