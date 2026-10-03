import { vi } from "vitest";
import type { Json, RunResult, RunState } from "../../registry/protocol";
import type { CommandEntry } from "../../registry/types";
import { createCaptureState } from "../state";
import type { CaptureClock, CaptureDeps, CaptureRegistry, Config } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Shared fakes of the capture unit tests: a log mock, a fake registry whose
// game.capture answers what the test asks, a fake clock and the domain deps.
// ─────────────────────────────────────────────────────────────────────────────

/** A PNG data URL as the door answers it. */
export const PNG = "data:image/png;base64,AAAA";

/** The envelope the fake registry answers for commands that run no door. */
export const ENVELOPE: RunState = { path: "board/awaitIntent", frame: 1790, tainted: false };

/** The default capture config. */
export const CONFIG: Config = { maxDurationMs: 20_000, minIntervalMs: 16 };

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

/** What the fake game.capture answers for one call: a value, or an error to throw. */
export type CaptureAnswer = { readonly value: Json } | { readonly error: Error };

/** A fake registry slice with its game.capture door. */
export type FakeRegistry = CaptureRegistry & {
  /** The entries added with `add`, by id. */
  readonly added: Map<string, CommandEntry>;
  /** The game.capture entry (absent when the registry has none). */
  readonly capture: ReturnType<typeof vi.fn<(raw: Json) => Promise<RunResult>>>;
  /** The frame the next game.capture call reports. */
  frame: number;
};

/**
 * Builds a fake registry whose game.capture answers `answer(call)`; the frame grows per call.
 *
 * @param answer - The answer of each call (0-based call index), a data URL by default.
 * @param options - `withCapture: false` leaves game.capture out of the registry.
 * @param options.withCapture - Whether the registry holds game.capture.
 * @param options.onRun - Runs before each answer (the test moves its clock here).
 * @returns The fake registry.
 */
export function fakeRegistry(
  answer: (call: number) => CaptureAnswer = () => ({ value: PNG }),
  options: { readonly withCapture?: boolean; readonly onRun?: () => void } = {}
): FakeRegistry {
  const added = new Map<string, CommandEntry>();
  let calls = 0;
  const registry: FakeRegistry = {
    added,
    frame: 1777,
    capture: vi.fn(async (_raw: Json): Promise<RunResult> => {
      const reply = answer(calls);
      calls += 1;
      options.onRun?.();
      registry.frame += 1;
      if ("error" in reply) throw reply.error;
      return { value: reply.value, state: { ...ENVELOPE, frame: registry.frame } };
    }),
    command: id => {
      if (id === "game.capture" && options.withCapture !== false) {
        return {
          descriptor: { id, title: "Capture", input: {}, effect: "read" },
          run: raw => registry.capture(raw)
        };
      }
      return added.get(id);
    },
    add: entry => {
      added.set(entry.descriptor.id, entry);
    },
    envelope: () => ENVELOPE
  };
  return registry;
}

/** A clock the test moves by hand: `wait` jumps the time forward at once. */
export type FakeClock = CaptureClock & { time: number };

/**
 * Builds a fake clock starting at 1000 ms.
 *
 * @returns The clock.
 */
export function fakeClock(): FakeClock {
  const clock: FakeClock = {
    time: 1000,
    now: () => clock.time,
    wait: vi.fn(async (ms: number) => {
      clock.time += ms;
    })
  };
  return clock;
}

/** Domain deps whose log is the mock. */
export type TestDeps = CaptureDeps & { readonly log: LogMock };

/**
 * Builds domain deps with a real state, a mock log and the given clock.
 *
 * @param clock - The clock.
 * @param config - Config overrides.
 * @returns The deps.
 */
export function createDeps(clock: CaptureClock, config: Partial<Config> = {}): TestDeps {
  return {
    config: { ...CONFIG, ...config },
    state: createCaptureState(),
    log: createLog(),
    clock
  };
}

/**
 * Awaits a promise and returns what it rejected with.
 *
 * @param promise - The promise.
 * @returns The rejection reason.
 */
export async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
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
