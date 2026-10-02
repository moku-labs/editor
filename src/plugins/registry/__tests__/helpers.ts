import { createHeadless } from "@moku-labs/game/testing";
import { vi } from "vitest";
import { loadMergeGame } from "../../../../tests/fixtures/merge-game";
import { createRegistryState } from "../state";
import type { GameLike, RegistryConfig, RegistryCtx } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Shared test helpers of the registry: a log mock, a domain ctx and a started
// headless merge game.
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

/** A registry ctx whose log is the mock. */
export type TestCtx = RegistryCtx & { readonly log: LogMock };

/**
 * A registry domain ctx with a real state and a mock log.
 *
 * @param config - Config overrides.
 * @returns The ctx.
 */
export function createCtx(config: Partial<RegistryConfig> = {}): TestCtx {
  return {
    config: { game: undefined, modules: [], name: undefined, ...config },
    state: createRegistryState(),
    log: createLog()
  };
}

/** A started headless merge game. */
export type StartedGame = { readonly app: GameLike; stop(): Promise<void> };

/**
 * Creates the merge game and starts it headless (it rests at "home").
 *
 * @returns The app and its stop.
 */
export async function startGame(): Promise<StartedGame> {
  const { createGame } = await loadMergeGame();
  const { app } = createGame();
  const game = await createHeadless(app);

  return { app, stop: () => game.stop() };
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
