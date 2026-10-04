/* eslint-disable unicorn/no-null -- null is a JSON value on the wire */
import type { Mock } from "vitest";
import { vi } from "vitest";
import type { Require } from "../../../config";
import { linkPlugin } from "../../link";
import type { LinkApi } from "../../link/types";
import type { Json, LinkStatus, Manifest, RunResult } from "../../registry/protocol";
import { workspacePlugin } from "../../workspace";
import type { PaletteItem, WorkspaceApi, WorkspaceId } from "../../workspace/types";
import type { MountDeps } from "../mount";
import { createPanelsState } from "../state";
import type { PanelsCtx } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Shared test helpers of panels: a log mock, a scripted link (manual value
// delivery, watch/unwatch counting), a workspace mock with real host elements,
// a manual frame scheduler and a domain ctx with a real state.
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

/** One watch the panel host made. */
export type WatchRecord = {
  readonly id: string;
  readonly input: Json | undefined;
  readonly onValue: (value: Json) => void;
  active: boolean;
};

/** A scripted link: the api plus test controls. */
export type LinkMock = {
  readonly api: LinkApi;
  readonly watch: Mock<LinkApi["watch"]>;
  readonly run: Mock<LinkApi["run"]>;
  readonly watches: WatchRecord[];
  /** Live manifest listeners. */
  readonly listeners: Set<(manifest: Manifest | undefined) => void>;
  current: LinkStatus;
  manifestValue: Manifest | undefined;
  /** Delivers a value to every active watch of a source id. */
  send(id: string, value: Json): void;
  /** Active watches, optionally of one id. */
  active(id?: string): WatchRecord[];
  /** Sets the manifest and calls every listener, like link on an attach. */
  attach(manifest: Manifest | undefined): void;
};

/**
 * A run result.
 *
 * @param value - The value.
 * @returns The result.
 */
export function resultOf(value: Json = null): RunResult {
  return { value, state: { path: "board/awaitIntent", frame: 1841, tainted: false } };
}

/**
 * A manifest listing the given source ids.
 *
 * @param sources - Source ids.
 * @returns The manifest.
 */
export function manifestOf(sources: readonly string[]): Manifest {
  return {
    game: "merge-game 0.0.0",
    page: "http://127.0.0.1:3000/",
    embedded: true,
    sources: sources.map(id => ({ id, title: id, input: {}, changes: "commit" as const })),
    commands: []
  };
}

/** The stop function of a subscription that never fires. */
function stopNothing(): void {}

/**
 * A scripted link.
 *
 * @returns The mock.
 */
export function createLinkMock(): LinkMock {
  const watches: WatchRecord[] = [];
  const listeners = new Set<(manifest: Manifest | undefined) => void>();
  const watch = vi.fn<LinkApi["watch"]>((id, input, onValue) => {
    const record: WatchRecord = { id, input, onValue, active: true };
    watches.push(record);
    return () => {
      record.active = false;
    };
  });
  const run = vi.fn<LinkApi["run"]>(() => Promise.resolve(resultOf()));
  const link: LinkMock = {
    watch,
    run,
    watches,
    listeners,
    current: { kind: "connecting" },
    manifestValue: undefined,
    api: {
      read: vi.fn(() => Promise.resolve(null)),
      watch,
      run,
      status: () => link.current,
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
      choose: vi.fn(() => Promise.resolve(manifestOf([]))),
      retry: vi.fn(),
      boot: () => undefined,
      frameUrl: url => url,
      isOtherTab: () => false,
      onTap: () => stopNothing,
      heap: () => undefined,
      files: {
        list: vi.fn(() => Promise.resolve([])),
        read: vi.fn(() => Promise.resolve({ text: "", version: "v" })),
        write: vi.fn(() => Promise.resolve({ path: "", bytes: 0, version: "v" })),
        writeBinary: vi.fn(() => Promise.resolve({ path: "", bytes: 0, version: "v" })),
        readBinary: vi.fn(() => Promise.resolve({ dataUrl: "", version: "v" }))
      }
    },
    send(id, value) {
      for (const record of watches) if (record.active && record.id === id) record.onValue(value);
    },
    active(id) {
      return watches.filter(record => record.active && (id === undefined || record.id === id));
    },
    attach(manifest) {
      link.manifestValue = manifest;
      for (const fn of listeners) fn(manifest);
    }
  };
  return link;
}

/** A workspace mock: real host elements, mocked calls. */
export type WorkspaceMock = {
  readonly api: WorkspaceApi;
  readonly hosts: Map<WorkspaceId, HTMLElement>;
  readonly items: PaletteItem[];
  readonly removers: Mock<() => void>[];
  activeValue: WorkspaceId;
  /** Called by show(); the test wires it to the hook it wants to see. */
  onShow: (ws: WorkspaceId) => void;
};

/**
 * A workspace mock.
 *
 * @returns The mock.
 */
export function createWorkspaceMock(): WorkspaceMock {
  const hosts = new Map<WorkspaceId, HTMLElement>();
  const items: PaletteItem[] = [];
  const removers: Mock<() => void>[] = [];
  const workspace: WorkspaceMock = {
    hosts,
    items,
    removers,
    activeValue: "flow",
    onShow: () => {},
    api: {
      active: () => workspace.activeValue,
      show: vi.fn((ws: WorkspaceId) => {
        workspace.activeValue = ws;
        workspace.onShow(ws);
      }),
      host: (ws: WorkspaceId) => {
        const existing = hosts.get(ws);
        if (existing !== undefined) return existing;
        const host = document.createElement("section");
        host.dataset.workspaceHost = ws;
        hosts.set(ws, host);
        return host;
      },
      palette: {
        add: vi.fn((item: PaletteItem | readonly PaletteItem[]) => {
          const list: readonly PaletteItem[] = Array.isArray(item) ? item : [item as PaletteItem];
          items.push(...list);
          const remove = vi.fn(() => {
            for (const entry of list) items.splice(items.indexOf(entry), 1);
          });
          removers.push(remove);
          return remove;
        }),
        open: vi.fn()
      }
    } as unknown as WorkspaceApi
  };
  return workspace;
}

/** A manual frame scheduler: renders wait until the test flushes them. */
export type Frames = {
  readonly schedule: (render: () => void) => void;
  readonly pending: () => number;
  flush(): void;
};

/**
 * A manual frame scheduler.
 *
 * @returns The scheduler.
 */
export function createFrames(): Frames {
  let queue: (() => void)[] = [];
  return {
    schedule: render => {
      queue.push(render);
    },
    pending: () => queue.length,
    flush() {
      const run = queue;
      queue = [];
      for (const render of run) render();
    }
  };
}

/** The emit mock: callable as the typed emit, inspectable as a mock. */
export type EmitMock = PanelsCtx["emit"] & Mock<(name: string, payload: unknown) => void>;

/** Mount deps whose parts are mocks. */
export type TestDeps = MountDeps & {
  readonly emit: EmitMock;
  readonly log: LogMock;
  readonly linkMock: LinkMock;
  readonly workspaceMock: WorkspaceMock;
  readonly frames: Frames;
};

/**
 * Mount deps over mocks and a manual scheduler.
 *
 * @param initial - The status the panel starts with (default live).
 * @returns The deps.
 */
export function createDeps(initial?: LinkStatus): TestDeps {
  const status: LinkStatus = initial ?? { kind: "live", frame: 1 };
  const linkMock = createLinkMock();
  linkMock.current = status;
  const workspaceMock = createWorkspaceMock();
  const frames = createFrames();
  return {
    link: linkMock.api,
    workspace: workspaceMock.api,
    log: createLog(),
    emit: vi.fn() as unknown as EmitMock,
    status,
    schedule: frames.schedule,
    linkMock,
    workspaceMock,
    frames
  };
}

/** A panels ctx whose emit, log, link and workspace are mocks. */
export type TestCtx = Omit<PanelsCtx, "emit" | "log"> & {
  readonly emit: EmitMock;
  readonly log: LogMock;
  readonly link: LinkMock;
  readonly workspace: WorkspaceMock;
};

/**
 * A panels domain ctx with a real state; require answers the link and workspace mocks.
 *
 * @returns The ctx.
 */
export function createCtx(): TestCtx {
  const link = createLinkMock();
  const workspace = createWorkspaceMock();
  const require = vi.fn((plugin: unknown) => {
    if (plugin === linkPlugin) return link.api;
    if (plugin === workspacePlugin) return workspace.api;
    throw new Error("unexpected require");
  }) as unknown as Require;
  return {
    config: {},
    state: createPanelsState({ config: {} }),
    emit: vi.fn() as unknown as EmitMock,
    log: createLog(),
    require,
    link,
    workspace
  };
}

/**
 * Lets pending promise callbacks run (no timers involved).
 */
export async function flush(): Promise<void> {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}
