/* eslint-disable unicorn/no-null -- null is a JSON value */
import { vi } from "vitest";
import type { Require } from "../../../config";
import { linkPlugin } from "../../link";
import type { FilesClient } from "../../link/types";
import { panelsPlugin } from "../../panels";
import type { PanelSpec } from "../../panels/types";
import type { FileEntry, Json, LinkStatus, RunResult, ToolsBoot } from "../../registry/protocol";
import { wireError } from "../../registry/protocol";
import { workspacePlugin } from "../../workspace";
import type {
  Density,
  EscLayer,
  KeyBinding,
  PaletteItem,
  PreviewState,
  ReloadResult
} from "../../workspace/types";
import { createFlowViewState } from "../state";
import type { FlowCtx, FlowViewConfig } from "../types";
import { testConfig } from "./helpers";

// ─────────────────────────────────────────────────────────────────────────────
// A mock flowView context: real state, vi.fn() emit and log, and fakes of the
// three plugins flowView requires (link with an in-memory files channel,
// workspace, panels).
// ─────────────────────────────────────────────────────────────────────────────

/** Does nothing (a remover). */
const noop = (): void => {};

/** An in-memory files channel with versions and injectable conflicts. */
export type MemoryFiles = FilesClient & {
  readonly store: Map<string, { text: string; version: string }>;
  /** Extra directories that list as empty. */
  readonly dirs: Set<string>;
  /** The next N versioned writes fail with -32005. */
  conflicts: number;
  /** Paths whose read fails with this error. */
  readonly failing: Map<string, Error>;
  readonly writes: { path: string; text: string; version: string | undefined }[];
};

/** Creates an in-memory files channel. */
export function memoryFiles(initial: Record<string, string> = {}): MemoryFiles {
  let next = 1;
  const store = new Map<string, { text: string; version: string }>();
  for (const [path, text] of Object.entries(initial))
    store.set(path, { text, version: `v${next++}` });
  const files: MemoryFiles = {
    store,
    dirs: new Set(),
    conflicts: 0,
    failing: new Map(),
    writes: [],
    list: vi.fn(async (dir: string): Promise<readonly FileEntry[]> => {
      const prefix = dir === "" ? "" : `${dir}/`;
      const entries: FileEntry[] = [];
      for (const [path, file] of store) {
        if (!path.startsWith(prefix) || path.slice(prefix.length).includes("/")) continue;
        entries.push({ path, kind: "file", size: file.text.length, version: file.version });
      }
      if (entries.length === 0 && !files.dirs.has(dir)) {
        const nested = [...store.keys()].some(path => path.startsWith(prefix));
        if (!nested)
          throw wireError(-32_601, `[moku-editor] not found: ${dir}`, { reason: "unknown_id" });
      }
      return entries;
    }),
    read: vi.fn(async (path: string) => {
      const failure = files.failing.get(path);
      if (failure !== undefined) throw failure;
      const file = store.get(path);
      if (file === undefined) {
        throw wireError(-32_601, `[moku-editor] not found: ${path}`, { reason: "unknown_id" });
      }
      return { text: file.text, version: file.version };
    }),
    write: vi.fn(async (path: string, text: string, version?: string) => {
      files.writes.push({ path, text, version });
      const current = store.get(path);
      if (version !== undefined && (files.conflicts > 0 || current?.version !== version)) {
        if (files.conflicts > 0) files.conflicts -= 1;
        throw wireError(-32_005, `[moku-editor] version conflict: ${path}`, {
          reason: "version_conflict"
        });
      }
      const written = { text, version: `v${next++}` };
      store.set(path, written);
      return { path, bytes: text.length, version: written.version };
    }),
    writeBinary: vi.fn(async (path: string) => ({ path, bytes: 1, version: "b1" })),
    readBinary: vi.fn(async () => ({ dataUrl: "data:image/png;base64,AA==", version: "b1" }))
  };
  return files;
}

/**
 * Holds every later read of one path until the returned release is called (a slow dev server).
 *
 * @param files - The in-memory files channel.
 * @param path - The path whose reads wait.
 * @returns Lets the held reads answer.
 */
export function holdReads(files: MemoryFiles, path: string): () => void {
  const gate = Promise.withResolvers<void>();
  const read = vi.mocked(files.read);
  const original = read.getMockImplementation();
  if (original === undefined) throw new Error("the files channel has no read");
  read.mockImplementation(async (asked: string) => {
    if (asked === path) await gate.promise;
    return original(asked);
  });
  return () => gate.resolve();
}

/** One watch of the fake link. */
export type FakeWatch = {
  readonly id: string;
  readonly input: Json | undefined;
  readonly onValue: (value: Json) => void;
  active: boolean;
};

/** The fakes behind ctx.require. */
export type Fakes = {
  readonly files: MemoryFiles;
  status: LinkStatus;
  boot: ToolsBoot | undefined;
  readonly link: {
    status: () => LinkStatus;
    read: ReturnType<typeof vi.fn>;
    watch: (id: string, input: Json | undefined, onValue: (value: Json) => void) => () => void;
    boot: () => ToolsBoot | undefined;
    files: MemoryFiles;
  };
  /** Every watch the fake link took, stopped ones included. */
  readonly watches: FakeWatch[];
  /** Delivers a value to every active watch of a source id. */
  send(id: string, value: Json): void;
  readonly palette: PaletteItem[][];
  readonly removed: number[];
  readonly bindings: KeyBinding[];
  readonly escapes: Map<EscLayer, () => boolean>;
  readonly panels: PanelSpec[];
  preview: PreviewState;
  density: Density;
  readonly workspace: {
    show: ReturnType<typeof vi.fn>;
    toast: ReturnType<typeof vi.fn>;
    preview: () => PreviewState;
    gameFrame: () => { reload: ReturnType<typeof vi.fn> };
    palette: {
      add: (items: PaletteItem | readonly PaletteItem[]) => () => void;
      open: ReturnType<typeof vi.fn>;
    };
    keys: {
      bind: (binding: KeyBinding) => () => void;
      escape: (layer: EscLayer, close: () => boolean) => () => void;
    };
    previewZone: ReturnType<typeof vi.fn>;
    active: () => string;
    density: () => Density;
  };
  readonly reload: ReturnType<typeof vi.fn>;
  readonly run: ReturnType<typeof vi.fn>;
  readonly panelsApi: { register: (panel: PanelSpec) => void; run: ReturnType<typeof vi.fn> };
};

/** A test context and its fakes. */
export type TestCtx = { readonly ctx: FlowCtx; readonly fakes: Fakes };

/** The boot of the tests. */
export const BOOT: ToolsBoot = {
  v: 1,
  ws: "ws://127.0.0.1:3000/__editor/ws",
  token: "tok",
  path: "/__editor",
  title: "moku editor",
  editorUrl: "vscode://file/{path}:{line}",
  root: "/work/game",
  gameUrl: "/game.html"
};

/** Creates a flowView test context. */
export function createTestCtx(
  options: { config?: Partial<FlowViewConfig>; files?: Record<string, string> } = {}
): TestCtx {
  const config = testConfig(options.config);
  const files = memoryFiles(options.files);
  const reload = vi.fn(async (): Promise<ReloadResult> => ({ restored: true }));
  const run = vi.fn(
    async (id: string): Promise<RunResult> => ({
      value: null,
      state: {
        path: id === "game.step" ? "board/awaitIntent" : "home",
        frame: 1841,
        tainted: false
      }
    })
  );
  const fakes: Fakes = {
    files,
    status: { kind: "live", frame: 1840 },
    boot: BOOT,
    link: {
      status: () => fakes.status,
      read: vi.fn(async (): Promise<Json> => null),
      watch: (id, input, onValue) => {
        const watch: FakeWatch = { id, input, onValue, active: true };
        fakes.watches.push(watch);
        return () => {
          watch.active = false;
        };
      },
      boot: () => fakes.boot,
      files
    },
    watches: [],
    send: (id, value) => {
      for (const watch of fakes.watches) if (watch.active && watch.id === id) watch.onValue(value);
    },
    palette: [],
    removed: [],
    bindings: [],
    escapes: new Map(),
    panels: [],
    preview: { visible: false, size: "S", corner: "bottom-right", width: 150, height: 280 },
    density: "comfortable",
    workspace: {
      show: vi.fn(),
      toast: vi.fn(),
      preview: () => fakes.preview,
      gameFrame: () => ({ reload }),
      palette: {
        add: items => {
          const list = Array.isArray(items) ? [...items] : [items as PaletteItem];
          fakes.palette.push(list);
          const index = fakes.palette.length - 1;
          return () => fakes.removed.push(index);
        },
        open: vi.fn()
      },
      keys: {
        bind: binding => {
          fakes.bindings.push(binding);
          return () => fakes.removed.push(-1);
        },
        escape: (layer, close) => {
          fakes.escapes.set(layer, close);
          return () => fakes.removed.push(-2);
        }
      },
      previewZone: vi.fn(() => noop),
      active: () => "flow",
      density: () => fakes.density
    },
    reload,
    run,
    panelsApi: {
      register: panel => {
        fakes.panels.push(panel);
      },
      run
    }
  };
  const apis = new Map<unknown, unknown>([
    [linkPlugin, fakes.link],
    [workspacePlugin, fakes.workspace],
    [panelsPlugin, fakes.panelsApi]
  ]);
  const require = ((plugin: unknown) => apis.get(plugin)) as unknown as Require;
  const ctx: FlowCtx = {
    config,
    state: createFlowViewState({ config }),
    emit: vi.fn(),
    log: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    } as unknown as FlowCtx["log"],
    require
  };
  return { ctx, fakes };
}

/** Waits for pending promise callbacks and zero-delay timers. */
export async function flush(times = 5): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}

/**
 * Puts the merge graph and a position into the state, expands the stack and lays out (inline
 * ELK: the test file needs the happy-dom environment).
 */
export async function prepare(ctx: FlowCtx, path = "board/awaitIntent"): Promise<void> {
  const { actionsOf } = await import("../actions");
  const { cloneGraph } = await import("./helpers");
  ctx.state.data.graph = cloneGraph();
  ctx.state.data.graphHash = "g1";
  ctx.state.data.position = { path, waiting: ["tap", "leave"] };
  ctx.state.data.status = { kind: "live", frame: 1840 };
  ctx.state.camera.viewport = { w: 1200, h: 800 };
  const actions = actionsOf(ctx);
  actions.layout.expandStack();
  await actions.layout.relayout();
}

/** Makes animations jump (reduced motion) and gives rAF a no-op queue. */
export function jumpCamera(): void {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce") }));
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
}
