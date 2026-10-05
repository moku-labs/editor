/**
 * @file workspace plugin — type definitions: config, workspace ids, preview, device, frame,
 * palette, keys, the api every view gets as `tools.workspace`, the payload of `workspace:ran`,
 * state and the domain context. DeviceSpec and the device preset types come from the protocol (R1).
 */
import type { Log } from "@moku-labs/common/browser";
import type { EmitFn } from "@moku-labs/core";
import type { Require, ToolsEvents } from "../../config";
import type {
  DevicePresetId,
  DeviceSpec,
  HotReload,
  Json,
  LinkStatus,
  Orientation,
  RunResult,
  WireError
} from "../registry/protocol";

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
  /**
   * After a save with Bun hot reload on, how long `gameFrame().reload()` waits for the page Bun
   * reloads before it reloads the frame itself.
   */
  hotReloadWaitMs: number;
  /** How long one toast stays (hover or focus pauses it). */
  toastMs: number;
};

/**
 * The colour theme.
 */
export type Theme = "light" | "dark";

/**
 * The applied density: compact (tighter spacing, smaller UI text) or comfortable.
 */
export type Density = "compact" | "comfortable";

/**
 * The chosen density; `auto` is compact below 820 px of window width, comfortable otherwise.
 */
export type DensityChoice = "auto" | Density;

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
 * The preset id, the orientation and the resolved size live in the protocol with DeviceSpec and
 * the presets (registry/protocol/devices.ts); re-exported here for `Workspace.*`.
 */
export type { DevicePresetId, DeviceSize, Orientation } from "../registry/protocol";

/**
 * What device() returns (R4): the preset as it shows now (an unfolded foldable carries its inner
 * screen's size and radius), the orientation, and whether a foldable is folded (true = cover).
 */
export type DeviceChoice = { preset: DeviceSpec; orientation: Orientation; folded: boolean };

/**
 * The stored device choice: the preset id, the orientation and, after a fold change, the folded
 * flag (absent = folded, the cover screen).
 */
export type StoredDevice = { preset: DevicePresetId; orientation: Orientation; folded?: boolean };

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
  /** Whether the game's sound is off (R11); gameView applies it with `game.mute`. */
  muted: boolean;
};

/**
 * The versioned record in localStorage (per-viewer conveniences only).
 */
export type StoredPrefs = {
  theme: Theme | undefined;
  previews: Record<PreviewWorkspace, PreviewPrefs>;
  device: StoredDevice;
  /** The chosen density (`auto` by default). */
  density: DensityChoice;
  /** Whether taps in the docked game draw a ripple (on by default). */
  showTaps: boolean;
  /** Whether the game's sound is off (sound on by default, R11). */
  muted: boolean;
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
 * Result of the D-07 reload. `hot_swap`: after a save the game swapped the module in place (dev
 * hot swap of game 0.5.0), so the frame was not reloaded and nothing was restored.
 */
export type ReloadResult = {
  restored: boolean;
  reason?:
    | "not_mounted"
    | "not_embedded"
    | "no_session"
    | "bookmark_failed"
    | "restore_failed"
    | "timeout"
    | "hot_swap";
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
 *
 * @example
 * ```ts
 * // Reload the game page and put it back where it was.
 * await app.workspace.gameFrame().reload({ restore: true }); // { restored: true }
 * ```
 */
export type GameFrame = {
  /**
   * Absolute URL of the game page: `link.boot()?.gameUrl` resolved against the page, "/" without
   * a boot. Read again on every access, so a refreshed boot is seen.
   *
   * @example
   * ```ts
   * // On the tools page http://127.0.0.1:3000/__editor with the boot gameUrl "/".
   * app.workspace.gameFrame().url; // "http://127.0.0.1:3000/"
   * ```
   */
  readonly url: string;

  /**
   * The D-07 reload after a save: bookmark, reload in place, restore on the new session, toast.
   * With Bun hot reload on, Bun reloads the page itself: the run waits up to `hotReloadWaitMs` for
   * that session and reloads the frame only when none came; a session the bridge already restored
   * (`manifest.restored`) is not restored or paused again. A game that hot swapped the saved
   * module in that wait (a `ui:hot-swap` game.log entry) ends the run with `reason: "hot_swap"`
   * and the toast "Game updated": no frame reload, no restore. Concurrent calls share one run.
   *
   * @param opts - `restore: true` bookmarks first and restores after.
   * @param opts.restore - Whether to bookmark and restore the game state.
   * @returns The result; `{ restored: false, reason: "not_mounted" }` before the first mount.
   * @example
   * ```ts
   * // The game code changed; reload it and keep the board.
   * await app.workspace.gameFrame().reload({ restore: true }); // { restored: true }
   * // A saved styles module the game swapped in place, with Bun hot reload on.
   * await app.workspace.gameFrame().reload({ restore: true }); // { restored: false, reason: "hot_swap" }
   * ```
   */
  reload(opts?: { restore?: boolean }): Promise<ReloadResult>;

  /**
   * Docks the frame over a stage slot (geometry only).
   *
   * @param slot - The stage slot.
   * @param opts - `fit` and an optional clip element.
   * @param opts.fit - How the device fits the slot.
   * @param opts.clip - The element that clips the frame.
   * @returns The release function.
   * @example
   * ```ts
   * // The Game workspace shows the game in its stage.
   * const release = app.workspace.gameFrame().dock(stage, { fit: "fit" });
   * app.workspace.gameFrame().box()?.docked; // "stage"
   * release(); // box()?.docked is "hidden"
   * ```
   */
  dock(slot: HTMLElement, opts: { fit: FrameFit; clip?: HTMLElement }): () => void;

  /**
   * The element above the iframe in device space (game CSS px, scaled with the frame). Its
   * pointer-events are none by default.
   *
   * @returns The overlay element.
   * @example
   * ```ts
   * // renderView draws its highlight boxes in game CSS px, wherever the frame is docked.
   * ctx.require(workspacePlugin).gameFrame().overlay().append(document.createElement("div"));
   * ```
   */
  overlay(): HTMLElement;

  /**
   * The current frame box in tools-page px.
   *
   * @returns A copy, undefined before the first mount.
   * @example
   * ```ts
   * // The frame floats in a preview at half size.
   * app.workspace.gameFrame().box()?.scale; // 0.5
   * ```
   */
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
  | "registry"
  | "seriesPopover"
  | "captureCard"
  | "picker"
  | "fileEdit"
  | "codeEdit"
  | "stepPopover"
  | "reference"
  | "selection";

/**
 * The workspace api (`app.workspace`, `tools.workspace` of every panel).
 *
 * @example
 * ```ts
 * // Save a style, then show the game.
 * app.workspace.toast("Saved", "src/styles.ts");
 * app.workspace.show("game");
 * ```
 */
export type WorkspaceApi = {
  /**
   * The shown workspace.
   *
   * @returns Its id.
   * @example
   * ```ts
   * app.workspace.active(); // "game" with the default config
   * ```
   */
  active(): WorkspaceId;

  /**
   * Shows a workspace. Emits `workspace:changed` only when it changes, and writes `#<ws>` into the
   * URL.
   *
   * @param ws - The workspace.
   * @throws {Error} `[moku-editor] Unknown workspace "<ws>".` for another id.
   * @example
   * ```ts
   * app.workspace.show("game"); // emits workspace:changed { ws: "game" }; location.hash is "#game"
   * ```
   */
  show(ws: WorkspaceId): void;

  /**
   * The effective theme: the chosen one, else the OS one.
   *
   * @returns light or dark.
   * @example
   * ```ts
   * app.workspace.theme(); // "light" on a light OS with no choice made
   * ```
   */
  theme(): Theme;

  /**
   * Sets the theme, or toggles it when omitted; persists the choice and sets `data-theme`.
   *
   * @param theme - The theme, omitted to toggle.
   * @example
   * ```ts
   * app.workspace.setTheme(); // light → dark
   * app.workspace.theme(); // "dark"
   * ```
   */
  setTheme(theme?: Theme): void;

  /**
   * The applied density: `auto` resolves to compact below 820 px of window width.
   *
   * @returns compact or comfortable.
   * @example
   * ```ts
   * // flowView spaces its layout by the density the shell shows.
   * ctx.require(workspacePlugin).density(); // "compact" in a 720 px window with the default "auto"
   * ```
   */
  density(): Density;

  /**
   * Chooses the density, persists the choice and sets `data-density` on `<html>`. Emits
   * `workspace:density` when the applied value changes.
   *
   * @param value - auto, compact or comfortable.
   * @example
   * ```ts
   * app.workspace.setDensity("compact"); // emits workspace:density { density: "compact" } in a wide window
   * app.workspace.density(); // "compact"
   * ```
   */
  setDensity(value: DensityChoice): void;

  /**
   * The preview state of a non-Game workspace.
   *
   * @param ws - The workspace.
   * @returns The prefs plus the float size in px.
   * @example
   * ```ts
   * app.workspace.preview("flow");
   * // { visible: true, size: "S", corner: "bottom-right", width: 150, height: 280 }
   * ```
   */
  preview(ws: PreviewWorkspace): PreviewState;

  /**
   * Patches the preview prefs and persists them. A visibility change shows a toast.
   *
   * @param ws - The workspace.
   * @param patch - visible, size and/or corner.
   * @example
   * ```ts
   * app.workspace.setPreview("render", { visible: false });
   * // toast: "Game preview hidden in Render · remembered for this workspace"
   * ```
   */
  setPreview(ws: PreviewWorkspace, patch: Partial<PreviewPrefs>): void;

  /**
   * The current device: the preset as it shows now (an unfolded foldable carries its inner
   * screen), the orientation and the folded flag.
   *
   * @returns The device choice.
   * @example
   * ```ts
   * // A fresh viewer.
   * app.workspace.device(); // { preset: { id: "iphone-18-pro", w: 402, h: 874, … }, orientation: "portrait", folded: true }
   * ```
   */
  device(): DeviceChoice;

  /**
   * Changes the preset, the orientation and/or the fold; the frame resizes live (the game sees a
   * window resize, no reload); the choice persists and `onPrefs` listeners run. A new preset
   * starts folded unless the patch says otherwise.
   *
   * @param patch - The preset, the orientation and/or the fold.
   * @param patch.preset - A preset id.
   * @param patch.orientation - portrait or landscape.
   * @param patch.folded - true for the cover screen of a foldable, false for the inner one.
   * @throws {Error} `[moku-editor] Unknown device "<id>".` for an unknown preset.
   * @example
   * ```ts
   * // gameView's Fold button opens the Galaxy Z Fold 6.
   * app.workspace.setDevice({ preset: "galaxy-z-fold-6" });
   * app.workspace.setDevice({ folded: false });
   * app.workspace.device().preset.w; // 707: the inner screen
   * ```
   */
  setDevice(patch: { preset?: DevicePresetId; orientation?: Orientation; folded?: boolean }): void;

  /**
   * The twenty-one presets in display order: iPhone, Android, Foldable, Tablet, Desktop. Each
   * carries its `frame` (R9): only the iPhone SE 3 has the home-button frame.
   *
   * @returns The DeviceSpec list.
   * @example
   * ```ts
   * // gameView lists the presets of each group under its own <optgroup>.
   * app.workspace.devices().filter(device => device.group === "foldable").map(device => device.id);
   * // ["galaxy-z-fold-6", "galaxy-z-flip-6", "pixel-9-pro-fold", "iphone-duo"]
   * ```
   */
  devices(): readonly DeviceSpec[];

  /**
   * The single game frame.
   *
   * @returns The GameFrame api: one object for the app's life.
   * @example
   * ```ts
   * app.workspace.gameFrame() === app.workspace.gameFrame(); // true
   * ```
   */
  gameFrame(): GameFrame;

  /**
   * The command palette.
   *
   * @example
   * ```ts
   * // A view adds its own command and opens the palette on it.
   * app.workspace.palette.add({ id: "cmd:capture", group: "Commands", label: "Capture", run: () => {} });
   * app.workspace.palette.open("capture");
   * ```
   */
  palette: {
    /**
     * Adds palette items; an existing id is replaced.
     *
     * @param item - One item or many.
     * @returns Removes them.
     * @example
     * ```ts
     * // flowView lists every node of the flow graph.
     * const remove = app.workspace.palette.add({ id: "node:a", group: "Nodes", label: "a", run: () => {} });
     * remove(); // the item leaves the palette
     * ```
     */
    add(item: PaletteItem | readonly PaletteItem[]): () => void;

    /**
     * Opens the palette.
     *
     * @param query - The initial query.
     * @example
     * ```ts
     * app.workspace.palette.open("merge"); // the palette shows the matches of "merge"
     * ```
     */
    open(query?: string): void;
  };

  /**
   * Shows a toast; `file` renders in mono after a middle dot.
   *
   * @param message - One line.
   * @param file - A file to name.
   * @example
   * ```ts
   * app.workspace.toast("Saved", "src/styles.ts");
   * ```
   */
  toast(message: string, file?: string): void;

  /**
   * Mounts the shell. The first call also creates the frame layer and the iframe.
   *
   * @param element - The mount element.
   * @example
   * ```ts
   * // The tools page entry mounts the shell after start.
   * await app.start();
   * app.workspace.mount(document.body);
   * ```
   */
  mount(element: HTMLElement): void;

  /**
   * The host element of a workspace: created on the first call, also before mount, and kept
   * after it.
   *
   * @param ws - The workspace.
   * @returns The host.
   * @example
   * ```ts
   * // panels mounts the Flow panels into the Flow host.
   * const unmount = app.panels.mountInto("flow", app.workspace.host("flow"));
   * ```
   */
  host(ws: WorkspaceId): HTMLElement;

  /**
   * Sets or clears the rail badge of a workspace.
   *
   * @param ws - The workspace.
   * @param badge - The badge, undefined to clear.
   * @example
   * ```ts
   * // The console counts 2 warnings and 1 error.
   * app.workspace.badge("console", { count: 3, tone: "error", label: "2 warn · 1 error" });
   * app.workspace.badge("console", undefined); // clears it
   * ```
   */
  badge(ws: WorkspaceId, badge: Badge | undefined): void;

  /**
   * Where the preview floats in a workspace. The remover drops the zone unless a newer zone
   * replaced it.
   *
   * @param ws - The workspace.
   * @param element - The zone element.
   * @param insets - Insets in px, or a function that reads them.
   * @returns Removes the zone.
   * @example
   * ```ts
   * // The flow panel keeps the preview inside its canvas, clear of the 56 px bars.
   * const remove = app.workspace.previewZone("flow", canvas, { top: 56, bottom: 56 });
   * ```
   */
  previewZone(
    ws: PreviewWorkspace,
    element: HTMLElement,
    insets?: Insets | (() => Insets)
  ): () => void;

  /**
   * The keyboard: bindings and Esc layers.
   *
   * @example
   * ```ts
   * // flowView binds "c" in Flow and closes its context menu on Esc.
   * app.workspace.keys.bind({ keys: "c", label: "Show where the game is", workspace: "flow", run: () => {} });
   * app.workspace.keys.escape("contextMenu", () => true);
   * ```
   */
  keys: {
    /**
     * Adds a key binding. Two bindings of one scope may share a combo only when one of them has a
     * `when` condition.
     *
     * @param binding - The binding.
     * @returns Removes it.
     * @throws {Error} `[moku-editor] Key "<combo>" is already bound in <scope>.` for a clash.
     * @example
     * ```ts
     * // flowView: "c" shows where the game is while Flow is shown.
     * const off = app.workspace.keys.bind({ keys: "c", label: "Show where the game is", workspace: "flow", run: () => {} });
     * off();
     * ```
     */
    bind(binding: KeyBinding): () => void;

    /**
     * Adds an Esc closer on a layer. Esc unwinds the open layers in rank order.
     *
     * @param layer - The layer.
     * @param close - Returns true when it closed something.
     * @returns Removes it.
     * @example
     * ```ts
     * // The context menu closes on Esc before the registry popover does.
     * const off = app.workspace.keys.escape("contextMenu", () => true);
     * off();
     * ```
     */
    escape(layer: EscLayer, close: () => boolean): () => void;
  };

  /**
   * The overlay-in-game flag. Always false at load; never persisted.
   *
   * @returns Whether it is on.
   * @example
   * ```ts
   * app.workspace.overlayInGame(); // false
   * ```
   */
  overlayInGame(): boolean;

  /**
   * Sets the overlay-in-game flag: runs `editor.overlay` with origin `panel`.
   *
   * @param on - The new flag.
   * @returns Resolves when the run settled.
   * @example
   * ```ts
   * await app.workspace.setOverlayInGame(true); // emits workspace:ran { id: "editor.overlay", … }
   * app.workspace.overlayInGame(); // true
   * ```
   */
  setOverlayInGame(on: boolean): Promise<void>;

  /**
   * The Reference mode flag: while on, the frame overlay takes the pointer, so the game gets no
   * input. Always false at load; never persisted.
   *
   * @returns Whether it is on.
   * @example
   * ```ts
   * app.workspace.reference(); // false
   * ```
   */
  reference(): boolean;

  /**
   * Turns Reference mode on or off; emits `workspace:reference` when it changes. Esc turns it off.
   *
   * @param on - The new flag.
   * @example
   * ```ts
   * app.workspace.setReference(true); // emits workspace:reference { on: true }
   * app.workspace.reference(); // true
   * ```
   */
  setReference(on: boolean): void;

  /**
   * The hot reload state of the game server, as link reports it: whether Bun reloads the game
   * page after a save, and who owns the server.
   *
   * @returns A copy of `{ hmr, owner }`; undefined until the hub sent one.
   * @example
   * ```ts
   * // Under the moku-editor bin.
   * app.workspace.hotReload(); // { hmr: true, owner: "bin" }
   * ```
   */
  hotReload(): HotReload | undefined;

  /**
   * Asks the server for hot reload on or off (`link.setHotReload`). The bin switches by restarting
   * its server (D-32): workspace bookmarks the game first, toasts the new state, waits for this
   * tab's game on the restarted server and reloads the game frame with that bookmark, so the page
   * gains or drops Bun's HMR client. A refusal (a game's own server) or a failed switch toasts how
   * to change hot reload and keeps that hint in the switch's tooltip.
   *
   * @param on - The asked value.
   * @returns True when the bin owns the server and its HMR now equals `on`; false otherwise.
   * Never rejects.
   * @example
   * ```ts
   * // The bin serves with HMR on.
   * await app.workspace.setHotReload(false); // true; toast "Hot reload off", then the game reloads with its state
   * ```
   */
  setHotReload(on: boolean): Promise<boolean>;

  /**
   * The sound flag of the game (R11): true while the viewer muted it. Kept in the preferences,
   * so it survives a reload of the tools page; false for a fresh viewer.
   *
   * @returns Whether the game's sound is off.
   * @example
   * ```ts
   * // gameView mutes the game again after it connects.
   * const workspace = ctx.require(workspacePlugin);
   * if (workspace.muted()) await ctx.require(panelsPlugin).run("game.mute", { muted: true });
   * ```
   */
  muted(): boolean;

  /**
   * Sets the sound flag and persists it; `onPrefs` listeners get the new `muted`. The same value
   * again changes nothing and calls no listener. The game is not touched here: gameView sends
   * `game.mute`.
   *
   * @param on - True to mute the game, false to give it its sound back.
   * @example
   * ```ts
   * // gameView's Sound switch.
   * app.workspace.setMuted(true);
   * app.workspace.muted(); // true; onPrefs listeners got { …, muted: true }
   * ```
   */
  setMuted(on: boolean): void;

  /**
   * Listens to preference changes (theme, preview, device, sound). A throwing listener is logged
   * and does not stop the others.
   *
   * @param fn - The listener.
   * @returns Removes it.
   * @example
   * ```ts
   * const off = app.workspace.onPrefs(prefs => console.log(prefs.theme));
   * app.workspace.setTheme("dark"); // logs "dark"
   * off();
   * ```
   */
  onPrefs(fn: (prefs: Prefs) => void): () => void;
};

/**
 * One tap ripple alive in the frame overlay.
 */
export type TapRipple = {
  readonly element: HTMLElement;
  readonly timer: ReturnType<typeof setTimeout>;
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
  /** The preview body the frame docks over outside Game; set by the Preview component. */
  previewBody: HTMLElement | undefined;
};

/**
 * The tiny store the Preact components re-render from.
 */
export type UiStore = {
  /** Raised by one on every `bump()`; starts at 0. */
  version: number;
  /**
   * Adds a subscriber.
   *
   * @param fn - Called after every bump.
   * @returns Unsubscribe: later bumps no longer call `fn`.
   */
  subscribe(fn: () => void): () => void;
  /**
   * Raises the version and calls every subscriber.
   */
  bump(): void;
};

/**
 * Workspace state.
 */
export type WorkspaceState = {
  active: WorkspaceId;
  theme: { chosen: Theme | undefined; os: Theme };
  /** The chosen density and the value it resolves to now. */
  density: { chosen: DensityChoice; applied: Density };
  previews: Record<PreviewWorkspace, PreviewPrefs>;
  device: StoredDevice;
  /** Always false at load; never persisted. */
  overlayInGame: boolean;
  /** Reference mode: always false at load; never persisted. */
  reference: boolean;
  /** Whether taps draw a ripple in the docked frame (persisted). */
  showTaps: boolean;
  /** Whether the game's sound is off (persisted, R11). */
  muted: boolean;
  /** The tap ripples alive in the overlay, oldest first (at most 8). */
  taps: TapRipple[];
  link: LinkStatus;
  /**
   * The game name and session id of the last manifest. The top bar keeps showing them while the
   * link reloads (U9: the bar does not move sideways); a real loss shows "No game".
   */
  shown: { game: string | undefined; session: string | undefined };
  everLive: boolean;
  badges: Partial<Record<WorkspaceId, Badge>>;
  toasts: Toast[];
  nextToastId: number;
  palette: { open: boolean; query: string; index: number; items: Map<string, PaletteItem> };
  keys: { bindings: KeyBindingEntry[]; escape: EscEntry[] };
  popover: "step" | "registry" | "session" | "more" | undefined;
  /** How to change hot reload, after a refused or failed switch; shown in the switch title. */
  hotReloadNote: string | undefined;
  /** The last `manifest.restored` toasted (frame and bookmark), so each restore toasts once. */
  lastRestore: string | undefined;
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
  /** The 1 s ticker while the link is silent or lost (handlers). */
  ticker: ReturnType<typeof setInterval> | undefined;
  /** Set by onStop; late callbacks (reload, toasts, manifest) return early. */
  stopped: boolean;
};

/**
 * Domain context of workspace: the kernel context is assignable to it.
 */
export type WorkspaceCtx = {
  readonly config: Readonly<WorkspaceConfig>;
  state: WorkspaceState;
  readonly emit: EmitFn<
    Pick<
      ToolsEvents,
      "workspace:changed" | "workspace:ran" | "workspace:density" | "workspace:reference"
    >
  >;
  readonly log: Log.LogApi;
  readonly require: Require;
};

/**
 * The workspace's hooks.
 */
export type WorkspaceHooks = {
  readonly "link:status": (payload: ToolsEvents["link:status"]) => void;
};
