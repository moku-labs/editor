/**
 * @file registry plugin — type definitions: config, the erased door types, the closure-erased
 * entries, state, api and the domain context.
 */
import type { Log } from "@moku-labs/common/browser";
import type { EmitFn } from "@moku-labs/core";
import type { Model } from "@moku-labs/game";
import type { HeadlessApp } from "@moku-labs/game/testing";
import type {
  BuildInfo,
  Changes,
  CommandDescriptor,
  CommandVia,
  Effect,
  InputOf,
  InputSchema,
  Json,
  Manifest,
  OverlayMarker,
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
 * The `value(app)` of an overlay toggle, as a method type: its parameter compares bivariantly, so
 * a game's `value: (app: GameLike) => boolean` fits.
 */
type ToggleValue = { value(app: HeadlessApp): boolean }["value"];

/**
 * Any door command with its generics erased (method syntax, see DoorSource). Every branch of the
 * engine's overlay union fits without a cast: none (`overlay?: undefined`), a toggle with its
 * `value`, a button.
 */
export type DoorCommand = {
  readonly id: string;
  readonly title: string;
  readonly input: InputSchema;
  readonly effect: Effect;
  /** Shows the command on the overlay's Game tab (engine spec 12 H4.4). Absent: not shown. */
  readonly overlay?: OverlayMarker | undefined;
  run(app: HeadlessApp, input: InputOf<InputSchema>): unknown;
  /** The current value of an overlay toggle (engine spec 12: required with `overlay: "toggle"`). */
  readonly value?: ToggleValue | undefined;
};

/**
 * The plain command the engine's `run` takes: a door command without its overlay members (`run`
 * reads `id`, `effect` and `run` only). Assignable to the engine's `Command` without a cast.
 */
export type RunnableCommand = {
  readonly id: string;
  readonly title: string;
  readonly input: InputSchema;
  readonly effect: Effect;
  readonly run: (app: GameLike, input: InputOf<InputSchema>) => unknown;
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
 * A closure-erased source: raw Json in, wire-safe Json out. Editor sources may give a probe.
 */
export type SourceEntry = {
  readonly descriptor: SourceDescriptor;
  read(raw: Json): Json;
  watch(raw: Json, fn: (value: Json) => void): () => void;
  /** Editor sources only: why the source is not available now, or undefined. Run at each manifest build. */
  probe?(): string | undefined;
};

/**
 * A closure-erased command: raw Json in, RunResult out. An overlay toggle of the game has value().
 */
export type CommandEntry = {
  readonly descriptor: CommandDescriptor;
  /**
   * Runs it; `via` names the source for `registry:command` (absent: "local"); `client` is the MCP
   * client's name the hub stamped, passed only with `via: "mcp"` (the recorder's `editor.record`
   * names the agent with it). An entry that does not read them ignores them.
   */
  run(raw: Json, via?: CommandVia, client?: string): Promise<RunResult>;
  /** Overlay toggles of the game only: the switch's state now; undefined when value(app) failed. */
  value?(): boolean | undefined;
};

/**
 * Payload of the registry's per-plugin event `registry:command`: one command run settled.
 *
 * @example
 * ```ts
 * const ran: RegistryCommandEvent = { id: "garden.glow", input: { on: false }, via: "overlay", ok: true };
 * ```
 */
export type RegistryCommandEvent = {
  readonly id: string;
  /** The raw input as the caller gave it (null when none). */
  readonly input: Json;
  readonly via: CommandVia;
  /** True when the run resolved; false when it rejected (a refusal included). */
  readonly ok: boolean;
};

/**
 * The registry's own events: declared in its `index.ts`, hooked through `depends` (not in
 * `AgentEvents`).
 */
export type RegistryEvents = {
  readonly "registry:command": RegistryCommandEvent;
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
 * Where an entry came from; "registry" = built by the catalogue itself (editor.toggles), rebuilt,
 * never kept.
 */
export type Origin = "door" | "module" | "editor" | "registry";

/**
 * Registry state: entries by id in manifest order, one id namespace, the manifest cache, the
 * sources that are not available, and the page's build.
 */
export type RegistryState = {
  sources: Map<string, SourceEntry>;
  commands: Map<string, CommandEntry>;
  /** Where each id came from; "registry" = built by the catalogue itself (editor.toggles), rebuilt, never kept. */
  origins: Map<string, Origin>;
  manifest: Manifest | undefined;
  /** Door and editor sources whose probe failed: id to the reason. Their reads and watches answer -32008. */
  unavailable: Map<string, string>;
  /** The probe of each door source and of each editor source that has one, run at each manifest build. */
  probes: Map<string, () => void>;
  /** The page's build, read on the first call of build() or the first manifest build. */
  build: BuildInfo | undefined;
};

/**
 * The registry api (`app.registry`, `ctx.require(registryPlugin)`): the catalogue of every source
 * and command the editor can read, watch or run.
 */
export type RegistryApi = {
  /**
   * The frozen manifest: descriptors only, no functions. Cached until the next `add`; `game`, `page`
   * and `embedded` are computed at call time. Each build probes the door sources and the editor
   * sources that have a probe first: one that is not available is listed with `available: false` and
   * its `reason`. Every command descriptor carries `allowed` (and `reason` when refused) for this
   * page's build; the manifest carries `build`.
   *
   * @returns The manifest the bridge sends in `hello`.
   * @example
   * ```ts
   * // A plain --debug build of the merge game on a phone:
   * app.registry.manifest().build; // { profile: "read", id: "debug-20261014T160000Z", engine: "0.14.12+9c41e0" }
   * app.registry.manifest().commands.find(command => command.id === "game.tap");
   * // { id: "game.tap", title: "Tap", input: { key: "string?", target: "json?" }, effect: "route", allowed: false, reason: "read-only" }
   * ```
   */
  manifest(): Manifest;
  /**
   * Looks up a source entry: door, module, registry or editor. Callers map `undefined` to -32601.
   *
   * @param id - The source id, e.g. "game.position".
   * @returns The entry, or undefined for an unknown id or a command id.
   * @example
   * ```ts
   * app.registry.source("game.position")?.read(null); // { path: "home", … }
   * app.registry.source("editor.perf.second")?.read(null); // { state: "on", fps: { loop: 60, drawn: 54 }, spikes: 6, … }
   * ```
   */
  source(id: string): SourceEntry | undefined;
  /**
   * Looks up a command entry: door, module or editor. An overlay toggle's entry has `value()`.
   *
   * @param id - The command id, e.g. "game.step".
   * @returns The entry, or undefined for an unknown id or a source id.
   * @example
   * ```ts
   * // The overlay draws the game's "Glow" switch, then flips it.
   * app.registry.command("garden.glow")?.value?.(); // true
   * await app.registry.command("garden.glow")?.run({ on: false }); // { value: …, state: { path: "garden/boss", frame: 4812, tainted: false } }
   * ```
   */
  command(id: string): CommandEntry | undefined;
  /**
   * Adds an editor-owned command or source. Call it in `onInit`: the tools page sees a later add only
   * on the next bridge hello. Drops the manifest cache. A source may give a `probe`: the registry runs
   * it at each manifest build, and an answer lists the source as not available.
   *
   * @param entry - The editor command (descriptor, run) or source (descriptor, read, watch, probe?).
   * @throws {Error} For an invalid or used id, an unknown input kind or changes, a `cheat` or `raw`
   *   effect, or an `overlay` marker on a command (the overlay lists only the game's commands).
   * @example
   * ```ts
   * // perf, in its onInit: the frame graph's window for the tools page and MCP (spec 03).
   * ctx.require(registryPlugin).add({
   *   descriptor: { id: "editor.perf.window", title: "Frame graph", input: {}, changes: "frame" },
   *   read: () => toWireValue(writeWireWindow(state.window)),
   *   watch: (_raw, fn) => watchTicks(state, () => fn(toWireValue(writeWireWindow(state.window)))),
   *   probe: () => offText(state) // "the game has no renderer (headless)" on a headless game
   * });
   * ```
   */
  add(entry: CommandEntry | SourceEntry): void;
  /**
   * Where the game stands now, for editor commands that run no door (R2, R6).
   *
   * @returns `{ path, frame, tainted }` from game.position, the clock and game.tainted.
   * @throws {Error} `[moku-editor] registry.game is missing.\n  Pass pluginConfigs.registry.game.` when no game is
   *   configured (a lifecycle error, two lines).
   * @example
   * ```ts
   * app.registry.envelope(); // { path: "home", frame: 1840, tainted: false }
   * ```
   */
  envelope(): RunState;
  /**
   * The game clock and why it stands (R6). `paused` is true for any pause reason; `held` only
   * while the reasons include `"devtools"`, the pause of `game.pause`. The channel heartbeat reads
   * `frame` and `paused`; a reload checkpoint reads `held`, so a hidden tab's `"background"` pause
   * is not restored. A game without `lifecycle.reasons` answers `reasons: []` and `held` equal to
   * `paused`. See README "Clock".
   *
   * @returns `{ frame, paused, held, reasons }`; `reasons` is a copy.
   * @throws {Error} `[moku-editor] registry.game is missing.\n  Pass pluginConfigs.registry.game.` when no game is
   *   configured (a lifecycle error, two lines).
   * @example
   * ```ts
   * await registry.command("game.pause")?.run(null);
   * registry.clock(); // { frame: 1840, paused: true, held: true, reasons: ["devtools"] }
   * ```
   */
  clock(): Clock;
  /**
   * The game app the registry wraps, for an editor plugin that reads the engine directly (the renderer
   * monitor's rings are not a door).
   *
   * @returns The configured game app.
   * @throws {Error} `[moku-editor] registry.game is missing.\n  Pass pluginConfigs.registry.game.` when no game is
   *   configured (a lifecycle error, two lines).
   * @example
   * ```ts
   * // perf, in onInit: find the engine's performance monitor.
   * const monitor = monitorOf(ctx.require(registryPlugin).game()); // undefined on a headless game
   * ```
   */
  game(): GameLike;
  /**
   * The build of this page: its profile (dev, full, read, none) from the engine's build flags, the build
   * id and the engine fingerprint when the page has them. Read once; the flags of a page never change.
   *
   * @returns The frozen BuildInfo.
   * @example
   * ```ts
   * // The overlay's engine line on a plain --debug build.
   * app.registry.build(); // { profile: "read", id: "debug-20261014T160000Z", engine: "0.14.12+9c41e0" }
   * ```
   */
  build(): BuildInfo;
};

/**
 * Domain context of the registry: the kernel context is assignable to it. `emit` sends the
 * registry's own `registry:command`.
 */
export type RegistryCtx = {
  readonly config: Readonly<RegistryConfig>;
  state: RegistryState;
  readonly log: Log.LogApi;
  readonly emit: EmitFn<RegistryEvents>;
};
