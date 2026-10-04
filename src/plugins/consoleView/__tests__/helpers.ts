import type { Mock } from "vitest";
import { vi } from "vitest";
import type { Require } from "../../../config";
import { linkPlugin } from "../../link";
import { panelsPlugin } from "../../panels";
import {
  createLinkMock,
  createLog,
  type LinkMock,
  type LogMock
} from "../../panels/__tests__/helpers";
import type { PanelSpec } from "../../panels/types";
import type { Json } from "../../registry/protocol";
import { workspacePlugin } from "../../workspace";
import type {
  Badge,
  KeyBinding,
  PaletteItem,
  WorkspaceApi,
  WorkspaceId
} from "../../workspace/types";
import { createConsoleState } from "../state";
import type { Config, ConsoleCtx, EntryLine, MetaLine, TraceEntry } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Shared test helpers of consoleView: the design §8 log (8 lines, 2 warnings),
// a workspace mock (badge, palette, keys), a panels mock and a domain ctx over a
// real state. The link mock comes from the panels helpers (read only).
// ─────────────────────────────────────────────────────────────────────────────

/** The default config of the plugin. */
export const CONFIG: Config = {
  maxLines: 5000,
  preserveLog: false,
  freshMs: 1200,
  summaryChars: 160
};

/** The design §8 log: flow, editor, assets, model, renderer; 2 warnings. */
export const TRACE: readonly TraceEntry[] = [
  { level: "info", event: "flow: enter main/boot", ts: 1000 },
  { level: "info", event: "assets: bundle loaded", data: { bundle: "splash" }, ts: 1010 },
  { level: "info", event: "editor: agent attached", data: "s-7f3a", ts: 1020 },
  { level: "info", event: "flow: enter board/awaitIntent", data: { frame: 212 }, ts: 1030 },
  { level: "warn", event: "assets: missing texture", data: { key: "ui.gear" }, ts: 1040 },
  { level: "info", event: "model: commit", data: { frame: 1503, patches: 4 }, ts: 1050 },
  { level: "warn", event: "renderer: texture over budget", data: { mb: 31.1 }, ts: 1060 },
  { level: "info", event: "flow: merge rejected", data: { reason: "empty", frame: 1778 }, ts: 1070 }
];

/**
 * The trace as a wire value.
 *
 * @param entries - Trace entries (the design log by default).
 * @returns The Json value game.log delivers.
 */
export function traceValue(entries: readonly TraceEntry[] = TRACE): Json {
  return entries.map(entry => ({ ...entry }));
}

/**
 * An entry line.
 *
 * @param key - The key.
 * @param patch - Fields to override.
 * @returns The line.
 */
export function entryLine(key: number, patch: Partial<EntryLine> = {}): EntryLine {
  return {
    kind: "entry",
    key,
    level: "info",
    source: "flow",
    message: `line ${key}`,
    event: `flow: line ${key}`,
    ts: 1000 + key,
    frame: undefined,
    addedAt: 0,
    ...patch
  };
}

/**
 * A meta line.
 *
 * @param key - The key.
 * @param text - The text.
 * @returns The line.
 */
export function metaLine(key: number, text: MetaLine["text"] = "Console cleared"): MetaLine {
  return { kind: "meta", key, text, addedAt: 0 };
}

/** Does nothing (the Esc layer remover of the mock). */
const noop = (): void => {};

/** A workspace mock: badge, palette and keys as mocks. */
export type WorkspaceMock = {
  readonly api: WorkspaceApi;
  readonly badge: Mock<(ws: WorkspaceId, badge: Badge | undefined) => void>;
  readonly add: Mock<(item: PaletteItem | readonly PaletteItem[]) => () => void>;
  readonly bind: Mock<(binding: KeyBinding) => () => void>;
  readonly show: Mock<(ws: WorkspaceId) => void>;
  readonly items: PaletteItem[];
  readonly bindings: KeyBinding[];
  readonly removers: Mock<() => void>[];
};

/**
 * A workspace mock.
 *
 * @returns The mock.
 */
export function createWorkspaceMock(): WorkspaceMock {
  const items: PaletteItem[] = [];
  const bindings: KeyBinding[] = [];
  const removers: Mock<() => void>[] = [];
  const badge = vi.fn<(ws: WorkspaceId, badge: Badge | undefined) => void>();
  const show = vi.fn<(ws: WorkspaceId) => void>();
  const add = vi.fn((item: PaletteItem | readonly PaletteItem[]) => {
    const list: readonly PaletteItem[] = Array.isArray(item) ? item : [item as PaletteItem];
    items.push(...list);
    const remove = vi.fn(() => {
      for (const entry of list) items.splice(items.indexOf(entry), 1);
    });
    removers.push(remove);
    return remove;
  });
  const bind = vi.fn((binding: KeyBinding) => {
    bindings.push(binding);
    const remove = vi.fn(() => {
      bindings.splice(bindings.indexOf(binding), 1);
    });
    removers.push(remove);
    return remove;
  });
  return {
    badge,
    add,
    bind,
    show,
    items,
    bindings,
    removers,
    api: {
      badge,
      show,
      active: () => "console",
      palette: { add, open: vi.fn() },
      keys: { bind, escape: vi.fn(() => noop) },
      previewZone: vi.fn(() => noop)
    } as unknown as WorkspaceApi
  };
}

/** The emit mock: callable as the typed emit, inspectable as a mock. */
export type EmitMock = ConsoleCtx["emit"] & Mock<(name: string, payload: unknown) => void>;

/** A consoleView ctx whose emit, log, link, workspace and panels are mocks. */
export type TestCtx = Omit<ConsoleCtx, "emit" | "log"> & {
  readonly emit: EmitMock;
  readonly log: LogMock;
  readonly link: LinkMock;
  readonly workspace: WorkspaceMock;
  readonly registered: PanelSpec[];
  readonly require: Mock<Require> & Require;
};

/**
 * A consoleView domain ctx with a real state; require answers the mocks. The link is live at
 * frame 1840.
 *
 * @param config - Config overrides.
 * @returns The ctx.
 */
export function createCtx(config: Partial<Config> = {}): TestCtx {
  const link = createLinkMock();
  link.current = { kind: "live", frame: 1840 };
  const workspace = createWorkspaceMock();
  const registered: PanelSpec[] = [];
  const panels = { register: vi.fn((panel: PanelSpec) => registered.push(panel)) };
  const require = vi.fn((plugin: unknown) => {
    if (plugin === linkPlugin) return link.api;
    if (plugin === workspacePlugin) return workspace.api;
    if (plugin === panelsPlugin) return panels;
    throw new Error("unexpected require");
  }) as unknown as Mock<Require> & Require;
  const resolved = { ...CONFIG, ...config };
  return {
    config: resolved,
    state: createConsoleState({ config: resolved }),
    emit: vi.fn() as unknown as EmitMock,
    log: createLog(),
    require,
    link,
    workspace,
    registered
  };
}

/**
 * Lets pending promise callbacks run (no timers involved).
 */
export async function flush(): Promise<void> {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}
