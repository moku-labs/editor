import { vi } from "vitest";
import type { Require } from "../../../config";
import type {
  CommandDescriptor,
  Json,
  Manifest,
  RunResult,
  RunState
} from "../../registry/protocol";
import type { CommandEntry } from "../../registry/types";
import { createOverlayState } from "../state";
import type { Config, OverlayCtx, OverlayPluginCtx } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Shared fakes of the overlay unit tests: a log mock, a fake registry slice and a
// fake channel whose game.render watch the test drives by hand.
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

/** The envelope every fake registry answers. */
export const ENVELOPE: RunState = { path: "board/awaitIntent", frame: 1840, tainted: false };

/**
 * A command descriptor.
 *
 * @param id - The id.
 * @param effect - The effect.
 * @param input - The input schema.
 * @returns The descriptor.
 */
export function command(
  id: string,
  effect: CommandDescriptor["effect"] = "cheat",
  input: CommandDescriptor["input"] = {}
): CommandDescriptor {
  return { id, title: `Title of ${id}`, input, effect };
}

/**
 * A manifest with the given commands.
 *
 * @param commands - The command descriptors.
 * @returns The manifest.
 */
export function manifestOf(commands: readonly CommandDescriptor[]): Manifest {
  return { game: "test", page: "http://127.0.0.1/", embedded: false, sources: [], commands };
}

/** The fake registry: records added entries, answers a settable manifest. */
export type FakeRegistry = OverlayCtx["registry"] & {
  readonly added: CommandEntry[];
  commands: readonly CommandDescriptor[];
};

/**
 * Builds a fake registry slice.
 *
 * @param commands - The manifest commands.
 * @returns The fake.
 */
export function fakeRegistry(commands: readonly CommandDescriptor[] = []): FakeRegistry {
  const registry: FakeRegistry = {
    added: [],
    commands,
    manifest: () => manifestOf(registry.commands),
    add: entry => {
      registry.added.push(entry);
    },
    envelope: () => ENVELOPE
  };
  return registry;
}

/** The fake channel: one settable game.render watch, recorded runs. */
export type FakeChannel = OverlayCtx["channel"] & {
  /** Delivers a value to every open watch. */
  frame(value: Json): void;
  /** Open watch listeners. */
  readonly listeners: Set<(value: Json) => void>;
  /** How many watches were opened. */
  opened: number;
  /** How many stops ran. */
  stopped: number;
  /** When set, watch throws it. */
  watchError: Error | undefined;
  /** Ids of every run, in order. */
  readonly runs: string[];
  /** What run does; resolves by default. */
  answer: (id: string) => Promise<RunResult>;
};

/** The game.render value a fake watch delivers first. */
export const RENDER_VALUE: Json = { fps: 60, frameMs: 4.1, textureMb: 31.1 };

/**
 * Builds a fake channel.
 *
 * @param first - The value a watch delivers first.
 * @returns The fake.
 */
export function fakeChannel(first: Json = RENDER_VALUE): FakeChannel {
  const channel: FakeChannel = {
    listeners: new Set(),
    opened: 0,
    stopped: 0,
    watchError: undefined,
    runs: [],
    answer: async () => ({ value: true, state: ENVELOPE }),
    frame: value => {
      for (const listener of channel.listeners) listener(value);
    },
    watch: (_id, _input, onValue) => {
      if (channel.watchError) throw channel.watchError;
      channel.opened += 1;
      onValue(first);
      channel.listeners.add(onValue);
      return () => {
        channel.stopped += 1;
        channel.listeners.delete(onValue);
      };
    },
    run: id => {
      channel.runs.push(id);
      return channel.answer(id);
    }
  };
  return channel;
}

/** The test domain context: mock log, fake registry and channel. */
export type TestOctx = OverlayCtx & {
  readonly log: ReturnType<typeof createLog>;
  readonly registry: FakeRegistry;
  readonly channel: FakeChannel;
};

/**
 * A domain context over fresh state.
 *
 * @param config - Config overrides.
 * @param commands - The manifest commands.
 * @returns The context.
 */
export function createOctx(
  config: Partial<Config> = {},
  commands: readonly CommandDescriptor[] = []
): TestOctx {
  const full: Config = { open: false, corner: "top-right", mount: undefined, ...config };
  return {
    config: full,
    state: createOverlayState({ config: full }),
    log: createLog(),
    registry: fakeRegistry(commands),
    channel: fakeChannel()
  };
}

/**
 * A plugin context over a test domain context; `require` answers the fakes by plugin name.
 *
 * @param octx - The test domain context.
 * @param hasBridge - What `has("bridge")` answers.
 * @returns The plugin context.
 */
export function pluginCtxOf(octx: TestOctx, hasBridge = false): OverlayPluginCtx {
  const apis = new Map<string, unknown>([
    ["registry", octx.registry],
    ["channel", octx.channel]
  ]);
  const require = ((plugin: { readonly name: string }) =>
    apis.get(plugin.name)) as unknown as Require;
  return {
    config: octx.config,
    state: octx.state,
    log: octx.log,
    require,
    has: name => hasBridge && name === "bridge"
  };
}
