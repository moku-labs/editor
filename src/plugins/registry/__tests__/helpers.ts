import { createApp, defineGame, type } from "@moku-labs/game";
import { createHeadless, fakeClock, memory } from "@moku-labs/game/testing";
import type { Mock } from "vitest";
import { vi } from "vitest";
import { createRegistryState } from "../state";
import type { GameLike, RegistryCommandEvent, RegistryConfig, RegistryCtx } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Shared test helpers of the registry: a log mock, a domain ctx and a started
// headless bare game.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A full Log.LogApi made of mocks.
 *
 * @returns The mock log.
 */
export function createLog() {
  return {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(() => []),
    expect: vi.fn(),
    addSink: vi.fn(),
    reset: vi.fn(),
    clearSinks: vi.fn()
  };
}

/** The mock log type. */
export type LogMock = ReturnType<typeof createLog>;

/** The mock of the registry's emit. */
export type EmitMock = Mock<(name: "registry:command", payload: RegistryCommandEvent) => void>;

/**
 * A mock of the registry's emit.
 *
 * @returns The mock.
 */
export function createEmit(): EmitMock {
  return vi.fn<(name: "registry:command", payload: RegistryCommandEvent) => void>();
}

/** A registry ctx whose log and emit are mocks. */
export type TestCtx = RegistryCtx & { readonly log: LogMock; readonly emit: EmitMock };

/**
 * A registry domain ctx with a real state, a mock log and a mock emit.
 *
 * @param config - Config overrides.
 * @returns The ctx.
 */
export function createCtx(config: Partial<RegistryConfig> = {}): TestCtx {
  return {
    config: { game: undefined, modules: [], name: undefined, ...config },
    state: createRegistryState(),
    log: createLog(),
    emit: createEmit()
  };
}

/** The build flags of the engine (spec 10 F1/F3), as the tests stub them. */
type BuildFlags = {
  readonly dev?: unknown;
  readonly control?: unknown;
  readonly agent?: unknown;
  readonly build?: unknown;
  readonly engine?: unknown;
};

/**
 * Stubs the page's build flags as globals (the caller unstubs in afterEach). A flag left out is
 * stubbed `undefined`.
 *
 * @param flags - The flag values.
 */
export function stubBuild(flags: BuildFlags): void {
  vi.stubGlobal("__MOKU_GAME_DEV__", flags.dev);
  vi.stubGlobal("__MOKU_GAME_CONTROL__", flags.control);
  vi.stubGlobal("__MOKU_GAME_AGENT__", flags.agent);
  vi.stubGlobal("__MOKU_GAME_BUILD__", flags.build);
  vi.stubGlobal("__MOKU_GAME_ENGINE__", flags.engine);
}

/** A started headless game. */
export type StartedGame = { readonly app: GameLike; stop(): Promise<void> };

/** The flow of the bare game: one rest node. */
const bareFlow = (() => {
  const { defineNode, defineFlow } = defineGame<{
    player: { coins: number };
    session: Record<string, never>;
    assets: string;
    strings: Record<string, unknown>;
  }>();
  const home = defineNode({ outcomes: { stay: type() }, rest: true, checkpoint: true });
  return defineFlow("main", { nodes: { home }, start: "home", edges: { home: { stay: "home" } } });
})();

/**
 * Creates a bare game (not started): the engine's core plugins only, so it has no world, ui,
 * renderer, audio, effects or assets plugin. It rests at "home".
 *
 * @returns The app.
 * @example
 * ```ts
 * const app = createBareApp();
 * await createHeadless(app);
 * ```
 */
export function createBareApp() {
  const app = createApp({
    pluginConfigs: {
      model: { playerProvider: memory(), initialPlayer: { coins: 0 }, initialSession: {}, seed: 1 },
      clock: { source: fakeClock(1_000_000) },
      flow: { mainFlow: bareFlow, safeNode: "home" }
    }
  });
  app.log.clearSinks();
  return app;
}

/**
 * Creates a bare game and starts it headless (it rests at "home").
 *
 * @returns The app and its stop.
 * @example
 * ```ts
 * const game = await startBareGame();
 * await game.stop();
 * ```
 */
export async function startBareGame(): Promise<StartedGame> {
  const app = createBareApp();
  const game = await createHeadless(app);

  return { app, stop: () => game.stop() };
}

/**
 * The game behind a Proxy whose `effects` the test switches on and off: the effects plugin
 * installed or missing.
 *
 * @param app - The game app.
 * @returns The proxied app and the switch.
 */
export function withEffects(app: GameLike): { app: GameLike; install(on: boolean): void } {
  let installed = false;
  const effects = { stats: () => ({ particles: 0, emitters: 0, filters: 0, renderPasses: 0 }) };
  const proxied = new Proxy(app, {
    get: (target, key) => (key === "effects" && installed ? effects : Reflect.get(target, key))
  });

  return {
    app: proxied,
    install: on => {
      installed = on;
    }
  };
}

/**
 * Turns the game's dev flag on for door commands (the caller unstubs in afterEach).
 */
export function devOn(): void {
  vi.stubGlobal("__MOKU_GAME_DEV__", true);
}

/**
 * Runs a function and returns what it threw.
 *
 * @param fn - The function.
 * @returns The thrown value.
 */
export function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected a throw");
}
