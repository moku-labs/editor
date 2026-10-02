/**
 * @file workspace plugin — type definitions: config, workspace ids, preview, device, frame,
 * palette, keys, the api every view gets as `tools.workspace`, the payload of `workspace:ran`,
 * state and the domain context. DeviceSpec comes from the protocol (R1).
 */
import type { Log } from "@moku-labs/common/browser";
import type { EmitFn } from "@moku-labs/core";
import type { Require, ToolsEvents } from "../../config";
import type { DeviceSpec, Json, LinkStatus, RunResult, WireError } from "../registry/protocol";

/**
 * The six workspaces.
 */
export type WorkspaceId = "flow" | "game" | "render" | "state" | "files" | "console";

/**
 * Workspace configuration (`defaultWorkspace`, `storageKey` from contracts §5; the rest private).
 *
 * @example
 * ```ts
 * createApp({ pluginConfigs: { workspace: { defaultWorkspace: "game" } } });
 * ```
 */
export type WorkspaceConfig = {
  /** Workspace shown at start when the URL hash names none. */
  defaultWorkspace: WorkspaceId;
  /** localStorage key of the preferences record. */
  storageKey: string;
  /** How long reload() waits for the new session before giving up. */
  reloadTimeoutMs: number;
  /** How long one toast stays (hover or focus pauses it). */
  toastMs: number;
};

/**
 * The colour theme.
 */
export type Theme = "light" | "dark";

/**
 * A workspace that has a pinned game preview (every one but Game).
 */
export type PreviewWorkspace = Exclude<WorkspaceId, "game">;

/**
 * Preview float size: S 150×280, M 280×540, L 340×660.
 */
export type PreviewSize = "S" | "M" | "L";

/**
 * Corner of the preview float.
 */
export type PreviewCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

/**
 * Persisted preview preferences of one workspace.
 */
export type PreviewPrefs = { visible: boolean; size: PreviewSize; corner: PreviewCorner };

/**
 * Preview preferences plus the float size in px.
 */
export type PreviewState = PreviewPrefs & { width: number; height: number };

/**
 * The six device presets.
 */
export type DevicePresetId =
  | "iphone-se"
  | "iphone-15"
  | "iphone-15-pro-max"
  | "pixel-8"
  | "ipad-mini"
  | "desktop";

/**
 * Device orientation.
 */
export type Orientation = "portrait" | "landscape";

/**
 * What device() returns (R4).
 */
export type DeviceChoice = { preset: DeviceSpec; orientation: Orientation };

/**
 * Size and safe insets of a preset in an orientation (resolveDevice, R8).
 */
export type DeviceSize = {
  w: number;
  h: number;
  safe: { top: number; right: number; bottom: number; left: number };
};

/**
 * A rail badge.
 */
export type Badge = { count: number; tone: "warn" | "error"; label: string };

/**
 * The preferences onPrefs listeners receive.
 */
export type Prefs = {
  theme: Theme;
  previews: Record<PreviewWorkspace, PreviewPrefs>;
  device: DeviceChoice;
};

/**
 * The versioned record in localStorage (per-viewer conveniences only).
 */
export type StoredPrefs = {
  theme: Theme | undefined;
  previews: Record<PreviewWorkspace, PreviewPrefs>;
  device: { preset: DevicePresetId; orientation: Orientation };
};

/**
 * How the frame fits its stage slot.
 */
export type FrameFit = "fit" | "actual";

/**
 * A plain rectangle in tools-page px.
 */
export type RectBox = {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
};

/**
 * The frame box in tools-page px.
 */
export type FrameBox = {
  left: number;
  top: number;
  width: number;
  height: number;
  scale: number;
  docked: "preview" | "stage" | "hidden";
};

/**
 * Result of the D-07 reload.
 */
export type ReloadResult = {
  restored: boolean;
  reason?:
    | "not_mounted"
    | "not_embedded"
    | "no_session"
    | "bookmark_failed"
    | "restore_failed"
    | "timeout";
};

/**
 * Where a command run started.
 */
export type RunOrigin = "topbar" | "palette" | "key" | "panel";

/**
 * Payload of the global tools event `workspace:ran` (R4).
 *
 * @example
 * ```ts
 * const ran: RanEvent = { id: "game.step", input: { frames: 1 }, origin: "topbar", at: Date.now(), ok: true, result };
 * ```
 */
export type RanEvent = {
  readonly id: string;
  readonly input: Json | undefined;
  readonly origin: RunOrigin;
  /** Date.now() when the call settled. */
  readonly at: number;
} & (
  | { readonly ok: true; readonly result: RunResult }
  | { readonly ok: false; readonly error: WireError }
);

/**
 * Insets in px; missing sides are 0.
 */
export type Insets = { top?: number; right?: number; bottom?: number; left?: number };

/**
 * The one game frame of the tools page (R4, D-14): it never moves in the DOM.
 */
export type GameFrame = {
  /** Absolute URL of the game page (link.boot()?.gameUrl, else "/"). */
  readonly url: string;
  /** D-07 reload; concurrent calls share one run. */
  reload(opts?: { restore?: boolean }): Promise<ReloadResult>;
  /** Docks the frame over a stage slot (geometry only); returns the release function. */
  dock(slot: HTMLElement, opts: { fit: FrameFit; clip?: HTMLElement }): () => void;
  /** Element above the iframe in device space (game CSS px). */
  overlay(): HTMLElement;
  /** Current frame box, undefined before the first mount. */
  box(): FrameBox | undefined;
};

/**
 * Palette groups, in display order.
 */
export type PaletteGroup = "Commands" | "Nodes" | "Files" | "Styles" | "Panels" | "Textures";

/**
 * One palette item.
 */
export type PaletteItem = {
  id: string;
  group: PaletteGroup;
  label: string;
  mono?: boolean;
  hint?: string;
  keywords?: string;
  shortcut?: string;
  run(): void;
  /** ⇧↵, e.g. "Open in Files". */
  alt?: { label: string; run(): void };
  /** Reason shown dimmed; the item does not run. */
  disabled?: () => string | false;
};

/**
 * One scored palette match with its highlight ranges.
 */
export type PaletteMatch = {
  readonly score: number;
  readonly ranges: readonly (readonly [start: number, end: number])[];
};

/**
 * One palette group as shown (3 items without a query, up to 8 with one).
 */
export type PaletteGroupView = {
  readonly group: PaletteGroup;
  readonly total: number;
  readonly items: readonly {
    readonly item: PaletteItem;
    readonly match: PaletteMatch | undefined;
  }[];
};

/**
 * A key binding (design §4).
 */
export type KeyBinding = {
  /** "mod+k" or ["shift+mod+c", "i"]. */
  keys: string | readonly string[];
  /** Shown in tooltips and the palette. */
  label: string;
  run(event: KeyboardEvent): void;
  /** Active only there; omitted = global. */
  workspace?: WorkspaceId;
  when?: () => boolean;
  inInputs?: boolean;
};

/**
 * A parsed key combo.
 */
export type ParsedCombo = {
  readonly mod: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
  readonly key: string;
};

/**
 * Esc layers in unwinding rank order (design §4).
 */
export type EscLayer =
  | "palette"
  | "contactSheet"
  | "contextMenu"
  | "noteEditor"
  | "registry"
  | "seriesPopover"
  | "captureCard"
  | "picker"
  | "fileEdit"
  | "codeEdit"
  | "stepPopover"
  | "selection";

/**
 * The workspace api (`app.workspace`, `tools.workspace` of every panel).
 *
 * @example
 * ```ts
 * app.workspace.show("game");
 * app.workspace.toast("✓ Note saved", ".moku/notes/2026-09-24-first-top-item.md");
 * ```
 */
export type WorkspaceApi = {
  active(): WorkspaceId;
  show(ws: WorkspaceId): void;
  theme(): Theme;
  setTheme(theme?: Theme): void;
  preview(ws: PreviewWorkspace): PreviewState;
  setPreview(ws: PreviewWorkspace, patch: Partial<PreviewPrefs>): void;
  device(): DeviceChoice;
  setDevice(patch: { preset?: DevicePresetId; orientation?: Orientation }): void;
  devices(): readonly DeviceSpec[];
  gameFrame(): GameFrame;
  palette: {
    add(item: PaletteItem | readonly PaletteItem[]): () => void;
    open(query?: string): void;
  };
  toast(message: string, file?: string): void;
  mount(element: HTMLElement): void;
  host(ws: WorkspaceId): HTMLElement;
  badge(ws: WorkspaceId, badge: Badge | undefined): void;
  previewZone(
    ws: PreviewWorkspace,
    element: HTMLElement,
    insets?: Insets | (() => Insets)
  ): () => void;
  keys: {
    bind(binding: KeyBinding): () => void;
    escape(layer: EscLayer, close: () => boolean): () => void;
  };
  overlayInGame(): boolean;
  setOverlayInGame(on: boolean): Promise<void>;
  onPrefs(fn: (prefs: Prefs) => void): () => void;
};

/**
 * One visible toast.
 */
export type Toast = {
  readonly id: number;
  readonly message: string;
  readonly file: string | undefined;
  timer: ReturnType<typeof setTimeout> | undefined;
};

/**
 * A registered key binding with its parsed combos.
 */
export type KeyBindingEntry = {
  readonly combos: readonly ParsedCombo[];
  readonly binding: KeyBinding;
};

/**
 * A registered Esc closer.
 */
export type EscEntry = {
  readonly layer: EscLayer;
  readonly close: () => boolean;
  readonly order: number;
};

/**
 * The Game stage dock.
 */
export type StageDock = {
  readonly slot: HTMLElement;
  readonly fit: FrameFit;
  readonly clip: HTMLElement | undefined;
};

/**
 * A reload in flight; `again` asks for one more run after it.
 */
export type PendingReload = { readonly promise: Promise<ReloadResult>; again: boolean };

/**
 * Where the preview floats in a workspace.
 */
export type PreviewZone = {
  readonly element: HTMLElement;
  readonly insets: Insets | (() => Insets) | undefined;
};

/**
 * The frame layer: created by the first mount, never re-parented.
 */
export type FrameState = {
  iframe: HTMLIFrameElement | undefined;
  layer: HTMLElement | undefined;
  box: FrameBox | undefined;
  overlay: HTMLElement | undefined;
  stage: StageDock | undefined;
  reload: PendingReload | undefined;
  zones: Map<PreviewWorkspace, PreviewZone>;
};

/**
 * The tiny store the Preact components re-render from.
 */
export type UiStore = {
  version: number;
  subscribe(fn: () => void): () => void;
  bump(): void;
};

/**
 * Workspace state.
 */
export type WorkspaceState = {
  active: WorkspaceId;
  theme: { chosen: Theme | undefined; os: Theme };
  previews: Record<PreviewWorkspace, PreviewPrefs>;
  device: { preset: DevicePresetId; orientation: Orientation };
  /** Always false at load; never persisted. */
  overlayInGame: boolean;
  link: LinkStatus;
  everLive: boolean;
  badges: Partial<Record<WorkspaceId, Badge>>;
  toasts: Toast[];
  nextToastId: number;
  palette: { open: boolean; query: string; index: number; items: Map<string, PaletteItem> };
  keys: { bindings: KeyBindingEntry[]; escape: EscEntry[] };
  popover: "step" | "registry" | "session" | undefined;
  /** Last step result for D1. */
  step: RanEvent | undefined;
  frame: FrameState;
  dom: {
    root: HTMLElement | undefined;
    hosts: Map<WorkspaceId, HTMLElement>;
    cleanup: (() => void)[];
  };
  listeners: Set<(prefs: Prefs) => void>;
  ui: UiStore;
};

/**
 * Domain context of workspace: the kernel context is assignable to it.
 */
export type WorkspaceCtx = {
  readonly config: Readonly<WorkspaceConfig>;
  state: WorkspaceState;
  readonly emit: EmitFn<Pick<ToolsEvents, "workspace:changed" | "workspace:ran">>;
  readonly log: Log.LogApi;
  readonly require: Require;
};

/**
 * The workspace's hooks.
 */
export type WorkspaceHooks = {
  readonly "link:status": (payload: ToolsEvents["link:status"]) => void;
};
