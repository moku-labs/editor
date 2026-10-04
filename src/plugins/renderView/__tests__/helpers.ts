/* eslint-disable unicorn/no-null -- null is a JSON value on the wire */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Mock } from "vitest";
import { vi } from "vitest";
import type { Require } from "../../../config";
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
import type { Json } from "../../registry/protocol";
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

/** The default config of the plugin. */
export const CONFIG: RenderViewConfig = {
  fpsSamples: 60,
  releaseLogMax: 50,
  manifestPaths: ["manifest.json", "public/manifest.json", "web/manifest.json"]
};

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
  readonly setPreview: Mock<(ws: PreviewWorkspace, patch: Partial<PreviewPrefs>) => void>;
  activeValue: WorkspaceId;
  previewVisible: boolean;
  /** Calls every prefs listener with a device. */
  prefs(preset: string, orientation: "portrait" | "landscape"): void;
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
  const workspace: WorkspaceMock = {
    overlay,
    items,
    prefsListeners,
    show,
    setPreview,
    activeValue: "flow",
    previewVisible: true,
    api: {
      active: () => workspace.activeValue,
      show,
      preview: () => ({
        visible: workspace.previewVisible,
        size: "S",
        corner: "bottom-right",
        width: 150,
        height: 280
      }),
      setPreview,
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
    prefs(preset, orientation) {
      const prefs = {
        theme: "light",
        previews: {},
        device: { preset: { id: preset }, orientation }
      } as unknown as Prefs;
      for (const fn of prefsListeners) fn(prefs);
    }
  };
  return workspace;
}

/** The emit mock: callable as the typed emit, inspectable as a mock. */
export type EmitMock = RenderViewCtx["emit"] & Mock<(name: string, payload: unknown) => void>;

/** A renderView ctx whose emit, log, link, workspace and panels are mocks. */
export type TestCtx = Omit<RenderViewCtx, "emit" | "log"> & {
  readonly emit: EmitMock;
  readonly log: LogMock;
  readonly link: LinkMock;
  readonly workspace: WorkspaceMock;
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
  const registered: PanelSpec[] = [];
  const panels = { register: vi.fn((panel: PanelSpec) => registered.push(panel)) };
  const require = vi.fn((plugin: unknown) => {
    if (plugin === linkPlugin) return link.api;
    if (plugin === workspacePlugin) return workspace.api;
    if (plugin === panelsPlugin) return panels;
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
    registered
  };
}

/**
 * Serves the manifest at a path through the mock link's files.read; every other path rejects.
 *
 * @param ctx - The test ctx.
 * @param path - Where the manifest lives.
 * @param text - The manifest text.
 */
export function serveManifest(ctx: TestCtx, path = "manifest.json", text = MANIFEST_TEXT): void {
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
