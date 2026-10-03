/* eslint-disable unicorn/no-null -- null is the wire value for "no input" */
import { vi } from "vitest";
import type { Json, RunResult } from "../../registry/protocol";
import { wireError } from "../../registry/protocol";
import type { CommandEntry, SourceEntry } from "../../registry/types";
import { createChannelState } from "../state";
import type { ChannelDeps, ChannelRegistry } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Shared fakes of the channel unit tests: a log mock, a fake registry whose
// sources count reads and whose watches let the test fire "frames", and deps.
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

/** A fake source: counts reads, keeps the door listeners so the test can fire frames. */
export type FakeSource = SourceEntry & {
  /** The value the next read returns (a function makes it dynamic). */
  value: Json;
  /** Raw inputs of every read, in order. */
  readonly reads: Json[];
  /** Open door listeners. */
  readonly doors: Set<(value: Json) => void>;
  /** How many door watches were opened. */
  opened: number;
  /** How many door stops ran. */
  stopped: number;
  /** Calls every open door listener with the value: one "frame". */
  frame(value: Json): void;
};

/**
 * Builds a fake source entry.
 *
 * @param id - The source id.
 * @param value - The initial value.
 * @returns The fake.
 */
export function fakeSource(id: string, value: Json): FakeSource {
  const source: FakeSource = {
    descriptor: { id, title: id, input: {}, changes: "edge" },
    value,
    reads: [],
    doors: new Set(),
    opened: 0,
    stopped: 0,
    read: raw => {
      source.reads.push(raw);
      if (raw === "bad") {
        throw wireError(-32_602, `${id}: bad input`, { reason: "invalid_input" });
      }
      return source.value;
    },
    watch: (raw, fn) => {
      if (raw === "bad") {
        throw wireError(-32_602, `${id}: bad input`, { reason: "invalid_input" });
      }
      source.opened += 1;
      const door = (next: Json): void => fn(next);
      source.doors.add(door);
      return () => {
        source.stopped += 1;
        source.doors.delete(door);
      };
    },
    frame: next => {
      for (const door of source.doors) door(next);
    }
  };
  return source;
}

/** A fake command: records inputs and answers with a settable result. */
export type FakeCommand = CommandEntry & {
  /** Raw inputs of every run. */
  readonly runs: Json[];
};

/**
 * Builds a fake command entry.
 *
 * @param id - The command id.
 * @param answer - What run resolves (or a function computing it).
 * @returns The fake.
 */
export function fakeCommand(id: string, answer: (raw: Json) => Promise<RunResult>): FakeCommand {
  const command: FakeCommand = {
    descriptor: { id, title: id, input: {}, effect: "cosmetic" },
    runs: [],
    run: raw => {
      command.runs.push(raw);
      return answer(raw);
    }
  };
  return command;
}

/** A fake registry slice with a settable clock. */
export type FakeRegistry = ChannelRegistry & {
  readonly sources: Map<string, FakeSource>;
  readonly commands: Map<string, FakeCommand>;
  clockNow: { frame: number; paused: boolean };
};

/**
 * Builds a fake registry with one source `game.position` and one command `game.step`.
 *
 * @returns The fake registry.
 */
export function fakeRegistry(): FakeRegistry {
  const registry: FakeRegistry = {
    sources: new Map([["game.position", fakeSource("game.position", { path: "home" })]]),
    commands: new Map([
      [
        "game.step",
        fakeCommand("game.step", async () => ({
          value: null,
          state: { path: "home", frame: 1, tainted: false }
        }))
      ]
    ]),
    clockNow: { frame: 1840, paused: false },
    source: id => registry.sources.get(id),
    command: id => registry.commands.get(id),
    clock: () => ({ ...registry.clockNow })
  };
  return registry;
}

/** Deps whose log is the mock and whose registry is the fake. */
export type TestDeps = ChannelDeps & { readonly log: LogMock; readonly registry: FakeRegistry };

/**
 * Channel deps over a fresh state, a mock log and a fake registry.
 *
 * @param heartbeatMs - The heartbeat interval.
 * @returns The deps.
 */
export function createDeps(heartbeatMs = 1000): TestDeps {
  const config = { heartbeatMs };
  return {
    config,
    state: createChannelState({ config }),
    log: createLog(),
    registry: fakeRegistry()
  };
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
