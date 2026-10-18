/* eslint-disable unicorn/no-null -- null is a JSON value on the wire */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Mock } from "vitest";
import { vi } from "vitest";
import type { Require } from "../../../config";
import { activeSourcePlugin } from "../../activeSource";
import type {
  ActiveSource,
  ActiveSourceApi,
  SourceLabel,
  SourceMarker
} from "../../activeSource/types";
import type { DeviceDirectory, DeviceTelemetry } from "../../connect/protocol";
import { linkPlugin } from "../../link";
import { panelsPlugin } from "../../panels";
import {
  createLinkMock,
  createLog,
  type LinkMock,
  type LogMock,
  manifestOf
} from "../../panels/__tests__/helpers";
import type { Calibration, PageRect, SceneSnapshot } from "../../panels/shared/scene";
import { buildScene } from "../../panels/shared/scene";
import type { PanelSpec } from "../../panels/types";
import type { Json, ProjectState } from "../../registry/protocol";
import { workspacePlugin } from "../../workspace";
import type {
  PaletteItem,
  Prefs,
  PreviewPrefs,
  PreviewWorkspace,
  WorkspaceApi,
  WorkspaceId
} from "../../workspace/types";
import { createRenderViewState } from "../state";
import type { RenderViewConfig, RenderViewCtx } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Shared test helpers of renderView: the board capture of merge-game (the panels
// fixture, read only), a workspace mock with a real overlay element, a panels
// mock, a manual animation-frame queue and a domain ctx over a real state.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The unsubscribe of a listener that never fires.
 */
function stopNothing(): void {}

/** The default config of the plugin. */
export const CONFIG: RenderViewConfig = {
  releaseLogMax: 50
};

/**
 * A project index state that names the asset manifest.
 *
 * @param manifest - The root-relative manifest path; none when omitted.
 * @returns The on state.
 */
export function projectWith(manifest?: string): ProjectState {
  const state: ProjectState = { state: "on", revision: "r1", defs: {}, uses: {}, broken: {} };
  return manifest === undefined ? state : { ...state, manifest };
}

/** One capture of the three scene sources plus game.rect of some keys. */
export type Capture = {
  readonly path: string;
  readonly ui: Json;
  readonly entities: Json;
  readonly projections: Json;
  readonly rects: Readonly<Record<string, PageRect>>;
};

/**
 * The board capture of merge-game (board/awaitIntent, inert renderer).
 *
 * @returns The capture.
 */
export function boardCapture(): Capture {
  const parsed: Capture = JSON.parse(
    readFileSync(path.resolve("src/plugins/panels/__tests__/fixtures/scene-board.txt"), "utf8")
  );
  return parsed;
}

/** The identity calibration of the inert renderer. */
export const IDENTITY: Calibration = { scale: 1, x: 0, y: 0 };

/**
 * The board scene at a frame.
 *
 * @param frame - The frame.
 * @param calibration - The calibration (identity by default).
 * @returns The scene.
 */
export function boardScene(
  frame = 1841,
  calibration: Calibration | undefined = IDENTITY
): SceneSnapshot {
  const capture = boardCapture();
  const built = buildScene({
    ui: capture.ui,
    entities: capture.entities,
    projections: capture.projections,
    frame,
    calibration
  });
  if ("error" in built) throw new Error("board capture has the wrong shape");
  return built;
}

/** A game.render value. */
export const RENDER: Json = {
  fps: 60,
  frameMs: 3.4,
  textures: 12,
  textureMb: 41.25,
  views: 180,
  pooled: 24
};

/** A game.effects value (game 0.0.3): the board at rest, one steam stream, 24 card glows. */
export const EFFECTS: Json = { particles: 18, emitters: 1, filters: 24, renderPasses: 49 };

/** A game.assets value with two loaded bundles. */
export const ASSETS: Json = {
  textureMb: 6,
  budgetMb: 192,
  bundles: [
    { name: "board", tier: "scene", mb: 4, lastUsed: 12 },
    { name: "ui", tier: "core", mb: 2, lastUsed: 12 }
  ]
};

/** A version-1 asset manifest: board (2 textures), ui (1 texture + a font), home (1 texture). */
export const MANIFEST_TEXT = JSON.stringify({
  version: 1,
  bundles: {
    board: {
      tier: "scene",
      mb: 1.728,
      files: [
        { key: "board.board-tray", path: "board-tray.webp", width: 640, height: 631, mb: 1.541 },
        { key: "board.cell", path: "cell.webp", width: 224, height: 219, mb: 0.187 }
      ]
    },
    ui: {
      tier: "core",
      mb: 1.2,
      files: [
        { key: "ui.hud-pill", path: "hud-pill.webp", width: 1024, height: 1024, mb: 0.61 },
        { key: "ui.font-body", kind: "font", path: "body.woff2", mb: 0.59 }
      ]
    },
    home: {
      tier: "scene",
      mb: 3,
      files: [{ key: "home.bg", path: "bg.webp", width: 1024, height: 1536, mb: 3 }]
    }
  }
});

/** A workspace mock: a real overlay element, mocked calls. */
export type WorkspaceMock = {
  readonly api: WorkspaceApi;
  readonly overlay: HTMLElement;
  readonly items: PaletteItem[];
  readonly prefsListeners: Set<(prefs: Prefs) => void>;
  readonly show: Mock<(ws: WorkspaceId) => void>;
  readonly toast: Mock<(message: string, file?: string) => void>;
  readonly startLocalPreview: Mock<() => Promise<void>>;
  readonly setPreview: Mock<(ws: PreviewWorkspace, patch: Partial<PreviewPrefs>) => void>;
  activeValue: WorkspaceId;
  previewVisible: boolean;
  /** The editor theme `theme()` answers. */
  themeValue: "light" | "dark";
  /** Calls every prefs listener with a device. */
  prefs(preset: string, orientation: "portrait" | "landscape"): void;
  /** Switches the editor theme and calls every prefs listener, like the top bar's theme key. */
  setTheme(theme: "light" | "dark"): void;
};

/**
 * A workspace mock.
 *
 * @returns The mock.
 */
export function createWorkspaceMock(): WorkspaceMock {
  const overlay = document.createElement("div");
  const items: PaletteItem[] = [];
  const prefsListeners = new Set<(prefs: Prefs) => void>();
  const show = vi.fn((ws: WorkspaceId) => {
    workspace.activeValue = ws;
  });
  const setPreview = vi.fn((_ws: PreviewWorkspace, patch: Partial<PreviewPrefs>) => {
    if (patch.visible !== undefined) workspace.previewVisible = patch.visible;
  });
  const toast = vi.fn<(message: string, file?: string) => void>();
  const startLocalPreview = vi.fn(() => Promise.resolve());
  const workspace: WorkspaceMock = {
    overlay,
    items,
    prefsListeners,
    show,
    setPreview,
    toast,
    startLocalPreview,
    activeValue: "flow",
    previewVisible: true,
    themeValue: "light",
    api: {
      active: () => workspace.activeValue,
      theme: () => workspace.themeValue,
      show,
      preview: () => ({
        visible: workspace.previewVisible,
        size: "S",
        corner: "bottom-right",
        width: 150,
        height: 280
      }),
      setPreview,
      toast,
      startLocalPreview,
      gameFrame: () => ({
        url: "/game.html",
        reload: vi.fn(),
        dock: vi.fn(),
        overlay: () => overlay,
        box: () => undefined
      }),
      onPrefs: (fn: (prefs: Prefs) => void) => {
        prefsListeners.add(fn);
        return () => {
          prefsListeners.delete(fn);
        };
      },
      palette: {
        add: vi.fn((item: PaletteItem | readonly PaletteItem[]) => {
          const list: readonly PaletteItem[] = Array.isArray(item) ? item : [item as PaletteItem];
          items.push(...list);
          return () => {
            for (const entry of list) items.splice(items.indexOf(entry), 1);
          };
        }),
        open: vi.fn()
      }
    } as unknown as WorkspaceApi,
    setTheme(theme) {
      workspace.themeValue = theme;
      const prefs = {
        theme,
        previews: {},
        device: { preset: { id: "pixel-8" } }
      } as unknown as Prefs;
      for (const fn of prefsListeners) fn(prefs);
    },
    prefs(preset, orientation) {
      const prefs = {
        theme: workspace.themeValue,
        previews: {},
        device: { preset: { id: preset }, orientation }
      } as unknown as Prefs;
      for (const fn of prefsListeners) fn(prefs);
    }
  };
  return workspace;
}

/** An activeSource mock: what renderView reads, the source and its telemetry set by the test. */
export type ActiveSourceMock = {
  readonly api: ActiveSourceApi;
  current: ActiveSource;
  label: SourceLabel;
  directoryValue: DeviceDirectory | undefined;
  markersValue: SourceMarker[];
  offset: number | null;
  telemetryValue: DeviceTelemetry | undefined;
  readonly telemetryListeners: Set<(record: DeviceTelemetry) => void>;
  /** The stops scan() handed out that were called. */
  readonly scanStops: Mock<() => void>;
  /** Delivers a telemetry record to every listener. */
  sendTelemetry(record: DeviceTelemetry): void;
};

/** The label of the local preview. */
export const LOCAL_LABEL: SourceLabel = {
  name: "Local preview",
  model: null,
  kind: "local",
  link: { kind: "local", transport: "frame", address: null }
};

/**
 * An activeSource mock on the local preview of session "s-1".
 *
 * @returns The mock.
 */
export function createActiveSourceMock(): ActiveSourceMock {
  const telemetryListeners = new Set<(record: DeviceTelemetry) => void>();
  const scanStops = vi.fn();
  const mock: ActiveSourceMock = {
    current: { kind: "local", session: "s-1" },
    label: LOCAL_LABEL,
    directoryValue: undefined,
    markersValue: [],
    offset: 0,
    telemetryValue: undefined,
    telemetryListeners,
    scanStops,
    sendTelemetry(record) {
      mock.telemetryValue = record;
      for (const listener of telemetryListeners) listener(record);
    },
    api: {
      current: () => mock.current,
      preview: () => ({ state: "running" }),
      useDevice: vi.fn(() => Promise.resolve()),
      useLocal: vi.fn(() => Promise.resolve()),
      onChange: () => stopNothing,
      directory: () => mock.directoryValue,
      scan: vi.fn(() => scanStops),
      connectWire: vi.fn(() =>
        Promise.resolve({ port: 47_600, adb: "127.0.0.1:47600", lan: null })
      ),
      connectNetwork: vi.fn(() =>
        Promise.resolve({ port: 47_600, adb: "127.0.0.1:47600", lan: "192.168.1.5:47600" })
      ),
      confirmPairing: vi.fn(() => Promise.resolve(true)),
      refusePairing: vi.fn(() => Promise.resolve()),
      stopDevices: vi.fn(() => Promise.resolve()),
      telemetry: () => mock.telemetryValue,
      onTelemetry: (fn: (record: DeviceTelemetry) => void) => {
        telemetryListeners.add(fn);
        return () => {
          telemetryListeners.delete(fn);
        };
      },
      markers: () => mock.markersValue,
      notice: () => undefined,
      dismissNotice: vi.fn(),
      reconnect: vi.fn(() => Promise.resolve(false)),
      connectDevice: vi.fn(() => Promise.resolve()),
      label: () => mock.label,
      health: () => ({
        kind: "local",
        latencyMs: null,
        samples: new Float32Array(48).fill(Number.NaN),
        head: 0
      }),
      clockOffsetMs: () => mock.offset,
      openConnect: vi.fn()
    }
  };
  return mock;
}

/** The emit mock: callable as the typed emit, inspectable as a mock. */
export type EmitMock = RenderViewCtx["emit"] & Mock<(name: string, payload: unknown) => void>;

/** A renderView ctx whose emit, log, link, workspace and panels are mocks. */
export type TestCtx = Omit<RenderViewCtx, "emit" | "log"> & {
  readonly emit: EmitMock;
  readonly log: LogMock;
  readonly link: LinkMock;
  readonly workspace: WorkspaceMock;
  readonly activeSource: ActiveSourceMock;
  readonly registered: PanelSpec[];
};

/**
 * The manifest of a game 0.1 the test ctx starts with: the scene sources and game.rect.
 */
export const GAME_01_SOURCES: readonly string[] = [
  "game.render",
  "game.assets",
  "game.ui",
  "game.entities",
  "game.projections",
  "game.rect"
];

/**
 * A renderView domain ctx with a real state; require answers the mocks. The link is live at
 * frame 1841 in session "s-1" with a game 0.1 manifest; game.rect answers the board capture's
 * rects.
 *
 * @param config - Config overrides.
 * @returns The ctx.
 */
export function createCtx(config: Partial<RenderViewConfig> = {}): TestCtx {
  const link = createLinkMock();
  link.current = { kind: "live", frame: 1841 };
  link.manifestValue = manifestOf(GAME_01_SOURCES);
  link.api.engine = vi.fn(() => undefined);
  link.api.onEngine = vi.fn(() => stopNothing);
  const capture = boardCapture();
  link.api.read = vi.fn((id: string, input?: Json) => {
    const key =
      typeof input === "object" && input !== null && !Array.isArray(input) ? input.key : undefined;
    if (id === "game.rect" && typeof key === "string" && capture.rects[key] !== undefined) {
      return Promise.resolve<Json>(capture.rects[key]);
    }
    return Promise.resolve<Json>(null);
  });
  const workspace = createWorkspaceMock();
  const activeSource = createActiveSourceMock();
  const registered: PanelSpec[] = [];
  const panels = { register: vi.fn((panel: PanelSpec) => registered.push(panel)) };
  const require = vi.fn((plugin: unknown) => {
    if (plugin === linkPlugin) return link.api;
    if (plugin === workspacePlugin) return workspace.api;
    if (plugin === panelsPlugin) return panels;
    if (plugin === activeSourcePlugin) return activeSource.api;
    throw new Error("unexpected require");
  }) as unknown as Require;
  const resolved = { ...CONFIG, ...config };
  return {
    config: resolved,
    state: createRenderViewState({ config: resolved }),
    emit: vi.fn() as unknown as EmitMock,
    log: createLog(),
    require,
    link,
    workspace,
    activeSource,
    registered
  };
}

/**
 * Serves the manifest at a path through the mock link's files.read (every other path rejects), and
 * makes the project index name that path.
 *
 * @param ctx - The test ctx.
 * @param path - Where the manifest lives.
 * @param text - The manifest text.
 */
export function serveManifest(ctx: TestCtx, path = "manifest.json", text = MANIFEST_TEXT): void {
  ctx.link.api.project = () => projectWith(path);
  vi.mocked(ctx.link.api.files.read).mockImplementation((asked: string) =>
    asked === path
      ? Promise.resolve({ text, version: "v1" })
      : Promise.reject(new Error("[moku-editor] not found"))
  );
}

/** A manual animation-frame queue stubbed as the global requestAnimationFrame. */
export type FrameQueue = { pending(): number; flush(): void };

/**
 * Stubs requestAnimationFrame with a manual queue (the caller unstubs in afterEach).
 *
 * @returns The queue.
 */
export function stubFrames(): FrameQueue {
  let queue: (() => void)[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
    queue.push(callback);
    return queue.length;
  });
  return {
    pending: () => queue.length,
    flush() {
      const run = queue;
      queue = [];
      for (const callback of run) callback();
    }
  };
}

/** A manual ResizeObserver: the test resizes every observed element by hand. */
export type ResizeQueue = {
  /** How many observers watch an element now. */
  observed(): number;
  /** Reports a new border box to every observer. */
  resize(width: number, height: number): void;
};

/**
 * Stubs ResizeObserver with a manual one (the caller unstubs in afterEach).
 *
 * @returns The queue.
 */
export function stubResizeObserver(): ResizeQueue {
  const watching = new Set<ResizeObserverCallback>();
  /** The stand-in: observe and disconnect only. */
  class ManualObserver {
    readonly callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }
    observe(): void {
      watching.add(this.callback);
    }
    unobserve(): void {
      watching.delete(this.callback);
    }
    disconnect(): void {
      watching.delete(this.callback);
    }
  }
  vi.stubGlobal("ResizeObserver", ManualObserver);
  return {
    observed: () => watching.size,
    resize(width, height) {
      const entry = {
        contentRect: { width, height },
        borderBoxSize: [{ inlineSize: width, blockSize: height }]
      };
      for (const callback of watching) callback([entry] as never, {} as never);
    }
  };
}

/** A manual `prefers-reduced-motion` query. */
export type MotionQuery = {
  /** How often `matchMedia` was called. */
  calls(): number;
  /** How many change listeners the query has. */
  listeners(): number;
  /** Turns reduced motion on or off and fires the query's change event. */
  set(reduced: boolean): void;
};

/**
 * Stubs matchMedia with one query whose `matches` the test sets (the caller unstubs in afterEach).
 *
 * @param reduced - Whether reduced motion is on at first.
 * @returns The query.
 */
export function stubMotion(reduced: boolean): MotionQuery {
  const changes = new Set<() => void>();
  const query = {
    matches: reduced,
    addEventListener: (_type: string, listener: () => void) => changes.add(listener),
    removeEventListener: (_type: string, listener: () => void) => changes.delete(listener)
  };
  const matchMedia = vi.fn(() => query);
  vi.stubGlobal("matchMedia", matchMedia);
  return {
    calls: () => matchMedia.mock.calls.length,
    listeners: () => changes.size,
    set(next) {
      query.matches = next;
      for (const listener of changes) listener();
    }
  };
}

/**
 * Lets pending promise callbacks run (no timers involved).
 */
export async function flush(): Promise<void> {
  for (let index = 0; index < 30; index += 1) await Promise.resolve();
}

/**
 * Delivers the board capture to the scene watches and runs the queued build.
 *
 * @param ctx - The test ctx.
 * @param frames - The frame queue.
 */
export async function deliverBoard(ctx: TestCtx, frames: FrameQueue): Promise<void> {
  const capture = boardCapture();
  ctx.link.send("game.ui", capture.ui);
  ctx.link.send("game.entities", capture.entities);
  ctx.link.send("game.projections", capture.projections);
  await flush();
  frames.flush();
}

export {
  createLog,
  type LinkMock,
  type LogMock,
  manifestOf
} from "../../panels/__tests__/helpers";
