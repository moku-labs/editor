/* eslint-disable unicorn/no-null, sonarjs/no-hardcoded-ip -- null is a JSON value on the wire and the spec's "none"; the addresses are fixtures */
import type { Mock } from "vitest";
import { vi } from "vitest";
import type { Require } from "../../../config";
import type {
  DeviceDirectory,
  DeviceTelemetry,
  LinkedEntry,
  WireDevice
} from "../../connect/protocol";
import type { SessionDevice } from "../../hub/protocol";
import type { LinkApi, ReceivedHeartbeat } from "../../link/types";
import type { ErrorReason, Json, Manifest, RunResult, SessionInfo } from "../../registry/protocol";
import { errorCode, wireError } from "../../registry/protocol";
import { createActiveSourceState } from "../state";
import type { ActiveSourceConfig, ActiveSourceCtx, ActiveSourceEvents } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Shared test helpers of activeSource: a log mock, a fake link (scripted
// sessions, own session, published values; recording choose / runIn /
// callEditor), a domain ctx with a real state, and wire fixtures.
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

/** The emit mock: one signature over both events, so it is callable as each overload. */
export type EmitMock = Mock<
  (name: keyof ActiveSourceEvents, payload: ActiveSourceEvents[keyof ActiveSourceEvents]) => void
>;

/** An activeSource ctx whose emit and log are mocks. */
export type TestCtx = Omit<ActiveSourceCtx, "emit" | "log"> & {
  readonly emit: EmitMock;
  readonly log: LogMock;
};

/** The default config of the plugin. */
export const CONFIG: ActiveSourceConfig = {
  autoUse: true,
  pauseLocal: true,
  rejoinMs: 15_000,
  noticeMs: 12_000,
  renewMs: 4000,
  markers: 32
};

/** The frame id of this page: its own game frame's page carries it. */
export const FRAME = "f-test";

/** The Galaxy A26 of the frozen demo. */
export const A26: SessionDevice = {
  id: "d-7f3a",
  model: "SM-A266B",
  link: "adb",
  address: "127.0.0.1",
  port: 47_600,
  engine: "0.15.0+9c41e0",
  build: "debug-20261016T090000Z"
};

/** An iPhone 15 on the network. */
export const IPHONE: SessionDevice = {
  id: "d-11c2",
  model: "IPHONE15,4",
  link: "lan",
  address: "192.168.1.42",
  port: 47_600,
  engine: "0.15.0+9c41e0",
  build: null
};

/** A manifest link answers on choose. */
export const MANIFEST: Manifest = {
  game: "merge-game 0.0.0",
  page: "http://127.0.0.1:3000/",
  embedded: true,
  sources: [],
  commands: []
};

/**
 * This page's own game frame session (the local preview).
 *
 * @param id - Session id.
 * @param paused - The hub's heartbeat readout: paused, running, or none yet (undefined).
 * @returns The session.
 */
export function localSession(id = "s-1", paused?: boolean): SessionInfo {
  const base: SessionInfo = {
    id,
    game: "merge-game 0.0.0",
    page: `http://127.0.0.1:3000/?moku-frame=${FRAME}`,
    embedded: true,
    connectedAt: 1000
  };
  return paused === undefined
    ? base
    : { ...base, heartbeat: { frame: 1840, paused, silent: false } };
}

/**
 * A device session.
 *
 * @param id - Session id.
 * @param device - The device.
 * @returns The session.
 */
export function deviceSession(id = "s-9", device: SessionDevice = A26): SessionInfo {
  return {
    id,
    game: "merge-game 0.0.0",
    page: "http://localhost/index.html",
    embedded: false,
    connectedAt: 2000,
    device
  };
}

/**
 * Another game page (another tab's frame).
 *
 * @param id - Session id.
 * @returns The session.
 */
export function pageSession(id = "s-5"): SessionInfo {
  return {
    id,
    game: "merge-game 0.0.0",
    page: "http://127.0.0.1:3000/?moku-frame=f-other",
    embedded: true,
    connectedAt: 1500
  };
}

/**
 * A linked entry of the directory.
 *
 * @param overrides - Field overrides.
 * @returns The entry.
 */
export function linkedOf(overrides: Partial<LinkedEntry> = {}): LinkedEntry {
  return {
    id: A26.id,
    model: A26.model,
    link: "adb",
    address: "127.0.0.1",
    online: true,
    engine: A26.engine,
    build: A26.build,
    latencyMs: 9,
    session: "s-9",
    ...overrides
  };
}

/**
 * A phone adb lists.
 *
 * @param overrides - Field overrides.
 * @returns The phone.
 */
export function wireOf(overrides: Partial<WireDevice> = {}): WireDevice {
  return {
    serial: "R5CX30ABCDE",
    state: "device",
    transport: "usb",
    model: "SM-A266B",
    name: "Galaxy A26",
    os: "Android 15",
    phase: "linked",
    device: A26.id,
    ...overrides
  };
}

/**
 * A device directory.
 *
 * @param overrides - Field overrides.
 * @returns The directory.
 */
export function directoryOf(overrides: Partial<DeviceDirectory> = {}): DeviceDirectory {
  return {
    v: 1,
    mode: {
      on: true,
      owner: "connect",
      listen: { port: 47_600, adb: "127.0.0.1:47600", lan: null }
    },
    confirmIn: "page",
    adb: { available: true },
    wire: [wireOf()],
    asking: [],
    linked: [linkedOf()],
    at: 1_791_986_083_963,
    ...overrides
  };
}

/**
 * A telemetry record of a device.
 *
 * @param device - The device id.
 * @param at - Epoch ms.
 * @returns The record.
 */
export function telemetryOf(device = A26.id, at = 1_791_986_083_963): DeviceTelemetry {
  const off = { available: false, source: "none", reason: "warming-up" } as const;
  return {
    v: 1,
    device,
    serial: "R5CX30ABCDE",
    at,
    wired: true,
    gpu: {
      available: true,
      source: "/sys/kernel/gpu",
      value: { mhz: 221, busyPct: 63, minMhz: 221, maxMhz: 949 }
    },
    cpu: { cores: 8, app: off, renderer: off, surfaceflinger: off },
    memory: { app: off, renderer: off },
    heap: { available: false, source: "none", reason: "no-devtools-socket" }
  };
}

/**
 * A run result.
 *
 * @param value - The command's value.
 * @returns The result.
 */
export function resultOf(value: Json): RunResult {
  return { value, state: { path: "board/awaitIntent", frame: 1841, tainted: false } };
}

/**
 * The -32003 of link for a session that is not open.
 *
 * @param session - The id.
 * @param reason - `choose_session` (choose) or `no_session` (runIn).
 * @returns The error.
 */
function notOpen(session: string, reason: ErrorReason): Error {
  return wireError(errorCode.noSession, `Session "${session}" is not open.`, {
    reason,
    retryable: false
  });
}

/**
 * The answers of connect's editor methods a fake link gives by default.
 *
 * @param method - The method.
 * @returns The answer.
 */
function connectAnswer(method: string): Json {
  switch (method) {
    case "connect.wire": {
      return { listen: { port: 47_600, adb: "127.0.0.1:47600", lan: null } };
    }
    case "connect.network": {
      return { listen: { port: 47_600, adb: "127.0.0.1:47600", lan: "192.168.1.5:47600" } };
    }
    case "connect.confirm": {
      return { paired: true };
    }
    case "connect.refuse": {
      return { refused: true };
    }
    case "connect.off": {
      return { listen: null };
    }
    case "connect.watch": {
      return { wired: true };
    }
    default: {
      return { ok: true };
    }
  }
}

/** A fake link: what activeSource reads and calls, scripted by the test. */
export type FakeLink = {
  /** The api activeSource gets from ctx.require(linkPlugin). */
  readonly api: LinkApi;
  /** The open sessions. */
  sessions: SessionInfo[];
  /** The chosen session (choose sets it at once, like link's attach). */
  chosen: string | undefined;
  /** The own frame's session. */
  own: string | undefined;
  /** The held `editor.devices`. */
  devices: DeviceDirectory | undefined;
  /** The held `editor.deviceTelemetry`. */
  deviceTelemetry: DeviceTelemetry | undefined;
  readonly choose: Mock<LinkApi["choose"]>;
  readonly runIn: Mock<LinkApi["runIn"]>;
  readonly callEditor: Mock<LinkApi["callEditor"]>;
  /** onSessions listeners. */
  readonly sessionListeners: Set<(list: readonly SessionInfo[]) => void>;
  /** onPublished listeners by method. */
  readonly publishedListeners: Map<string, Set<(value: never) => void>>;
  /** onHeartbeat listeners. */
  readonly heartbeatListeners: Set<(beat: ReceivedHeartbeat) => void>;
  /** Applies a sessions list (and the own session) and calls the onSessions listeners. */
  list(next: SessionInfo[], own?: string): void;
  /** Holds a devices value and calls its listeners. */
  publishDevices(value: DeviceDirectory): void;
  /** Holds a telemetry record and calls its listeners. */
  publishTelemetry(value: DeviceTelemetry): void;
  /** Calls the onHeartbeat listeners with a beat, like link on a heartbeat of the chosen session. */
  heartbeat(beat: ReceivedHeartbeat): void;
  /** The commands runIn received, as `session id`. */
  commands(): string[];
  /** The editor methods callEditor received, as `method`. */
  methods(): string[];
};

/**
 * Creates a fake link. `choose` sets the chosen session at once and resolves the manifest (rejects
 * -32003 `choose_session` for an id that is not open); `runIn` answers `game.pause` true and
 * anything else false (rejects -32003 `no_session` for a closed id); `callEditor` answers connect's
 * methods with their default shapes.
 *
 * @returns The fake.
 */
export function createFakeLink(): FakeLink {
  const sessionListeners = new Set<(list: readonly SessionInfo[]) => void>();
  const publishedListeners = new Map<string, Set<(value: never) => void>>();
  const heartbeatListeners = new Set<(beat: ReceivedHeartbeat) => void>();

  const isOpen = (id: string): boolean => fake.sessions.some(session => session.id === id);
  const listenersOf = (method: string): Set<(value: never) => void> => {
    const known = publishedListeners.get(method);
    if (known !== undefined) return known;
    const created = new Set<(value: never) => void>();
    publishedListeners.set(method, created);
    return created;
  };

  const choose = vi.fn<LinkApi["choose"]>(session => {
    if (!isOpen(session)) return Promise.reject(notOpen(session, "choose_session"));
    fake.chosen = session;
    return Promise.resolve(MANIFEST);
  });
  const runIn = vi.fn<LinkApi["runIn"]>((session, id) => {
    if (!isOpen(session)) return Promise.reject(notOpen(session, "no_session"));
    return Promise.resolve(resultOf(id === "game.pause"));
  });
  const callEditor = vi.fn<LinkApi["callEditor"]>(method => Promise.resolve(connectAnswer(method)));

  const api = {
    sessions: () => [...fake.sessions],
    session: () => fake.chosen,
    ownSession: () => fake.own,
    choose,
    runIn,
    callEditor,
    onSessions: (fn: (list: readonly SessionInfo[]) => void) => {
      const entry = (list: readonly SessionInfo[]): void => fn(list);
      sessionListeners.add(entry);
      return () => {
        sessionListeners.delete(entry);
      };
    },
    published: (method: string) => {
      if (method === "devices") return fake.devices;
      if (method === "deviceTelemetry") return fake.deviceTelemetry;
      return undefined;
    },
    onPublished: (method: string, fn: (value: never) => void) => {
      const entry = (value: never): void => fn(value);
      listenersOf(method).add(entry);
      return () => {
        listenersOf(method).delete(entry);
      };
    },
    onHeartbeat: (fn: (beat: ReceivedHeartbeat) => void) => {
      const entry = (beat: ReceivedHeartbeat): void => fn(beat);
      heartbeatListeners.add(entry);
      return () => {
        heartbeatListeners.delete(entry);
      };
    }
  };

  const fake: FakeLink = {
    api: api as unknown as LinkApi,
    sessions: [],
    chosen: undefined,
    own: undefined,
    devices: undefined,
    deviceTelemetry: undefined,
    choose,
    runIn,
    callEditor,
    sessionListeners,
    publishedListeners,
    heartbeatListeners,
    list(next, own) {
      fake.sessions = next;
      if (own !== undefined) fake.own = own;
      if (fake.own !== undefined && !isOpen(fake.own)) fake.own = undefined;
      if (fake.chosen !== undefined && !isOpen(fake.chosen)) fake.chosen = undefined;
      const frozen = Object.freeze([...next]);
      for (const listener of sessionListeners) listener(frozen);
    },
    publishDevices(value) {
      fake.devices = value;
      for (const listener of listenersOf("devices")) listener(value as never);
    },
    publishTelemetry(value) {
      fake.deviceTelemetry = value;
      for (const listener of listenersOf("deviceTelemetry")) listener(value as never);
    },
    heartbeat(beat) {
      for (const listener of heartbeatListeners) listener(Object.freeze({ ...beat }));
    },
    commands: () => runIn.mock.calls.map(([session, id]) => `${session} ${id}`),
    methods: () => callEditor.mock.calls.map(([method]) => method)
  };
  return fake;
}

/**
 * An activeSource ctx over a fake link, with a real state and mock emit and log.
 *
 * @param config - Config overrides.
 * @returns The ctx and the fake link.
 */
export function createCtx(config: Partial<ActiveSourceConfig> = {}): {
  ctx: TestCtx;
  link: FakeLink;
} {
  const link = createFakeLink();
  const require = vi.fn(() => link.api) as unknown as Require;
  const ctx: TestCtx = {
    config: { ...CONFIG, ...config },
    state: createActiveSourceState(),
    emit: vi.fn<
      (
        name: keyof ActiveSourceEvents,
        payload: ActiveSourceEvents[keyof ActiveSourceEvents]
      ) => void
    >(),
    log: createLog(),
    require
  };
  return { ctx, link };
}

/**
 * Lets pending promise callbacks run.
 */
export async function settle(): Promise<void> {
  for (let index = 0; index < 30; index += 1) await Promise.resolve();
}

/**
 * The `activeSource:changed` payloads a ctx emitted, in order.
 *
 * @param ctx - The ctx.
 * @returns The reasons and target kinds, as `reason→kind:session`.
 */
export function changes(ctx: TestCtx): string[] {
  return ctx.emit.mock.calls.flatMap(([name, payload]) => {
    if (name !== "activeSource:changed" || !("reason" in payload)) return [];
    return [`${payload.reason}→${payload.to.kind}:${String(payload.to.session)}`];
  });
}
