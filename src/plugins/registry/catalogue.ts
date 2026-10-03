/**
 * @file registry plugin — the onInit body: validates the config, then adds every door source and
 * command and every module entry, in catalogue order; `add` for editor commands. Throws on a
 * duplicate or invalid id.
 */
import type { Log } from "@moku-labs/common/browser";
import { commands } from "@moku-labs/game/control";
import { sources } from "@moku-labs/game/inspect";
import { commandEntry, guardEntry } from "./entries/command-entry";
import { sourceEntry } from "./entries/source-entry";
import { checkDescriptor } from "./entries/validate";
import type {
  CommandEntry,
  DoorCommand,
  DoorSource,
  GameLike,
  RegistryConfig,
  RegistryCtx,
  RegistryState
} from "./types";

/**
 * Where an entry came from.
 */
type Origin = "door" | "module" | "editor";

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
 * Checks and adds the door or module sources.
 *
 * @param ctx - Domain context of the registry.
 * @param ctx.state - Registry state.
 * @param ctx.log - The registry log, handed to every entry.
 * @param game - The game app.
 * @param doors - The sources.
 * @param origin - "door" or "module".
 */
function addSources(
  ctx: { readonly state: RegistryState; readonly log: Log.LogApi },
  game: GameLike,
  doors: readonly DoorSource[],
  origin: Origin
): void {
  for (const door of doors) {
    checkDescriptor("source", door);
    claim(ctx.state, door.id, origin);
    ctx.state.sources.set(door.id, sourceEntry(game, door, ctx.log));
  }
}

/**
 * Checks and adds the door or module commands (any effect, cheat and raw included).
 *
 * @param ctx - Domain context of the registry.
 * @param ctx.state - Registry state.
 * @param ctx.log - The registry log, handed to every entry.
 * @param game - The game app.
 * @param doors - The commands.
 * @param origin - "door" or "module".
 */
function addCommands(
  ctx: { readonly state: RegistryState; readonly log: Log.LogApi },
  game: GameLike,
  doors: readonly DoorCommand[],
  origin: Origin
): void {
  for (const door of doors) {
    checkDescriptor("command", door);
    claim(ctx.state, door.id, origin);
    ctx.state.commands.set(door.id, commandEntry(game, door, ctx.log));
  }
}

/**
 * Validates config and builds the catalogue into state: door entries, then modules in config
 * order, then the editor commands already added, in add order.
 *
 * @param ctx - Domain context of the registry.
 * @throws {Error} The missing-game, not-an-app, duplicate-id and descriptor errors.
 */
export function buildCatalogue(ctx: RegistryCtx): void {
  const game = requireGame(ctx.config);

  if (!isGameApp(game)) {
    throw new Error(
      "[moku-editor] registry.game is not a game app.\n  Pass the object createApp returned, not a promise or a config."
    );
  }

  const { state } = ctx;
  const editor = [...state.commands].filter(([id]) => state.origins.get(id) === "editor");

  state.sources.clear();
  state.commands.clear();
  state.origins.clear();
  state.manifest = undefined;

  addSources(ctx, game, Object.values(sources), "door");
  addCommands(ctx, game, Object.values(commands), "door");

  for (const module of ctx.config.modules) {
    addSources(ctx, game, module.sources ?? [], "module");
    addCommands(ctx, game, module.commands ?? [], "module");
  }

  for (const [id, entry] of editor) {
    claim(state, id, "editor");
    state.commands.set(id, entry);
  }
}

/**
 * Adds an editor-owned command: a dotted unused id, known input kinds, and no `cheat` or `raw`
 * effect (editor commands bypass the game's journal). Stores the guarded copy and drops the
 * manifest cache.
 *
 * @param state - Registry state.
 * @param entry - The editor command.
 * @throws {Error} The invalid-id, duplicate-id, effect and input-kind errors.
 */
export function addEditorCommand(state: RegistryState, entry: CommandEntry): void {
  const { id, effect } = entry.descriptor;

  checkDescriptor("command", entry.descriptor);

  if (effect === "cheat" || effect === "raw") {
    throw new Error(
      `[moku-editor] Editor command "${id}" cannot have effect "${effect}".\n  Cheat and raw commands taint the session; define them in the game's .dev module.`
    );
  }

  claim(state, id, "editor");
  state.commands.set(id, guardEntry(entry));
}
