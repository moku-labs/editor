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
 * What the doors need of an app: the headless app plus the committed model (the game's WatchApp),
 * and the pause stack when the game has one. `lifecycle` is optional: `HeadlessApp` has no such
 * member and the engine exports no type for it.
 */
export type GameLike = HeadlessApp & {
  readonly model: { readonly store: { snapshot(): Model.Snapshot } };
  /** The game's pause stack: the reasons why the clock stands, in push order. */
  readonly lifecycle?: { reasons(): readonly string[] };
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
 * The game clock and why it stands. The channel heartbeat sends `frame` and `paused` only (R6);
 * the reload checkpoints read `held`.
 *
 * @example
 * ```ts
 * // The game tab is hidden: the clock stands, but nobody paused the game.
 * const hidden: Clock = { frame: 1840, paused: true, held: false, reasons: ["background"] };
 * // The developer paused it in the editor, in a hidden tab.
 * const kept: Clock = { frame: 1840, paused: true, held: true, reasons: ["background", "devtools"] };
 * ```
 */
export type Clock = {
  /** The frame of the game clock. */
  readonly frame: number;
  /** True while the clock does not run, for any pause reason. */
  readonly paused: boolean;
  /**
   * True while the developer holds the pause: the reasons include `"devtools"`, the one `game.pause`
   * pushes. A game without `lifecycle.reasons` answers `paused` here.
   */
  readonly held: boolean;
  /** A copy of `game.lifecycle.reasons()`, in push order; empty for a game without it. */
  readonly reasons: readonly string[];
};

/**
 * Registry state: entries by id in manifest order, one id namespace, the manifest cache, and the
 * door sources the game does not have.
 */
export type RegistryState = {
  sources: Map<string, SourceEntry>;
  commands: Map<string, CommandEntry>;
  origins: Map<string, "door" | "module" | "editor">;
  manifest: Manifest | undefined;
  /** Door sources whose probe threw: id to the reason. Their reads and watches answer -32008. */
  unavailable: Map<string, string>;
  /** The probe of each door source, run each time the manifest is built. */
  probes: Map<string, () => void>;
};

/**
 * The registry api (`app.registry`, `ctx.require(registryPlugin)`): the catalogue of every source
 * and command the editor can read, watch or run.
 */
export type RegistryApi = {
  /**
   * The frozen manifest: descriptors only, no functions. Cached until the next `add`; `game`,
   * `page` and `embedded` are computed at call time. `panels` is omitted (reserved). Each build
   * probes the door sources first: one the game does not have is listed with `available: false`
   * and its `reason`.
   *
   * @returns The manifest the bridge sends in `hello`.
   * @example
   * ```ts
   * // The merge game without dev modules: its door catalogue only.
   * app.registry.manifest().sources.length; // 15
   * app.registry.manifest().commands.length; // 14
   * // A game without the effects plugin:
   * app.registry.manifest().sources.find(source => source.id === "game.effects")?.available; // false
   * ```
   */
  manifest(): Manifest;
  /**
   * Looks up a source entry. Callers map `undefined` to the -32601 `unknown_id` error.
   *
   * @param id - The source id, e.g. "game.position".
   * @returns The entry, or undefined for an unknown id or a command id.
   * @example
   * ```ts
   * // null is the wire value of "no input".
   * app.registry.source("game.position")?.read(null); // { path: "home", … }
   * app.registry.source("game.step"); // undefined: a command, not a source
   * ```
   */
  source(id: string): SourceEntry | undefined;
  /**
   * Looks up a command entry: door, module or editor.
   *
   * @param id - The command id, e.g. "game.step".
   * @returns The entry, or undefined for an unknown id or a source id.
   * @example
   * ```ts
   * // Step two frames; the result carries where the game stands after the run.
   * (await app.registry.command("game.step")?.run({ frames: 2 }))?.state; // { path: "home", frame: 1842, tainted: false }
   * ```
   */
  command(id: string): CommandEntry | undefined;
  /**
   * Adds an editor-owned command. Call it in `onInit`: the tools page sees a later add only on
   * the next bridge hello. Drops the manifest cache.
   *
   * @param entry - The editor command: its descriptor and its run.
   * @throws {Error} For an invalid or used id, an unknown input kind, or a `cheat` or `raw` effect
   *   (editor commands bypass the game's journal).
   * @example
   * ```ts
   * // An editor plugin registers its command from its own onInit.
   * const registry = ctx.require(registryPlugin);
   * registry.add({
   *   descriptor: { id: "editor.ping", title: "Ping", input: {}, effect: "read" },
   *   run: async () => ({ value: "pong", state: registry.envelope() })
   * });
   * ```
   */
  add(entry: CommandEntry): void;
  /**
   * Where the game stands now, for editor commands that run no door (R2, R6).
   *
   * @returns `{ path, frame, tainted }` from game.position, the clock and game.tainted.
   * @throws {Error} `[moku-editor] registry.game is missing.` when no game is configured.
   * @example
   * ```ts
   * app.registry.envelope(); // { path: "home", frame: 1840, tainted: false }
   * await app.registry.command("merge.addCoins")?.run({ amount: 1 });
   * app.registry.envelope().tainted; // true: a cheat ran
   * ```
   */
  envelope(): RunState;
  /**
   * The game clock and why it stands (R6). `paused` is true for any pause reason; `held` only
   * while the reasons include `"devtools"`, the pause of `game.pause`. The channel heartbeat reads
   * `frame` and `paused`; a reload checkpoint reads `held`, so a hidden tab's `"background"` pause
   * is not restored. A game without `lifecycle.reasons` answers `reasons: []` and `held` equal to
   * `paused`.
   *
   * @returns `{ frame, paused, held, reasons }`; `reasons` is a copy.
   * @throws {Error} `[moku-editor] registry.game is missing.` when no game is configured.
   * @example
   * ```ts
   * // The developer paused in the editor: a reload brings this pause back.
   * await registry.command("game.pause")?.run(null);
   * registry.clock(); // { frame: 1840, paused: true, held: true, reasons: ["devtools"] }
   * ```
   */
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
