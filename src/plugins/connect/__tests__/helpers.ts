/* eslint-disable unicorn/no-null -- null is "none" in the hub's and the wire's shapes */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Mock } from "vitest";
import { vi } from "vitest";
import type { Require } from "../../../config";
import { hubPlugin } from "../../hub";
import type {
  DeviceListen,
  EditorMethods,
  HubApi,
  HubDeviceEvent,
  LinkedDevice,
  PairConfirm
} from "../../hub/types";
import type { PublishMethod, PublishParams, SessionInfo } from "../../registry/protocol";
import { createConnectHooks } from "../handlers";
import { createConnectState } from "../state";
import type {
  AdbResult,
  AdbRunner,
  CdpOpen,
  CdpSocketEvents,
  ConnectConfig,
  ConnectCtx,
  ConnectEvents,
  FetchJson
} from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Shared fakes of the connect tests: the adb fixtures, a recording adb runner
// that answers the A26's fixtures by argv, a fake hub (device mode, devices,
// sessions, publish, editor methods) that emits hub:device into connect's
// hook, a fake CDP socket opener, and a connect ctx built from them.
// ─────────────────────────────────────────────────────────────────────────────

/** The default config of the plugin (same values as index.ts). */
export const DEFAULT_CONFIG: ConnectConfig = {
  adb: "adb",
  adbTimeoutMs: 5000,
  scanEveryMs: 2000,
  answerTimeoutMs: 20_000,
  leaseMs: 10_000,
  telemetryEveryMs: 1000,
  meminfoEveryMs: 5000,
  heapEveryMs: 250,
  gcDropMb: 0.5,
  gcTrace: false,
  wire: "manual"
};

/** The A26 on USB. */
export const SERIAL = "R5CX30ABCDE";

/** The A26's app pid, its WebView renderer and surfaceflinger in ps-a26.txt. */
export const PIDS = { app: 23_811, renderer: 23_870, surfaceflinger: 612 } as const;

/** The listen of device mode by wire. */
export const LISTEN: DeviceListen = { port: 47_600, adb: "127.0.0.1:47600", lan: null };

/** The page of the A26's device session. */
export const PAGE = "http://tauri.localhost/";

/**
 * The text of an adb fixture.
 *
 * @param name - The file under fixtures/adb.
 * @returns Its text.
 */
export function fixture(name: string): string {
  return readFileSync(path.join(import.meta.dirname, "fixtures/adb", name), "utf8");
}

/**
 * An answer with exit code 0.
 *
 * @param text - Standard output.
 * @returns The result.
 */
export function ok(text: string): AdbResult {
  return { code: 0, text, missing: false };
}

/** adb not on PATH. */
export const MISSING: AdbResult = { code: 127, text: "", missing: true };

/**
 * A `/proc/<pid>/stat` line.
 *
 * @param pid - The pid.
 * @param ticks - utime and stime.
 * @param ticks.utime - User ticks.
 * @param ticks.stime - System ticks.
 * @param start - Field 22, the start time in clock ticks.
 * @returns The line.
 */
export function statLine(
  pid: number,
  ticks: { readonly utime: number; readonly stime: number },
  start: number
): string {
  return `${pid} (proc ${pid}) S 1 1 0 0 -1 0 0 0 0 0 ${ticks.utime} ${ticks.stime} 0 0 10 0 8 0 ${start} 0 0`;
}

/**
 * The text `head -n 1` prints for files (a section header before each).
 *
 * @param files - Path → first line; a path left out was unreadable.
 * @returns The output.
 */
export function headText(files: Readonly<Record<string, string>>): string {
  return Object.entries(files)
    .map(([file, line]) => `==> ${file} <==\n${line}\n`)
    .join("\n");
}

/** The start times of the A26's processes (field 22). */
const STARTS: ReadonlyMap<number, number> = new Map([
  [23_811, 52_000],
  [23_870, 52_080],
  [24_102, 61_000],
  [24_390, 30_000]
]);

/**
 * Answers a `head -n 1` of the A26: start times of pids, the Mali nodes, or a tick.
 *
 * @param paths - The paths asked.
 * @returns The output.
 */
function a26Head(paths: readonly string[]): string {
  if (paths.some(file => file.startsWith("/sys/class/kgsl"))) {
    return headText({
      "/sys/kernel/gpu/gpu_clock": "221",
      "/sys/kernel/gpu/gpu_busy": "63 %",
      "/sys/kernel/gpu/gpu_min_clock": "221",
      "/sys/kernel/gpu/gpu_max_clock": "949"
    });
  }
  if (paths.includes("/proc/stat")) return fixture("head-tick-1.txt");

  const files: Record<string, string> = {};
  for (const file of paths) {
    const pid = Number(/^\/proc\/(\d+)\/stat$/.exec(file)?.[1]);
    const start = STARTS.get(pid);
    if (start !== undefined) files[file] = statLine(pid, { utime: 10, stime: 5 }, start);
  }
  return headText(files);
}

/**
 * Answers a shell command of the A26 by its words; another serial's getprop is a Galaxy A25.
 *
 * @param serial - The serial asked.
 * @param words - The words after `-s <serial> shell`.
 * @returns The result.
 */
function a26Shell(serial: string, words: readonly string[]): AdbResult {
  const [command, ...rest] = words;
  switch (command) {
    case "getprop": {
      const props = fixture("getprop-a26.txt");
      return ok(
        serial === SERIAL ? props : props.replaceAll("A266B", "A256B").replace("A26", "A25")
      );
    }
    case "cat": {
      return ok(fixture("proc-net-unix-socket.txt"));
    }
    case "ps": {
      return ok(fixture("ps-a26.txt"));
    }
    case "head": {
      const paths = rest.slice(2);
      return ok(rest[1] === "64" ? fixture("proc-stat-64.txt") : a26Head(paths));
    }
    case "ls": {
      return ok(fixture("devfreq-ls.txt"));
    }
    case "dumpsys": {
      return ok(fixture(rest[1] === String(PIDS.app) ? "meminfo-app.txt" : "meminfo-renderer.txt"));
    }
    default: {
      return { code: 1, text: "", missing: false };
    }
  }
}

/**
 * The A26 as adb answers it: devices -l, getprop, sockets, ps, head, ls, dumpsys and forwards.
 *
 * @param args - The argv after the adb command.
 * @returns The result.
 */
export function a26(args: readonly string[]): AdbResult {
  const key = args.join(" ");
  if (key === "version") return ok("Android Debug Bridge version 1.0.41\n");
  if (key === "devices -l") return ok(fixture("devices-l.txt"));
  if (args[2] === "forward") return ok(args[3] === "--remove" ? "" : "40211\n");
  if (args[2] === "shell") return a26Shell(args[1] ?? "", args.slice(3));
  return { code: 1, text: "", missing: false };
}

/** A recording adb runner. */
export type FakeRunner = Mock<AdbRunner> & {
  /** The argv of every call, in order. */
  readonly calls: () => string[][];
};

/**
 * A recording adb runner over an answer function.
 *
 * @param answer - argv → result (or a promise of one).
 * @returns The runner.
 */
export function fakeRunner(
  answer: (args: readonly string[]) => AdbResult | Promise<AdbResult> = a26
): FakeRunner {
  const run = vi.fn<AdbRunner>(async (_command, args) => answer(args));
  return Object.assign(run, {
    calls: () => run.mock.calls.map(call => [...call[1]])
  });
}

/** One publish the fake hub recorded. */
export type Published = { readonly method: PublishMethod; readonly params: unknown };

/** The fake hub: device mode, devices, sessions, publish and editor methods. */
export type FakeHub = {
  readonly listenDevices: Mock<HubApi["listenDevices"]>;
  readonly listenLan: Mock<HubApi["listenLan"]>;
  readonly stopLan: Mock<HubApi["stopLan"]>;
  readonly stopDevices: Mock<HubApi["stopDevices"]>;
  readonly devices: Mock<() => LinkedDevice[]>;
  readonly sessions: Mock<() => SessionInfo[]>;
  readonly publish: Mock<(method: PublishMethod, params: PublishParams[PublishMethod]) => void>;
  readonly addEditorMethods: Mock<(methods: EditorMethods) => void>;
  /** The devices `devices()` answers. */
  readonly linked: LinkedDevice[];
  /** The sessions `sessions()` answers. */
  readonly open: SessionInfo[];
  /** Every publish, in order. */
  readonly published: Published[];
  /** The editor methods registered. */
  readonly methods: Map<string, EditorMethods[string]>;
  /** The confirm passed to listenDevices. */
  confirm: PairConfirm | undefined;
  /** Where hub:device goes (connect's hook once the ctx is built). */
  emit: (event: HubDeviceEvent) => void;
};

/**
 * A fake hub. listenDevices / listenLan / stopLan / stopDevices emit hub:device like the hub.
 *
 * @returns The fake hub.
 */
export function fakeHub(): FakeHub {
  const published: Published[] = [];
  const methods = new Map<string, EditorMethods[string]>();
  let listen: DeviceListen | undefined;
  const hub: FakeHub = {
    linked: [],
    open: [],
    published,
    methods,
    confirm: undefined,
    emit: () => undefined,
    listenDevices: vi.fn<HubApi["listenDevices"]>(async options => {
      hub.confirm = options.confirm;
      listen = LISTEN;
      hub.emit({ kind: "listening", listen });
      return listen;
    }),
    listenLan: vi.fn<HubApi["listenLan"]>(async () => {
      listen = { ...LISTEN, lan: "192.168.1.5:47600" };
      hub.emit({ kind: "listening", listen });
      return listen;
    }),
    stopLan: vi.fn<HubApi["stopLan"]>(async () => {
      listen = { ...LISTEN, lan: null };
      hub.emit({ kind: "listening", listen });
    }),
    stopDevices: vi.fn<HubApi["stopDevices"]>(async () => {
      listen = undefined;
      hub.emit({ kind: "stopped" });
    }),
    devices: vi.fn(() => hub.linked.map(device => ({ ...device }))),
    sessions: vi.fn(() => hub.open.map(session => ({ ...session }))),
    publish: vi.fn((method: PublishMethod, params: PublishParams[PublishMethod]) => {
      published.push({ method, params });
    }),
    addEditorMethods: vi.fn((added: EditorMethods) => {
      for (const [name, method] of Object.entries(added)) methods.set(name, method);
    })
  };
  return hub;
}

/**
 * The A26 as the hub lists it once paired by wire.
 *
 * @param overrides - Fields to change.
 * @returns The linked device.
 */
export function a26Device(overrides: Partial<LinkedDevice> = {}): LinkedDevice {
  return {
    id: "d-7f3a",
    model: "SM-A266B",
    link: "adb",
    address: "127.0.0.1",
    port: 47_600,
    engine: "0.15.0+9c41e0",
    build: "debug-20261016T090000Z",
    pairedAt: 1_791_986_083_963,
    online: true,
    latencyMs: 9,
    ...overrides
  };
}

/**
 * The A26's device session.
 *
 * @param device - The linked device.
 * @param id - The session id.
 * @returns The session.
 */
export function deviceSession(device: LinkedDevice, id = "s-9"): SessionInfo {
  return {
    id,
    game: "garden 0.0.0",
    page: `${PAGE}#/play`,
    embedded: false,
    connectedAt: 1_791_986_084_000,
    device: {
      id: device.id,
      model: device.model,
      link: device.link,
      address: device.address,
      port: device.port,
      engine: device.engine,
      build: device.build
    }
  };
}

/** A fake CDP socket the tests drive. */
export type FakeSocket = {
  readonly url: string;
  readonly sent: string[];
  readonly events: CdpSocketEvents;
  closed: boolean;
  /**
   * Answers the last request of a method with a result.
   *
   * @param method - The CDP method.
   * @param result - The result object.
   */
  answer(method: string, result: unknown): void;
};

/** A fake opener and the sockets it opened. */
export type FakeCdp = {
  readonly open: Mock<CdpOpen>;
  readonly sockets: FakeSocket[];
};

/**
 * A fake CDP opener: each socket opens on the next microtask; with `respond`, every request is
 * answered at once with what it returns.
 *
 * @param respond - method → result; undefined leaves requests unanswered.
 * @returns The opener and its sockets.
 */
export function fakeCdp(respond?: (method: string) => unknown): FakeCdp {
  const sockets: FakeSocket[] = [];
  const open = vi.fn<CdpOpen>((url, events) => {
    const socket: FakeSocket = {
      url,
      sent: [],
      events,
      closed: false,
      answer(method, result) {
        const request = socket.sent
          .map(text => JSON.parse(text) as { id: number; method: string })
          .findLast(sent => sent.method === method);
        if (request !== undefined) events.onMessage(JSON.stringify({ id: request.id, result }));
      }
    };
    sockets.push(socket);
    queueMicrotask(() => events.onOpen());
    return {
      send(text: string) {
        socket.sent.push(text);
        if (respond === undefined) return;
        const { id, method } = JSON.parse(text) as { id: number; method: string };
        queueMicrotask(() => events.onMessage(JSON.stringify({ id, result: respond(method) })));
      },
      close() {
        if (socket.closed) return;
        socket.closed = true;
        events.onClose();
      }
    };
  });
  return { open, sockets };
}

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

/** The emit of connect as one signature a mock can take. */
export type EmitMock = Mock<
  (name: keyof ConnectEvents, payload: ConnectEvents[keyof ConnectEvents]) => void
>;

/** A connect ctx whose emit, log, hub and seams are fakes. */
export type TestCtx = ConnectCtx & {
  readonly emit: EmitMock;
  readonly log: ReturnType<typeof createLog>;
  readonly hub: FakeHub;
  readonly run: FakeRunner;
  readonly cdp: FakeCdp;
};

/** Options of a test ctx. */
export type CtxOptions = {
  readonly config?: Partial<ConnectConfig>;
  readonly run?: FakeRunner;
  readonly cdp?: FakeCdp;
  readonly fetchJson?: FetchJson;
};

/**
 * A connect ctx with fresh state over fakes; hub:device of the fake hub goes into connect's hook.
 *
 * @param options - Config fields, the runner, the CDP opener and the JSON fetch.
 * @returns The ctx.
 */
export function createCtx(options: CtxOptions = {}): TestCtx {
  const hub = fakeHub();
  const run = options.run ?? fakeRunner();
  const cdp = options.cdp ?? fakeCdp();
  const require = ((plugin: unknown) => {
    if (plugin === hubPlugin) return hub;
    throw new Error("unknown plugin");
  }) as unknown as Require;
  const state = createConnectState();
  state.deps = {
    run,
    openSocket: cdp.open,
    fetchJson:
      options.fetchJson ??
      (async () => [
        { type: "page", url: PAGE, webSocketDebuggerUrl: "ws://127.0.0.1:40211/devtools/page/7" }
      ])
  };

  const ctx: TestCtx = {
    config: { ...DEFAULT_CONFIG, ...options.config },
    state,
    emit: vi.fn(),
    log: createLog(),
    require,
    hub,
    run,
    cdp
  };
  const hooks = createConnectHooks(ctx);
  hub.emit = event => hooks["hub:device"](event);
  return ctx;
}

/**
 * The params of every publish of a method.
 *
 * @param hub - The fake hub.
 * @param method - The method.
 * @returns The params, oldest first.
 */
export function publishedOf<M extends PublishMethod>(hub: FakeHub, method: M): PublishParams[M][] {
  return hub.published
    .filter(entry => entry.method === method)
    .map(entry => entry.params as PublishParams[M]);
}
