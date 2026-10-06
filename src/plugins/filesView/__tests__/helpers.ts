/* eslint-disable unicorn/no-null -- null is a JSON value */
import type { Mock } from "vitest";
import { vi } from "vitest";
import type { Require } from "../../../config";
import { linkPlugin } from "../../link";
import type { LinkApi } from "../../link/types";
import { panelsPlugin } from "../../panels";
import type { PanelSpec } from "../../panels/types";
import type { Json, LinkStatus, Manifest, ProjectState, ToolsBoot } from "../../registry/protocol";
import { workspacePlugin } from "../../workspace";
import type {
  EscLayer,
  KeyBinding,
  PaletteItem,
  ReloadResult,
  WorkspaceApi,
  WorkspaceId
} from "../../workspace/types";
import { createFilesViewState } from "../state";
import type { Config, FilesViewCtx } from "../types";
import { createFakeFiles, type FakeFiles } from "./fake-files";

// ─────────────────────────────────────────────────────────────────────────────
// Shared test helpers of filesView: a log mock, a link mock over the fake
// files, a workspace mock (show, toast, gameFrame().reload, palette, keys), a
// panels mock and a domain ctx with a real state.
// ─────────────────────────────────────────────────────────────────────────────

/** The default config of the plugin (index.ts). */
export const CONFIG: Config = {
  maxFiles: 5000,
  maxHighlightChars: 512_000,
  reloadExtensions: [".ts", ".tsx", ".css", ".json"],
  revalidateMs: 2000
};

/** Boot data of a tools page. */
export const BOOT: ToolsBoot = {
  v: 1,
  ws: "ws://127.0.0.1:3000/__editor/ws",
  token: "tok-1",
  path: "/__editor",
  title: "moku editor",
  editorUrl: "vscode://file/{path}:{line}",
  root: "/Users/moku/game",
  gameUrl: "/game.html"
};

/** A small merge-game-like tree. */
export const SEED: Readonly<Record<string, string>> = {
  "flows/main.ts": "export const mainFlow = defineFlow('main', {});\n",
  "flows/board.ts":
    "import { merge } from '../nodes/merge';\nexport const boardFlow = 1;\nline 3\n",
  "nodes/merge.ts": "export const merge = 1;\n",
  "nodes/await-intent.ts": "export const awaitIntent = 1;\n",
  "features/settings/nodes.ts": "export const enter = 1;\n",
  ".moku/editor/layout.json": '{ "panes": 2 }\n',
  ".moku/captures/series-2026-09-24-1015/index.json": JSON.stringify({
    label: "merge burst",
    durationMs: 3000,
    intervalMs: 250,
    fromFrame: 1841,
    shots: [
      { file: "shot-01.png", frame: 1841, atMs: 0 },
      { file: "shot-02.png", frame: 1856, atMs: 250, bug: true }
    ]
  }),
  ".moku/notes/2026-09-24-first.md":
    "---\ntitle: First top item\nstatus: todo\ncaptures:\n  - .moku/captures/a.png\n---\n# Heading\n\nSome *text*.\n",
  ".moku/captures/a.png": "data:image/png;base64,iVBORw0KGgo=",
  "README.md": "# Game\n"
};

/**
 * The project index of SEED: the flows in flows/, the board nodes in nodes/ and the settings
 * popup nodes in one non-kebab file, features/settings/nodes.ts.
 */
export const PROJECT: Extract<ProjectState, { state: "on" }> = {
  state: "on",
  revision: "r1",
  defs: {
    "flow:main": ["flows/main.ts"],
    "flow:board": ["flows/board.ts"],
    "node:board/awaitIntent": ["nodes/await-intent.ts"],
    "node:board/merge": ["nodes/merge.ts"],
    "node:settingsPopup/enter": ["features/settings/nodes.ts"],
    "node:settingsPopup/open": ["features/settings/nodes.ts"]
  },
  uses: {
    "node:board/awaitIntent": ["flows/board.ts"],
    "node:board/merge": ["flows/board.ts"],
    "node:settingsPopup/enter": ["flows/main.ts"]
  },
  broken: {}
};

/** A small game.graph: main → board (sub-flow), board nodes, a settings popup. */
export const GRAPH: Json = {
  main: "main",
  flows: {
    main: {
      start: "boot",
      nodes: {
        boot: { flow: "main", node: "boot" },
        board: { flow: "main", node: "board", subFlow: "board" },
        afterOrder: { flow: "main", node: "afterOrder", slot: "afterOrder" }
      },
      edges: {}
    },
    board: {
      start: "awaitIntent",
      nodes: {
        awaitIntent: { flow: "board", node: "awaitIntent" },
        merge: { flow: "board", node: "merge" },
        settings: { flow: "board", node: "settings", subFlow: "settingsPopup" }
      },
      edges: {}
    },
    settingsPopup: {
      start: "enter",
      nodes: { enter: { flow: "settingsPopup", node: "enter" }, open: { node: "open" } },
      edges: {}
    }
  },
  slots: {}
};

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

/** A manifest with game.graph. */
export const MANIFEST: Manifest = {
  game: "merge-game 0.0.0",
  page: "http://127.0.0.1:3000/game.html",
  embedded: true,
  sources: [{ id: "game.graph", title: "Graph", input: {}, changes: "edge" }],
  commands: []
};

/** What a mock watch returns. */
const unwatch = (): void => {};

/** A link mock over the fake files. */
export type LinkMock = {
  readonly api: LinkApi;
  readonly read: Mock<LinkApi["read"]>;
  readonly listeners: Set<(manifest: Manifest | undefined) => void>;
  statusValue: LinkStatus;
  bootValue: ToolsBoot | undefined;
  manifestValue: Manifest | undefined;
  /** What `read("game.graph")` answers; undefined rejects. */
  graph: Json | undefined;
  /** What `project()` answers (default PROJECT). */
  projectValue: ProjectState | undefined;
  /** Sets the manifest and calls every listener. */
  attach(manifest: Manifest | undefined): void;
};

/**
 * A link mock.
 *
 * @param files - The fake files channel.
 * @returns The mock.
 */
export function createLinkMock(files: FakeFiles): LinkMock {
  const listeners = new Set<(manifest: Manifest | undefined) => void>();
  const read = vi.fn<LinkApi["read"]>(async id => {
    await Promise.resolve();
    if (id === "game.graph" && link.graph !== undefined) return link.graph;
    throw new Error(`[moku-editor] no value for ${id}`);
  });
  const link: LinkMock = {
    read,
    listeners,
    statusValue: { kind: "live", frame: 1841 },
    bootValue: BOOT,
    manifestValue: undefined,
    graph: GRAPH,
    projectValue: PROJECT,
    api: {
      read,
      watch: vi.fn(() => unwatch),
      run: vi.fn(() =>
        Promise.resolve({ value: null, state: { path: "", frame: 0, tainted: false } })
      ),
      status: () => link.statusValue,
      manifest: () => link.manifestValue,
      onManifest: fn => {
        listeners.add(fn);
        if (link.manifestValue !== undefined) fn(link.manifestValue);
        return () => {
          listeners.delete(fn);
        };
      },
      sessions: () => [],
      session: () => undefined,
      choose: vi.fn(() => Promise.resolve(MANIFEST)),
      retry: vi.fn(),
      expectReload: vi.fn(),
      boot: () => link.bootValue,
      frameUrl: url => url,
      isOtherTab: () => false,
      onTap: vi.fn(() => unwatch),
      heap: vi.fn(() => undefined),
      hotReload: vi.fn(() => undefined),
      onHotReload: vi.fn(() => unwatch),
      setHotReload: vi.fn(() => Promise.resolve(false)),
      selection: vi.fn(() => undefined),
      notify: vi.fn(),
      handle: vi.fn(() => vi.fn()),
      project: () => link.projectValue,
      files: files.client
    },
    attach(manifest) {
      link.manifestValue = manifest;
      for (const fn of listeners) fn(manifest);
    }
  };
  return link;
}

/** A workspace mock: mocked calls, recorded palette items, key bindings and Esc layers. */
export type WorkspaceMock = {
  readonly api: WorkspaceApi;
  readonly show: Mock<(ws: WorkspaceId) => void>;
  readonly toast: Mock<(message: string, file?: string) => void>;
  readonly reload: Mock<(opts?: { restore?: boolean }) => Promise<ReloadResult>>;
  readonly paletteAdd: Mock<(item: PaletteItem | readonly PaletteItem[]) => () => void>;
  /** Items currently added. */
  readonly items: PaletteItem[];
  readonly paletteRemovers: Mock<() => void>[];
  readonly bindings: KeyBinding[];
  readonly escapes: { readonly layer: EscLayer; readonly close: () => boolean }[];
  /** Removers of bindings and Esc layers. */
  readonly keyRemovers: Mock<() => void>[];
};

/**
 * A workspace mock.
 *
 * @returns The mock.
 */
export function createWorkspaceMock(): WorkspaceMock {
  const items: PaletteItem[] = [];
  const paletteRemovers: Mock<() => void>[] = [];
  const bindings: KeyBinding[] = [];
  const escapes: { readonly layer: EscLayer; readonly close: () => boolean }[] = [];
  const keyRemovers: Mock<() => void>[] = [];
  const reload = vi.fn((_opts?: { restore?: boolean }) =>
    Promise.resolve<ReloadResult>({ restored: true })
  );
  const paletteAdd = vi.fn((item: PaletteItem | readonly PaletteItem[]) => {
    const list: readonly PaletteItem[] = Array.isArray(item) ? item : [item as PaletteItem];
    items.push(...list);
    const remove = vi.fn(() => {
      for (const entry of list) {
        const index = items.indexOf(entry);
        if (index !== -1) items.splice(index, 1);
      }
    });
    paletteRemovers.push(remove);
    return remove;
  });
  const show = vi.fn((_ws: WorkspaceId) => {});
  const toast = vi.fn((_message: string, _file?: string) => {});
  return {
    show,
    toast,
    reload,
    paletteAdd,
    items,
    paletteRemovers,
    bindings,
    escapes,
    keyRemovers,
    api: {
      show,
      toast,
      active: () => "files",
      gameFrame: () => ({ url: "/game.html", reload }),
      palette: { add: paletteAdd, open: vi.fn() },
      keys: {
        bind: (binding: KeyBinding) => {
          bindings.push(binding);
          const remove = vi.fn();
          keyRemovers.push(remove);
          return remove;
        },
        escape: (layer: EscLayer, close: () => boolean) => {
          escapes.push({ layer, close });
          const remove = vi.fn();
          keyRemovers.push(remove);
          return remove;
        }
      }
    } as unknown as WorkspaceApi
  };
}

/** The emit mock: callable as the typed emit, inspectable as a mock. */
export type EmitMock = FilesViewCtx["emit"] & Mock<(name: string, payload: unknown) => void>;

/** A filesView ctx whose emit, log, link, workspace and panels are mocks. */
export type TestCtx = Omit<FilesViewCtx, "emit" | "log"> & {
  readonly emit: EmitMock;
  readonly log: LogMock;
  readonly files: FakeFiles;
  readonly link: LinkMock;
  readonly workspace: WorkspaceMock;
  readonly register: Mock<(panel: PanelSpec) => void>;
};

/**
 * A filesView domain ctx with a real state; require answers the mocks.
 *
 * @param options - Seed files and config overrides.
 * @param options.seed - Path → text (default SEED).
 * @param options.config - Config overrides.
 * @returns The ctx.
 */
export function createCtx(
  options: { seed?: Readonly<Record<string, string>>; config?: Partial<Config> } = {}
): TestCtx {
  const files = createFakeFiles(options.seed ?? SEED);
  const link = createLinkMock(files);
  const workspace = createWorkspaceMock();
  const register = vi.fn((_panel: PanelSpec) => {});
  const require = vi.fn((plugin: unknown) => {
    if (plugin === linkPlugin) return link.api;
    if (plugin === workspacePlugin) return workspace.api;
    if (plugin === panelsPlugin) return { register };
    throw new Error("unexpected require");
  }) as unknown as Require;
  return {
    config: { ...CONFIG, ...options.config },
    state: createFilesViewState(),
    emit: vi.fn() as unknown as EmitMock,
    log: createLog(),
    require,
    files,
    link,
    workspace,
    register
  };
}

/**
 * Lets pending promise callbacks and zero timers run (real timers).
 */
export async function settle(): Promise<void> {
  for (let round = 0; round < 6; round += 1) {
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}
