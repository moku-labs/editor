/**
 * @file registry plugin — type definitions: config, the erased door types, the closure-erased
 * entries, state, api and the domain context.
 */
import type { Log } from "@moku-labs/common/browser";
import type { Model } from "@moku-labs/game";
import type { HeadlessApp } from "@moku-labs/game/testing";
import type {
  Changes,
  CommandDescriptor,
  Effect,
  InputOf,
  InputSchema,
  Json,
  Manifest,
  RunResult,
  RunState,
  SourceDescriptor
} from "./protocol";

/**
 * Registry ids: camelCase words joined by dots, the pattern the game's defineCommand uses.
 */
export const ID_PATTERN = /^[a-z][\dA-Za-z]*(?:\.[a-z][\dA-Za-z]*)+$/;

/**
 * What the doors need of an app: the headless app plus the committed model (the game's WatchApp).
 */
export type GameLike = HeadlessApp & {
  readonly model: { readonly store: { snapshot(): Model.Snapshot } };
};

/**
 * Any door source with its generics erased. Method syntax on purpose: parameters compare
 * bivariantly, so every `Source<S, O, App>` with `App ⊇ HeadlessApp` fits without a cast.
 */
export type DoorSource = {
  readonly id: string;
  readonly title: string;
  readonly input: InputSchema;
  readonly changes: Changes;
  read(app: HeadlessApp, input: InputOf<InputSchema>): unknown;
};

/**
 * Any door command with its generics erased (method syntax, see DoorSource).
 */
export type DoorCommand = {
  readonly id: string;
  readonly title: string;
  readonly input: InputSchema;
  readonly effect: Effect;
  run(app: HeadlessApp, input: InputOf<InputSchema>): unknown;
};

/**
 * A game's `.dev` module: extra sources and commands, merged after the door catalogue.
 *
 * @example
 * ```ts
 * const mergeDev: DevModule = { commands: [addCoins, refillEnergy] };
 * ```
 */
export type DevModule = {
  readonly sources?: readonly DoorSource[];
  readonly commands?: readonly DoorCommand[];
};

/**
 * Registry configuration.
 *
 * @example
 * ```ts
 * createApp({ pluginConfigs: { registry: { game: app, modules: [mergeDev], name: "merge-game 0.0.0" } } });
 * ```
 */
export type RegistryConfig = {
  /** The running game app. Required: onInit throws when it is undefined. */
  game: GameLike | undefined;
  /** The game's dev modules: extra sources and commands, merged after the door catalogue. */
  modules: readonly DevModule[];
  /** Display name for Manifest.game; falls back to document.title, then "game" (R6). */
  name: string | undefined;
};

/**
 * A closure-erased source: raw Json in, wire-safe Json out.
 */
export type SourceEntry = {
  readonly descriptor: SourceDescriptor;
  read(raw: Json): Json;
  watch(raw: Json, fn: (value: Json) => void): () => void;
};

/**
 * A closure-erased command: raw Json in, RunResult out.
 */
export type CommandEntry = {
  readonly descriptor: CommandDescriptor;
  run(raw: Json): Promise<RunResult>;
};

/**
 * The game clock, in the shape the channel heartbeat needs (R6).
 */
export type Clock = { readonly frame: number; readonly paused: boolean };

/**
 * Registry state: entries by id in manifest order, one id namespace, the manifest cache.
 */
export type RegistryState = {
  sources: Map<string, SourceEntry>;
  commands: Map<string, CommandEntry>;
  origins: Map<string, "door" | "module" | "editor">;
  manifest: Manifest | undefined;
};

/**
 * The registry api (`app.registry`, `ctx.require(registryPlugin)`).
 *
 * @example
 * ```ts
 * await registry.command("game.step")?.run({ frames: 1 });
 * ```
 */
export type RegistryApi = {
  /** The frozen manifest: descriptors only, no functions. */
  manifest(): Manifest;
  /** A source entry, or undefined for an unknown id. */
  source(id: string): SourceEntry | undefined;
  /** A command entry (door, module or editor), or undefined. */
  command(id: string): CommandEntry | undefined;
  /** Adds an editor-owned command (call it in onInit). */
  add(entry: CommandEntry): void;
  /** Where the game stands now, for editor commands that run no door (R2, R6). */
  envelope(): RunState;
  /** The frame and the pause flag of the game clock (R6). */
  clock(): Clock;
};

/**
 * Domain context of the registry: the kernel context is assignable to it.
 */
export type RegistryCtx = {
  readonly config: Readonly<RegistryConfig>;
  state: RegistryState;
  readonly log: Log.LogApi;
};
