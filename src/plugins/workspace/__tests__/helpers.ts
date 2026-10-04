/* eslint-disable unicorn/no-null -- null is a JSON value on the wire */
import type { Mock } from "vitest";
import { vi } from "vitest";
import type { Require } from "../../../config";
import type { LinkApi } from "../../link/types";
import type {
  CommandDescriptor,
  Json,
  LinkStatus,
  Manifest,
  RunResult,
  SessionInfo,
  Tap,
  ToolsBoot
} from "../../registry/protocol";
import { createWorkspaceState } from "../state";
import type { WorkspaceConfig, WorkspaceCtx } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Shared test helpers of workspace: a log mock, a scripted link api, a domain
// ctx with a real state, and wire fixtures (manifest, run result, boot).
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
 * A page URL tagged with a frame id, as link's `frameUrl` builds it.
 *
 * @param url - The page URL.
 * @param frame - The frame id; default the mock's own.
 * @returns The tagged URL.
 */
export function tagged(url: string, frame = FRAME): string {
  const parsed = new URL(url);
  parsed.searchParams.set("__editorFrame", frame);
  return parsed.href;
}

/** A tap listener, as link's `onTap` takes it. */
type TapListener = (tap: Tap) => void;

/** A scripted link api: plain fields the test sets, mocks for the calls. */
export type LinkMock = {
  [K in keyof Omit<LinkApi, "files">]: Mock<LinkApi[K]>;
} & {
  files: LinkApi["files"];
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
  const link: LinkMock = {
    current: { kind: "connecting" },
    manifestValue: undefined,
    bootValue: BOOT,
    sessionList: [],
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
    boot: vi.fn<LinkApi["boot"]>(() => link.bootValue),
    frameUrl: vi.fn<LinkApi["frameUrl"]>(url => tagged(url)),
    isOtherTab: vi.fn<LinkApi["isOtherTab"]>(page => {
      const frame = new URL(page).searchParams.get("__editorFrame");
      return frame !== null && frame !== FRAME;
    }),
    files: {
      list: vi.fn(() => Promise.resolve([])),
      read: vi.fn(() => Promise.resolve({ text: "", version: "v" })),
      write: vi.fn(() => Promise.resolve({ path: "", bytes: 0, version: "v" })),
      writeBinary: vi.fn(() => Promise.resolve({ path: "", bytes: 0, version: "v" })),
      readBinary: vi.fn(() => Promise.resolve({ dataUrl: "", version: "v" }))
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
    tapListeners,
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

/** The emit mock: callable as the typed emit, inspectable as a mock. */
export type EmitMock = WorkspaceCtx["emit"] & Mock<(name: string, payload: unknown) => void>;

/** A workspace ctx whose emit, log and link are mocks. */
export type TestCtx = Omit<WorkspaceCtx, "emit" | "log"> & {
  readonly emit: EmitMock;
  readonly log: LogMock;
  readonly link: LinkMock;
};

/**
 * A workspace domain ctx with a real state and mock emit, log and link.
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
  const require = vi.fn(() => link) as unknown as Require;

  return {
    config: resolved,
    state: createWorkspaceState({ config: resolved }),
    emit: vi.fn() as unknown as EmitMock,
    log: createLog(),
    require,
    link
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
