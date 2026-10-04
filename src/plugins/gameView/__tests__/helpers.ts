/* eslint-disable unicorn/no-null -- null is a JSON value on the wire */
import { readFileSync } from "node:fs";
import type { Mock } from "vitest";
import { vi } from "vitest";
import type { Require } from "../../../config";
import { linkPlugin } from "../../link";
import type { LinkApi } from "../../link/types";
import { panelsPlugin } from "../../panels";
import type { PageRect } from "../../panels/shared/scene";
import type { PanelSpec, PanelsApi } from "../../panels/types";
import type { Json, LinkStatus, Manifest, RunResult, WireError } from "../../registry/protocol";
import { workspacePlugin } from "../../workspace";
import { DEVICES, presetOf } from "../../workspace/devices";
import type {
  DevicePresetId,
  EscLayer,
  FrameBox,
  GameFrame,
  KeyBinding,
  Orientation,
  PaletteItem,
  Prefs,
  WorkspaceApi,
  WorkspaceId
} from "../../workspace/types";
import { createGameViewState } from "../state";
import type { GameViewConfig, GameViewCtx } from "../types";
import { createFilesStore, type FilesStore } from "./files-store";

// ─────────────────────────────────────────────────────────────────────────────
// Shared test helpers of gameView: a log mock, a scripted link over an
// in-memory files store, a workspace mock with a real overlay element, a
// panels mock whose run answers by command id, and a domain ctx with a real
// state. The scene fixtures of panels (real merge-game captures) are reused
// read-only.
// ─────────────────────────────────────────────────────────────────────────────

/** Does nothing (the remover of a mock that keeps nothing). */
function noop(): void {}

/** The default config of gameView (index.ts). */
export const CONFIG: GameViewConfig = {
  capturesDir: ".moku/captures",
  manifestPaths: ["manifest.json", "public/manifest.json", "web/manifest.json"],
  captureCardMs: 10_000,
  seriesDurationsMs: [1000, 2000, 5000, 10_000, 20_000],
  seriesIntervalsMs: [16, 50, 100, 250, 500, 1000],
  seriesWarnShots: 200,
  sourceSearch: { maxFiles: 1500, skip: ["node_modules", "dist", ".git", ".moku"] }
};

/** A 1×1 PNG data URL. */
export const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

/** One capture of the three scene sources plus game.rect of some keys (panels fixtures). */
export type SceneCapture = {
  readonly path: string;
  readonly ui: Json;
  readonly entities: Json;
  readonly projections: Json;
  readonly rects: Readonly<Record<string, PageRect>>;
};

/**
 * A scene fixture of panels (merge-game on the inert renderer), read-only.
 *
 * @param name - "scene-board.txt" or "scene-settings.txt".
 * @returns The capture.
 */
export function sceneCapture(name: string): SceneCapture {
  const parsed: SceneCapture = JSON.parse(
    readFileSync(`${process.cwd()}/src/plugins/panels/__tests__/fixtures/${name}`, "utf8")
  );
  return parsed;
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

/** The mock log type. */
export type LogMock = ReturnType<typeof createLog>;

/** One watch gameView made. */
export type WatchRecord = {
  readonly id: string;
  readonly input: Json | undefined;
  readonly onValue: (value: Json) => void;
  active: boolean;
};

/** A run result. */
export function resultOf(value: Json = null, frame = 1841): RunResult {
  return { value, state: { path: "board/awaitIntent", frame, tainted: false } };
}

/**
 * A manifest with the given commands.
 *
 * @param commands - Command ids with their effect.
 * @returns The manifest.
 */
export function manifestOf(
  commands: readonly (readonly [id: string, effect: "read" | "cosmetic" | "cheat"])[] = [
    ["editor.capture", "read"],
    ["editor.series", "read"],
    ["editor.seriesStop", "read"],
    ["editor.overlay", "cosmetic"]
  ]
): Manifest {
  return {
    game: "merge-game 0.0.0",
    page: "http://127.0.0.1:3000/game.html",
    embedded: true,
    sources: [],
    commands: commands.map(([id, effect]) => ({ id, title: id, input: {}, effect }))
  };
}

/** A scripted link: the api plus test controls. */
export type LinkMock = {
  readonly api: LinkApi;
  readonly files: FilesStore;
  readonly watch: Mock<LinkApi["watch"]>;
  readonly read: Mock<LinkApi["read"]>;
  readonly run: Mock<LinkApi["run"]>;
  readonly watches: WatchRecord[];
  /** Answers of read by source id. */
  readonly values: Map<string, Json | ((input: Json | undefined) => Json)>;
  current: LinkStatus;
  manifestValue: Manifest | undefined;
  /** Delivers a value to every active watch of a source id. */
  send(id: string, value: Json): void;
  /** Active watches, optionally of one id. */
  active(id?: string): WatchRecord[];
};

/**
 * A scripted link over an in-memory files store.
 *
 * @param files - Initial files.
 * @returns The mock.
 */
export function createLinkMock(files: Readonly<Record<string, string>> = {}): LinkMock {
  const store = createFilesStore(files);
  const watches: WatchRecord[] = [];
  const values = new Map<string, Json | ((input: Json | undefined) => Json)>();
  const watch = vi.fn<LinkApi["watch"]>((id, input, onValue) => {
    const record: WatchRecord = { id, input, onValue, active: true };
    watches.push(record);
    return () => {
      record.active = false;
    };
  });
  const read = vi.fn<LinkApi["read"]>((id, input) => {
    const value = values.get(id);
    if (value === undefined) return Promise.reject(new Error(`no value for ${id}`));
    return Promise.resolve(typeof value === "function" ? value(input) : value);
  });
  const run = vi.fn<LinkApi["run"]>(() => Promise.reject(new Error("link.run is not for views")));
  const link: LinkMock = {
    files: store,
    watch,
    read,
    run,
    watches,
    values,
    current: { kind: "live", frame: 1841 },
    manifestValue: manifestOf(),
    api: {
      read,
      watch,
      run,
      status: () => link.current,
      manifest: () => link.manifestValue,
      onManifest: fn => {
        fn(link.manifestValue);
        return noop;
      },
      sessions: () => [],
      session: () => "s-1",
      choose: vi.fn(() => Promise.resolve(manifestOf())),
      retry: vi.fn(),
      boot: () => undefined,
      frameUrl: url => url,
      isOtherTab: () => false,
      onTap: vi.fn(() => noop),
      heap: vi.fn(() => undefined),
      files: store
    },
    send(id, value) {
      for (const record of watches) if (record.active && record.id === id) record.onValue(value);
    },
    active(id) {
      return watches.filter(record => record.active && (id === undefined || record.id === id));
    }
  };
  return link;
}

/** A workspace mock: mocked calls, a real overlay element, recorded bindings. */
export type WorkspaceMock = {
  readonly api: WorkspaceApi;
  readonly items: PaletteItem[];
  readonly bindings: KeyBinding[];
  readonly escapes: { readonly layer: EscLayer; readonly close: () => boolean }[];
  readonly prefsListeners: Set<(prefs: Prefs) => void>;
  readonly toast: Mock<WorkspaceApi["toast"]>;
  readonly show: Mock<WorkspaceApi["show"]>;
  readonly dock: Mock<GameFrame["dock"]>;
  readonly release: Mock<() => void>;
  readonly reload: Mock<GameFrame["reload"]>;
  readonly setOverlayInGame: Mock<WorkspaceApi["setOverlayInGame"]>;
  activeValue: WorkspaceId;
  device: { preset: DevicePresetId; orientation: Orientation };
  overlayOn: boolean;
  box: FrameBox | undefined;
  overlayElement: HTMLElement | undefined;
  /** Called by show(); the test wires it to the hook it wants to see. */
  onShow: (ws: WorkspaceId) => void;
  /** Sets the device and calls every onPrefs listener. */
  changeDevice(preset: DevicePresetId, orientation: Orientation): void;
};

/**
 * A workspace mock.
 *
 * @returns The mock.
 */
export function createWorkspaceMock(): WorkspaceMock {
  const items: PaletteItem[] = [];
  const bindings: KeyBinding[] = [];
  const escapes: { layer: EscLayer; close: () => boolean }[] = [];
  const prefsListeners = new Set<(prefs: Prefs) => void>();
  const release = vi.fn<() => void>();
  const dock = vi.fn<GameFrame["dock"]>(() => release);
  const reload = vi.fn<GameFrame["reload"]>(() => Promise.resolve({ restored: true }));
  const toast = vi.fn<WorkspaceApi["toast"]>();
  const show = vi.fn<WorkspaceApi["show"]>((ws: WorkspaceId) => {
    workspace.activeValue = ws;
    workspace.onShow(ws);
  });
  const setOverlayInGame = vi.fn<WorkspaceApi["setOverlayInGame"]>((on: boolean) => {
    workspace.overlayOn = on;
    return Promise.resolve();
  });
  const prefs = (): Prefs => ({
    theme: "light",
    previews: {
      flow: { visible: true, size: "S", corner: "bottom-right" },
      render: { visible: true, size: "S", corner: "bottom-right" },
      state: { visible: true, size: "S", corner: "bottom-right" },
      files: { visible: true, size: "S", corner: "bottom-right" },
      console: { visible: true, size: "S", corner: "bottom-right" }
    },
    device: { preset: presetOf(workspace.device.preset), orientation: workspace.device.orientation }
  });
  const workspace: WorkspaceMock = {
    items,
    bindings,
    escapes,
    prefsListeners,
    toast,
    show,
    dock,
    release,
    reload,
    setOverlayInGame,
    activeValue: "flow",
    device: { preset: "iphone-15", orientation: "portrait" },
    overlayOn: false,
    box: { left: 100, top: 50, width: 393, height: 852, scale: 1, docked: "stage" },
    overlayElement: undefined,
    onShow: () => {},
    changeDevice(preset, orientation) {
      workspace.device = { preset, orientation };
      for (const fn of prefsListeners) fn(prefs());
    },
    api: {
      active: () => workspace.activeValue,
      show,
      theme: () => "light",
      setTheme: vi.fn(),
      density: () => "comfortable",
      setDensity: vi.fn(),
      preview: () => ({
        visible: true,
        size: "S",
        corner: "bottom-right",
        width: 150,
        height: 280
      }),
      setPreview: vi.fn(),
      device: () => ({
        preset: presetOf(workspace.device.preset),
        orientation: workspace.device.orientation
      }),
      setDevice: vi.fn(patch => {
        workspace.device = {
          preset: patch.preset ?? workspace.device.preset,
          orientation: patch.orientation ?? workspace.device.orientation
        };
      }),
      devices: () => DEVICES,
      gameFrame: () => ({
        url: "http://127.0.0.1:3000/game.html",
        reload,
        dock,
        overlay: () => {
          workspace.overlayElement ??= document.createElement("div");
          return workspace.overlayElement;
        },
        box: () => workspace.box
      }),
      palette: {
        add: vi.fn((item: PaletteItem | readonly PaletteItem[]) => {
          const list: readonly PaletteItem[] = Array.isArray(item) ? item : [item as PaletteItem];
          items.push(...list);
          return () => {
            for (const entry of list) {
              const index = items.indexOf(entry);
              if (index !== -1) items.splice(index, 1);
            }
          };
        }),
        open: vi.fn()
      },
      toast,
      mount: vi.fn(),
      host: () => document.createElement("section"),
      badge: vi.fn(),
      previewZone: vi.fn(() => noop),
      keys: {
        bind: vi.fn((binding: KeyBinding) => {
          bindings.push(binding);
          return () => {
            const index = bindings.indexOf(binding);
            if (index !== -1) bindings.splice(index, 1);
          };
        }),
        escape: vi.fn((layer: EscLayer, close: () => boolean) => {
          const entry = { layer, close };
          escapes.push(entry);
          return () => {
            const index = escapes.indexOf(entry);
            if (index !== -1) escapes.splice(index, 1);
          };
        })
      },
      overlayInGame: () => workspace.overlayOn,
      setOverlayInGame,
      reference: () => false,
      setReference: vi.fn(),
      onPrefs: fn => {
        prefsListeners.add(fn);
        return () => {
          prefsListeners.delete(fn);
        };
      }
    }
  };
  return workspace;
}

/** How the panels mock answers one run. */
export type PanelsAnswer = Json | WireError | ((input: Json | undefined) => Promise<RunResult>);

/** A panels mock: register records panels; run answers by command id. */
export type PanelsMock = {
  readonly api: PanelsApi;
  readonly registered: PanelSpec[];
  readonly run: Mock<PanelsApi["run"]>;
  readonly answers: Map<string, PanelsAnswer>;
};

/**
 * True for a WireError-shaped answer.
 *
 * @param answer - An answer.
 * @returns Whether it is an error.
 */
function isErrorAnswer(answer: PanelsAnswer): answer is WireError {
  return (
    typeof answer === "object" &&
    answer !== null &&
    !Array.isArray(answer) &&
    "code" in answer &&
    "message" in answer
  );
}

/**
 * A panels mock.
 *
 * @returns The mock.
 */
export function createPanelsMock(): PanelsMock {
  const registered: PanelSpec[] = [];
  const answers = new Map<string, PanelsAnswer>();
  const run = vi.fn<PanelsApi["run"]>((id, input) => {
    const answer = answers.get(id) ?? null;
    if (typeof answer === "function") return answer(input);
    if (isErrorAnswer(answer)) {
      return Promise.reject(Object.assign(new Error(answer.message), answer));
    }
    return Promise.resolve(resultOf(answer));
  });
  return {
    registered,
    run,
    answers,
    api: {
      register: vi.fn((panel: PanelSpec) => {
        registered.push(panel);
      }),
      run,
      list: () => registered,
      mountInto: vi.fn(() => noop)
    }
  };
}

/** The emit mock: callable as the typed emit, inspectable as a mock. */
export type EmitMock = GameViewCtx["emit"] & Mock<(name: string, payload: unknown) => void>;

/** A gameView ctx whose emit, log and dependencies are mocks. */
export type TestCtx = Omit<GameViewCtx, "emit" | "log"> & {
  readonly emit: EmitMock;
  readonly log: LogMock;
  readonly link: LinkMock;
  readonly workspace: WorkspaceMock;
  readonly panels: PanelsMock;
};

/**
 * A gameView domain ctx with a real state; require answers the mocks.
 *
 * @param files - Initial files of the link's store.
 * @returns The ctx.
 */
export function createCtx(files: Readonly<Record<string, string>> = {}): TestCtx {
  const link = createLinkMock(files);
  const workspace = createWorkspaceMock();
  const panels = createPanelsMock();
  const require = vi.fn((plugin: unknown) => {
    if (plugin === linkPlugin) return link.api;
    if (plugin === workspacePlugin) return workspace.api;
    if (plugin === panelsPlugin) return panels.api;
    throw new Error("unexpected require");
  }) as unknown as Require;
  return {
    config: CONFIG,
    state: createGameViewState(),
    emit: vi.fn() as unknown as EmitMock,
    log: createLog(),
    require,
    link,
    workspace,
    panels
  };
}

/**
 * Lets pending promise callbacks run (no timers involved).
 */
export async function flush(): Promise<void> {
  for (let index = 0; index < 30; index += 1) await Promise.resolve();
}

/**
 * Feeds the board fixture into a ctx: read answers for the three sources and game.rect.
 *
 * @param ctx - The test ctx.
 * @param capture - The fixture.
 */
export function useScene(
  ctx: TestCtx,
  capture: SceneCapture = sceneCapture("scene-board.txt")
): void {
  ctx.link.values.set("game.ui", capture.ui);
  ctx.link.values.set("game.entities", capture.entities);
  ctx.link.values.set("game.projections", capture.projections);
  ctx.link.values.set("game.rect", input => {
    const key =
      typeof input === "object" && input !== null && !Array.isArray(input) ? input.key : undefined;
    return typeof key === "string" ? (capture.rects[key] ?? null) : null;
  });
  ctx.link.values.set("game.position", {
    path: "board/awaitIntent",
    flow: "board",
    node: "awaitIntent",
    waiting: ["merge"]
  });
}
