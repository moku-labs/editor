import type { Mock } from "vitest";
import { vi } from "vitest";
import type { Require } from "../../../config";
import { linkPlugin } from "../../link";
import type { LinkApi } from "../../link/types";
import { panelsPlugin } from "../../panels";
import type { PanelSpec } from "../../panels/types";
import type { Json, LinkStatus, Manifest } from "../../registry/protocol";
import { createStateViewState } from "../state";
import type { Config, StateViewCtx } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Shared unit helpers of stateView: a scripted link (watch callbacks kept by
// source id, read answers by id), a panels mock that records registrations, a
// log mock and a domain ctx with a real state.
// ─────────────────────────────────────────────────────────────────────────────

/** The default config of stateView (index.ts). */
export const CONFIG: Config = { expandDepth: 2, maxPatches: 200, pageSize: 100 };

/** The scripted link. */
export type LinkMock = {
  readonly api: LinkApi;
  status: LinkStatus;
  session: string | undefined;
  manifest: Manifest | undefined;
  /** The last onValue of each watched id. */
  readonly watchers: Map<string, (value: Json) => void>;
  /** The unsubscribe mock of each watched id. */
  readonly unwatch: Map<string, Mock>;
  /** The manifest listener, while subscribed. */
  manifestListener: ((manifest: Manifest | undefined) => void) | undefined;
  readonly stopManifest: Mock;
  /** Read answers by id; a function is called, an Error rejects. */
  readonly values: Map<string, Json | Error>;
  readonly read: Mock<(id: string, input?: Json) => Promise<Json>>;
  readonly watch: Mock;
};

/** The log mock. */
export type LogMock = {
  readonly info: Mock;
  readonly debug: Mock;
  readonly warn: Mock;
  readonly error: Mock;
};

/** The test ctx: the domain ctx plus the mocks behind it. */
export type TestCtx = StateViewCtx & {
  readonly link: LinkMock;
  readonly registered: PanelSpec[];
  readonly logMock: LogMock;
};

/**
 * Creates the scripted link.
 *
 * @returns The link mock.
 */
export function createLinkMock(): LinkMock {
  const mock: LinkMock = {
    api: undefined as unknown as LinkApi,
    status: { kind: "live", frame: 1503 },
    session: "s-1",
    manifest: undefined,
    watchers: new Map(),
    unwatch: new Map(),
    manifestListener: undefined,
    stopManifest: vi.fn(() => {
      mock.manifestListener = undefined;
    }),
    values: new Map(),
    read: vi.fn((id: string) => {
      const value = mock.values.get(id);
      if (value === undefined) return Promise.reject(new Error(`[moku-editor] Unknown ${id}.`));
      return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
    }),
    watch: vi.fn((id: string, _input: Json | undefined, onValue: (value: Json) => void) => {
      mock.watchers.set(id, onValue);
      const stop = vi.fn();
      mock.unwatch.set(id, stop);
      return stop;
    })
  };
  const api = {
    read: mock.read,
    watch: mock.watch,
    run: vi.fn(),
    status: () => mock.status,
    session: () => mock.session,
    manifest: () => mock.manifest,
    onManifest: (fn: (manifest: Manifest | undefined) => void) => {
      mock.manifestListener = fn;
      if (mock.manifest !== undefined) fn(mock.manifest);
      return mock.stopManifest;
    }
  };
  Object.assign(mock, { api: api as unknown as LinkApi });
  return mock;
}

/**
 * Creates the log mock.
 *
 * @returns The log mock.
 */
export function createLog(): LogMock {
  return { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/**
 * Creates a domain ctx with a real state.
 *
 * @param config - Config overrides.
 * @returns The test ctx.
 */
export function createCtx(config: Partial<Config> = {}): TestCtx {
  const link = createLinkMock();
  const registered: PanelSpec[] = [];
  const panels = { register: (panel: PanelSpec) => registered.push(panel) };
  const require = vi.fn((plugin: unknown) => {
    if (plugin === linkPlugin) return link.api;
    if (plugin === panelsPlugin) return panels;
    throw new Error("unexpected require");
  }) as unknown as Require;
  const logMock = createLog();
  return {
    config: { ...CONFIG, ...config },
    state: createStateViewState(),
    log: logMock as unknown as StateViewCtx["log"],
    require,
    link,
    registered,
    logMock
  };
}

/**
 * Lets pending promise callbacks run (no timers involved).
 */
export async function flush(): Promise<void> {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}
