/* eslint-disable unicorn/no-null, sonarjs/no-hardcoded-ip -- null is a JSON value on the wire; the addresses are fixtures */
import type { Mock } from "vitest";
import { vi } from "vitest";
import type { Require } from "../../../config";
import { activeSourcePlugin } from "../../activeSource";
import type {
  ActiveSource,
  ActiveSourceApi,
  LocalPreview,
  SourceLabel,
  SourceNotice
} from "../../activeSource/types";
import type { DeviceDirectory } from "../../connect/protocol";
import type { SessionDevice } from "../../hub/protocol";
import type { LinkApi } from "../../link/types";
import type {
  CommandDescriptor,
  Json,
  LinkStatus,
  Manifest,
  RelayedEditorMethod,
  RunResult,
  SessionInfo,
  Tap,
  ToolsBoot
} from "../../registry/protocol";
import { createWorkspaceState } from "../state";
import type { WorkspaceConfig, WorkspaceCtx } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Shared test helpers of workspace: a log mock, a scripted link api, a scripted
// activeSource api, a domain ctx with a real state, and wire fixtures
// (manifest, run result, boot, sessions, devices).
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

/** The default config of the plugin. */
export const CONFIG: WorkspaceConfig = {
  defaultWorkspace: "game",
  storageKey: "moku-editor-test",
  reloadTimeoutMs: 15_000,
  hotReloadWaitMs: 1500,
  toastMs: 2600
};

/** The boot the link mock answers. */
export const BOOT: ToolsBoot = {
  v: 1,
  ws: "ws://127.0.0.1:3000/__editor/ws",
  token: "tok",
  path: "/__editor",
  title: "moku editor",
  editorUrl: "vscode://file/{path}:{line}",
  root: "/work/game",
  gameUrl: "/game/"
};

/**
 * A command descriptor.
 *
 * @param id - Command id.
 * @param effect - Its effect.
 * @returns The descriptor.
 */
export function commandOf(
  id: string,
  effect: CommandDescriptor["effect"] = "raw"
): CommandDescriptor {
  return { id, title: id, input: {}, effect };
}

/**
 * A manifest listing the given commands.
 *
 * @param commands - Command ids.
 * @param embedded - The embedded flag.
 * @returns The manifest.
 */
export function manifestOf(
  commands: readonly string[] = ["game.step", "game.pause", "game.resume", "editor.overlay"],
  embedded = true
): Manifest {
  return {
    game: "merge-game 0.0.0",
    page: "http://127.0.0.1:3000/",
    embedded,
    sources: [{ id: "game.position", title: "Position", input: {}, changes: "commit" }],
    commands: commands.map(id => commandOf(id, id === "editor.overlay" ? "cosmetic" : "raw"))
  };
}

/**
 * A run result.
 *
 * @param value - The value.
 * @param frame - The frame of the envelope.
 * @returns The result.
 */
export function resultOf(value: Json = null, frame = 1841): RunResult {
  return { value, state: { path: "board/awaitIntent", frame, tainted: false } };
}

/** The frame id of the link mock: `frameUrl` tags with it, `isOtherTab` compares against it. */
export const FRAME = "f-test";

/**
 * A page URL tagged with a frame id and, with a player, the scenario, as link's `frameUrl` builds
 * it.
 *
 * @param url - The page URL.
 * @param frame - The frame id; default the mock's own.
 * @param player - The scenario; none when absent or "".
 * @returns The tagged URL.
 */
export function tagged(url: string, frame = FRAME, player?: string): string {
  const parsed = new URL(url);
  if (player !== undefined && player !== "") parsed.searchParams.set("player", player);
  parsed.searchParams.set("__editorFrame", frame);
  return parsed.href;
}

/** A tap listener, as link's `onTap` takes it. */
type TapListener = (tap: Tap) => void;

/**
 * `handle` of link as a mock records it. The params and the result of a handler follow its method,
 * so the mock keeps it as a function of unknown params; a test reads it back as `RequestHandler<M>`.
 */
type HandleCall = (method: RelayedEditorMethod, handler: (params: never) => unknown) => () => void;

/** A scripted link api: plain fields the test sets, mocks for the calls. */
export type LinkMock = {
  [K in keyof Omit<LinkApi, "files" | "handle" | "published" | "onPublished">]: Mock<LinkApi[K]>;
} & {
  files: LinkApi["files"];
  handle: Mock<HandleCall>;
  /** Generic over the publish method, so a plain field: `Mock<>` would drop its type parameter. */
  published: LinkApi["published"];
  /** Generic over the publish method, so a plain field (see `published`). */
  onPublished: LinkApi["onPublished"];
  /** Live tap listeners. */
  readonly tapListeners: Set<TapListener>;
  /** Calls every tap listener, like link on a game tap. */
  tap(tap: Tap): void;
  /** The status `status()` answers. */
  current: LinkStatus;
  /** The manifest `manifest()` answers. */
  manifestValue: Manifest | undefined;
  /** The boot `boot()` answers. */
  bootValue: ToolsBoot | undefined;
  /** The sessions `sessions()` answers. */
  sessionList: SessionInfo[];
  /** The id `engine()` answers. */
  engineValue: string | undefined;
  /** The device directory `published("devices")` answers. */
  directoryValue: DeviceDirectory | undefined;
  /** Live engine listeners. */
  readonly engineListeners: Set<(engine: string | undefined) => void>;
  /** Sets the engine id and calls every engine listener, like link on `editor.engine`. */
  publishEngine(engine: string | undefined): void;
  /** Live manifest listeners. */
  readonly manifestListeners: Set<(manifest: Manifest | undefined) => void>;
  /** Sets the manifest and calls every listener, like link on an attach. */
  attach(manifest: Manifest | undefined): void;
};

/**
 * A scripted link api.
 *
 * @returns The mock.
 */
export function createLinkMock(): LinkMock {
  const listeners = new Set<(manifest: Manifest | undefined) => void>();
  const tapListeners = new Set<TapListener>();
  const engineListeners = new Set<(engine: string | undefined) => void>();
  const link: LinkMock = {
    current: { kind: "connecting" },
    manifestValue: undefined,
    bootValue: BOOT,
    sessionList: [],
    engineValue: undefined,
    engineListeners,
    manifestListeners: listeners,
    read: vi.fn<LinkApi["read"]>(() => Promise.resolve(null)),
    watch: vi.fn<LinkApi["watch"]>(() => vi.fn()),
    run: vi.fn<LinkApi["run"]>(() => Promise.resolve(resultOf())),
    status: vi.fn<LinkApi["status"]>(() => link.current),
    manifest: vi.fn<LinkApi["manifest"]>(() => link.manifestValue),
    onManifest: vi.fn<LinkApi["onManifest"]>(fn => {
      listeners.add(fn);
      if (link.manifestValue !== undefined) fn(link.manifestValue);
      return () => {
        listeners.delete(fn);
      };
    }),
    sessions: vi.fn<LinkApi["sessions"]>(() => link.sessionList),
    session: vi.fn<LinkApi["session"]>(() => link.sessionList[0]?.id),
    choose: vi.fn<LinkApi["choose"]>(() => Promise.resolve(manifestOf())),
    retry: vi.fn<LinkApi["retry"]>(),
    expectReload: vi.fn<LinkApi["expectReload"]>(),
    boot: vi.fn<LinkApi["boot"]>(() => link.bootValue),
    frameUrl: vi.fn<LinkApi["frameUrl"]>((url, opts) => tagged(url, FRAME, opts?.player)),
    isOtherTab: vi.fn<LinkApi["isOtherTab"]>(page => {
      const frame = new URL(page).searchParams.get("__editorFrame");
      return frame !== null && frame !== FRAME;
    }),
    files: {
      list: vi.fn(() => Promise.resolve([])),
      read: vi.fn(() => Promise.resolve({ text: "", version: "v" })),
      write: vi.fn(() => Promise.resolve({ path: "", bytes: 0, version: "v" })),
      writeBinary: vi.fn(() => Promise.resolve({ path: "", bytes: 0, version: "v" })),
      readBinary: vi.fn(() => Promise.resolve({ dataUrl: "", version: "v" })),
      find: vi.fn(() => Promise.resolve([]))
    },
    onTap: vi.fn<LinkApi["onTap"]>(listener => {
      tapListeners.add(listener);
      return () => {
        tapListeners.delete(listener);
      };
    }),
    heap: vi.fn<LinkApi["heap"]>(() => undefined),
    hotReload: vi.fn<LinkApi["hotReload"]>(() => undefined),
    onHotReload: vi.fn<LinkApi["onHotReload"]>(() => vi.fn()),
    setHotReload: vi.fn<LinkApi["setHotReload"]>(() => Promise.resolve(false)),
    selection: vi.fn<LinkApi["selection"]>(() => undefined),
    project: vi.fn<LinkApi["project"]>(() => undefined),
    engine: vi.fn<LinkApi["engine"]>(() => link.engineValue),
    onEngine: vi.fn<LinkApi["onEngine"]>(listener => {
      engineListeners.add(listener);
      if (link.engineValue !== undefined) listener(link.engineValue);
      return () => {
        engineListeners.delete(listener);
      };
    }),
    directoryValue: undefined,
    published: (method =>
      method === "devices" ? link.directoryValue : undefined) as LinkApi["published"],
    onPublished: () => vi.fn(),
    onSessions: vi.fn<LinkApi["onSessions"]>(() => vi.fn()),
    onHeartbeat: vi.fn<LinkApi["onHeartbeat"]>(() => vi.fn()),
    ownSession: vi.fn<LinkApi["ownSession"]>(() => undefined),
    runIn: vi.fn<LinkApi["runIn"]>(() => Promise.resolve(resultOf())),
    callEditor: vi.fn<LinkApi["callEditor"]>(() => Promise.resolve(null)),
    notify: vi.fn<LinkApi["notify"]>(),
    handle: vi.fn<HandleCall>(() => vi.fn()),
    tapListeners,
    publishEngine(engine) {
      link.engineValue = engine;
      for (const listener of engineListeners) listener(engine);
    },
    tap(tap) {
      for (const listener of tapListeners) listener(tap);
    },
    attach(manifest) {
      link.manifestValue = manifest;
      for (const fn of listeners) fn(manifest);
    }
  };
  return link;
}

/** The Galaxy A26 of the frozen demo, linked by wire. */
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

/**
 * This page's own game frame session (the local preview): embedded, tagged with the mock's frame.
 *
 * @param id - Session id.
 * @returns The session.
 */
export function ownSessionOf(id = "s-1"): SessionInfo {
  return {
    id,
    game: "merge-game 0.0.0",
    page: tagged("http://127.0.0.1:3000/game/"),
    embedded: true,
    connectedAt: 1000
  };
}

/**
 * A device session.
 *
 * @param id - Session id.
 * @param device - The device.
 * @returns The session.
 */
export function deviceSessionOf(id = "s-9", device: SessionDevice = A26): SessionInfo {
  return {
    id,
    game: "merge-game 0.0.0",
    page: "http://localhost/index.html",
    embedded: false,
    connectedAt: 2000,
    device
  };
}

/** The label activeSource gives the local preview. */
export const LOCAL_LABEL: SourceLabel = {
  name: "Local preview",
  model: null,
  kind: "local",
  link: { kind: "local", transport: "frame", address: null }
};

/** A scripted activeSource api: plain fields the test sets, mocks for every member. */
export type SourceMock = { [K in keyof ActiveSourceApi]: Mock<ActiveSourceApi[K]> } & {
  /** The source `current()` answers. */
  currentValue: ActiveSource;
  /** The local preview state `preview()` answers. */
  previewValue: LocalPreview;
  /** The label `label()` answers. */
  labelValue: SourceLabel;
  /** The notice `notice()` answers. */
  noticeValue: SourceNotice | undefined;
};

/**
 * A scripted activeSource api: the local preview without a session, running nothing, no notice.
 *
 * @returns The mock.
 */
export function createSourceMock(): SourceMock {
  const source: SourceMock = {
    currentValue: { kind: "local", session: null },
    previewValue: { state: "none" },
    labelValue: LOCAL_LABEL,
    noticeValue: undefined,
    current: vi.fn<ActiveSourceApi["current"]>(() => source.currentValue),
    preview: vi.fn<ActiveSourceApi["preview"]>(() => source.previewValue),
    useDevice: vi.fn<ActiveSourceApi["useDevice"]>(() => Promise.resolve()),
    useLocal: vi.fn<ActiveSourceApi["useLocal"]>(() => Promise.resolve()),
    onChange: vi.fn<ActiveSourceApi["onChange"]>(() => vi.fn()),
    directory: vi.fn<ActiveSourceApi["directory"]>(() => undefined),
    scan: vi.fn<ActiveSourceApi["scan"]>(() => vi.fn()),
    connectWire: vi.fn<ActiveSourceApi["connectWire"]>(() =>
      Promise.resolve({ port: 47_600, adb: "127.0.0.1:47600", lan: null })
    ),
    connectNetwork: vi.fn<ActiveSourceApi["connectNetwork"]>(() =>
      Promise.resolve({ port: 47_600, adb: "127.0.0.1:47600", lan: "192.168.1.5:47600" })
    ),
    confirmPairing: vi.fn<ActiveSourceApi["confirmPairing"]>(() => Promise.resolve(true)),
    refusePairing: vi.fn<ActiveSourceApi["refusePairing"]>(() => Promise.resolve()),
    stopDevices: vi.fn<ActiveSourceApi["stopDevices"]>(() => Promise.resolve()),
    telemetry: vi.fn<ActiveSourceApi["telemetry"]>(() => undefined),
    onTelemetry: vi.fn<ActiveSourceApi["onTelemetry"]>(() => vi.fn()),
    markers: vi.fn<ActiveSourceApi["markers"]>(() => []),
    notice: vi.fn<ActiveSourceApi["notice"]>(() => source.noticeValue),
    dismissNotice: vi.fn<ActiveSourceApi["dismissNotice"]>(() => {
      source.noticeValue = undefined;
    }),
    reconnect: vi.fn<ActiveSourceApi["reconnect"]>(() => Promise.resolve(false)),
    connectDevice: vi.fn<ActiveSourceApi["connectDevice"]>(() => Promise.resolve()),
    label: vi.fn<ActiveSourceApi["label"]>(() => source.labelValue),
    health: vi.fn<ActiveSourceApi["health"]>(() => ({
      kind: "local",
      latencyMs: null,
      samples: new Float32Array(48),
      head: 0
    })),
    clockOffsetMs: vi.fn<ActiveSourceApi["clockOffsetMs"]>(() => 0),
    openConnect: vi.fn<ActiveSourceApi["openConnect"]>()
  };
  return source;
}

/**
 * Makes a device the source in the mocks: the session listed in link, current and label in
 * activeSource.
 *
 * @param ctx - The test ctx.
 * @param session - The device session (listed if it is not yet).
 * @param name - The display name the label carries.
 */
export function useDeviceSource(ctx: TestCtx, session: SessionInfo, name: string): void {
  const device = session.device;
  if (device === undefined) throw new Error("not a device session");
  if (!ctx.link.sessionList.some(item => item.id === session.id)) {
    ctx.link.sessionList = [...ctx.link.sessionList, session];
  }
  ctx.source.currentValue = { kind: "device", session: session.id, device };
  ctx.source.labelValue = {
    name,
    model: device.model,
    kind: "device",
    link:
      device.link === "adb"
        ? { kind: "wire", transport: "adb", address: device.address }
        : { kind: "network", transport: "lan", address: device.address }
  };
}

/** The emit mock: callable as the typed emit, inspectable as a mock. */
export type EmitMock = WorkspaceCtx["emit"] & Mock<(name: string, payload: unknown) => void>;

/** A workspace ctx whose emit, log, link and activeSource are mocks. */
export type TestCtx = Omit<WorkspaceCtx, "emit" | "log"> & {
  readonly emit: EmitMock;
  readonly log: LogMock;
  readonly link: LinkMock;
  readonly source: SourceMock;
};

/**
 * A workspace domain ctx with a real state and mock emit, log, link and activeSource: `require`
 * answers the activeSource mock for `activeSourcePlugin` and the link mock for anything else.
 *
 * @param config - Config overrides.
 * @param link - The link mock to use.
 * @returns The ctx.
 */
export function createCtx(
  config: Partial<WorkspaceConfig> = {},
  link: LinkMock = createLinkMock()
): TestCtx {
  const resolved: WorkspaceConfig = { ...CONFIG, ...config };
  const source = createSourceMock();
  const require = vi.fn((plugin: unknown) =>
    plugin === activeSourcePlugin ? source : link
  ) as unknown as Require;

  return {
    config: resolved,
    state: createWorkspaceState({ config: resolved }),
    emit: vi.fn() as unknown as EmitMock,
    log: createLog(),
    require,
    link,
    source
  };
}

/**
 * Lets pending promise callbacks run (no timers involved).
 */
export async function flush(): Promise<void> {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

/**
 * A DOMRect-like box for getBoundingClientRect stubs.
 *
 * @param left - Left edge.
 * @param top - Top edge.
 * @param width - Width.
 * @param height - Height.
 * @returns The rect.
 */
export function rectOf(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    width,
    height,
    x: left,
    y: top,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({})
  };
}

/**
 * Makes an element report a fixed bounding rect.
 *
 * @param element - The element.
 * @param rect - The rect it reports.
 */
export function stubRect(element: Element, rect: DOMRect): void {
  element.getBoundingClientRect = () => rect;
}

/**
 * A keydown event for the dispatcher.
 *
 * @param key - `event.key`.
 * @param init - Modifier flags, code and target.
 * @returns The event.
 */
export function keyEvent(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
}
