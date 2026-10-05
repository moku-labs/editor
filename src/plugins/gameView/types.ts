/**
 * @file gameView plugin — type definitions: config, state, recording, contact sheet, style card,
 * capture and series shapes, the api, the domain context and the hooks. The scene types are
 * declared once in panels/shared/scene (R8) and re-exported here for `GameView.ElementRef`.
 */
import type { Log } from "@moku-labs/common/browser";
import type { EmitFn } from "@moku-labs/core";
import type { Require, ToolsEvents } from "../../config";
import type {
  Calibration,
  ElementRef,
  PageRect,
  SceneSnapshot,
  TextureCatalogue
} from "../panels/shared/scene";
import type { StyleBlock, StyleBlockRef, StyleEditError } from "../panels/shared/style-edit";
import type { FileText, Json, LinkStatus, SelectionInfo } from "../registry/protocol";
import type { FrameBox } from "../workspace/types";

export type {
  Calibration,
  ElementRef,
  PageRect,
  SceneNode,
  SceneSnapshot,
  TextureCatalogue,
  TextureInfo
} from "../panels/shared/scene";

/**
 * gameView configuration.
 *
 * @example
 * ```ts
 * createApp({ pluginConfigs: { gameView: { manifestPaths: ["public/manifest.json"] } } });
 * ```
 */
export type GameViewConfig = {
  /** Folder of screenshots and series, relative to the files root; each in a `<yyyy-mm-dd>/` day folder. */
  capturesDir: string;
  /** Where the game's asset manifest may live, tried in order. */
  manifestPaths: readonly string[];
  /** The capture card hides after this unless hovered or focused. */
  captureCardMs: number;
  /** Duration chips of the series popover (the longest equals capture's maxDurationMs). */
  seriesDurationsMs: readonly number[];
  /** Interval chips of the series popover (the shortest equals capture's minIntervalMs). */
  seriesIntervalsMs: readonly number[];
  /** Above this many planned shots the popover warns. */
  seriesWarnShots: number;
  /**
   * Source search for the style block of a picked element: from the folder of the game page
   * entry first, then the root. Config merges shallowly, so an override replaces this object as a
   * whole: pass both fields.
   *
   * @example
   * ```ts
   * createApp({
   *   pluginConfigs: { gameView: { sourceSearch: { maxFiles: 3000, skip: ["node_modules", "dist", ".git", ".moku"] } } }
   * });
   * ```
   */
  sourceSearch: { readonly maxFiles: number; readonly skip: readonly string[] };
};

/**
 * A series being recorded or written.
 */
export type Recording = {
  readonly folder: string;
  readonly label: string;
  /** performance.now() at start. */
  readonly startedAt: number;
  readonly durationMs: number;
  readonly intervalMs: number;
  readonly planned: number;
  phase: "recording" | "writing";
  written: number;
  stopRequested: boolean;
};

/**
 * One shot of a saved series (index.json).
 *
 * @example
 * ```ts
 * const shot: SeriesShot = { file: "001.png", frame: 1777, atMs: 0, bug: false };
 * ```
 */
export type SeriesShot = {
  readonly file: string;
  readonly frame: number;
  readonly atMs: number;
  bug: boolean;
};

/**
 * `index.json` of a series folder (filesView reads the same shape).
 *
 * @example
 * ```ts
 * const index: SeriesIndex = { label: "board/awaitIntent", durationMs: 200, intervalMs: 50, fromFrame: 1777, shots: [] };
 * ```
 */
export type SeriesIndex = {
  label: string;
  durationMs: number;
  intervalMs: number;
  fromFrame: number;
  shots: SeriesShot[];
  device?: { name: string; w: number; h: number; orientation: "portrait" | "landscape" };
  stoppedEarly?: boolean;
};

/**
 * The open contact sheet.
 */
export type Sheet = {
  indexPath: string;
  index: SeriesIndex;
  images: readonly (string | undefined)[];
  version: string | undefined;
  /** Shot index of the large view. */
  big: number | undefined;
};

/**
 * A stepper burst waiting for its debounce.
 */
export type PendingEdit = {
  readonly path: string;
  readonly raw: string;
  readonly next: number;
};

/**
 * The layout style card of the selected element.
 */
export type StyleCard = {
  path: string;
  current: FileText;
  ref: StyleBlockRef;
  block: StyleBlock;
  pending: PendingEdit | undefined;
  error: StyleEditError | undefined;
};

/**
 * Where a source search found a ui key: `ident` with `style={ident}` (the editable card), `call`
 * with `style={call(...)}` (a read-only card), `defined` with no style on the element. `line` is
 * the 1-based line of the key. A `defined` with `loop` found no literal key: its line builds the
 * key in a template literal (`card${slot}` for "card0"). A `defined` with `textStyle` is a text
 * node with `style="ui.link"`: the Code section shows that key's block (round 2b R17).
 *
 * @example
 * ```ts
 * const source: StyleSource = { kind: "defined", path: "features/settings/settings.tsx", line: 301 };
 * const card: StyleSource = { kind: "defined", path: "features/orders/strip.tsx", line: 157, loop: true };
 * const link: StyleSource = { kind: "defined", path: "features/settings/settings.tsx", line: 318, textStyle: "ui.link" };
 * ```
 */
export type StyleSource =
  | {
      readonly kind: "ident";
      readonly path: string;
      readonly line: number;
      readonly ref: Extract<StyleBlockRef, { readonly kind: "const" }>;
      /** Files that may hold the block, in order: the key file, then the import candidates. */
      readonly files: readonly string[];
    }
  | {
      readonly kind: "call";
      readonly path: string;
      readonly line: number;
      /** The call as written: `boardOf(props.width, props.height)`. */
      readonly call: string;
      /** 1-based line of the `style={…}` attribute. */
      readonly callLine: number;
    }
  | {
      readonly kind: "defined";
      readonly path: string;
      readonly line: number;
      /** The key is built in a loop: the line holds its template literal. */
      readonly loop?: true;
      /** The text style key of a text node (`style="ui.link"`): its block is in the styles file. */
      readonly textStyle?: string;
    };

/**
 * Where the style search of the selected element stands while no StyleCard is shown: searching,
 * nothing found, found but the shared style edit refused the file (no-file, parse, no-key,
 * ambiguous), a style computed by a call (read-only), or the element found without a style.
 */
export type StyleLookup =
  | { readonly key: string; readonly status: "searching" }
  | { readonly key: string; readonly status: "missing" }
  | {
      readonly key: string;
      readonly status: "failed";
      readonly path: string;
      readonly error: StyleEditError;
    }
  | {
      readonly key: string;
      readonly status: "call";
      readonly path: string;
      readonly line: number;
      readonly call: string;
    }
  | {
      readonly key: string;
      readonly status: "defined";
      readonly path: string;
      readonly line: number;
      /** The key is built in a loop: the line holds its template literal. */
      readonly loop?: true;
    };

/**
 * The keyed ui node the calibration reads `game.rect` for: its key, its drawn rect and the ui
 * root rect, in reference units.
 */
export type CalibrationTarget = {
  readonly key: string;
  readonly drawn: PageRect;
  readonly root: PageRect;
};

/**
 * Where the calibration stands between two reads (finding 3).
 */
export type CalibrationRun = {
  /** Bumped by every game.ui value; a read that saw another revision is stale. */
  revision: number;
  /** The target of the calibration in use; undefined before the first read. */
  used: CalibrationTarget | undefined;
  /** A game.rect read is in flight. */
  reading: boolean;
  /** The calibration in flight (its read, a retry and the rebuild); `scene()` waits for it. */
  pending: Promise<void> | undefined;
  /** A device change waits for the next game.ui value before it reads. */
  waiting: boolean;
};

/**
 * A point in client px (the pointer).
 */
export type ClientPoint = { readonly x: number; readonly y: number };

/**
 * A press on the Reference mode proxy layer (U9, A16): where it started, whether it became an area
 * drag (the pointer moved 4 client px or more) and whether Esc cancelled that drag.
 */
export type AreaPress = {
  readonly pointerId: number;
  readonly start: ClientPoint;
  /** The frame box at the press, read once: the marquee maps through it for the whole drag. */
  readonly box: FrameBox | undefined;
  /** The pointer moved 4 client px or more: the layer holds the pointer, the marquee follows. */
  dragging: boolean;
  /** Esc ended the drag: the release picks nothing. */
  cancelled: boolean;
};

/**
 * Reference mode as gameView sees it (D-27): proxies of the scene nodes in the frame overlay.
 */
export type ReferenceState = {
  /** workspace:reference said on. */
  on: boolean;
  /** The node id of the proxy under the pointer: the overlay draws the picker hover box. */
  hover: string | undefined;
  /** "<flow>/<node>" of the watched game.position while on. */
  node: string | undefined;
  /** Unwatches game.position; undefined while off. */
  unwatch: (() => void) | undefined;
  /** The press on the proxy layer until its release (U9). */
  press: AreaPress | undefined;
  /** The marquee of an area drag in device px; undefined while no drag runs (A16). */
  area: PageRect | undefined;
};

/**
 * The bookmark a completed pick took (`game.bookmark`), kept in gameView state, newest first, at
 * most 20. `value` is what `game.restore { bookmark }` takes back.
 *
 * @example
 * ```ts
 * const bookmark: PickBookmark = { id: "settingsBoard-f1841", frame: 1841, key: "settingsBoard", at: 1_790_000_000_000, value: { path: "settingsPopup/open" } };
 * ```
 */
export type PickBookmark = {
  /** `<key>-f<frame>`, with `-2`, `-3` … when taken; the `restore:` line prints it. */
  readonly id: string;
  /** The frame of the rest point the bookmark holds. */
  readonly frame: number;
  /** The ui key of the picked element, else its name. */
  readonly key: string;
  /** Date.now() when it was taken. */
  readonly at: number;
  readonly value: Json;
};

/**
 * What the last completed pick added to the reference block of its element: the bookmark id,
 * the crop and the full frame, and the tainted flag of the bookmark run.
 */
export type LastPick = {
  /** The scene node id of the picked element. */
  readonly nodeId: string;
  /** The frame the pick shows (the shot's, else the bookmark's, else the scene's). */
  readonly frame: number;
  readonly bookmark: string | undefined;
  readonly crop: string | undefined;
  readonly full: string | undefined;
  readonly tainted: boolean | undefined;
};

/**
 * How a pick ends (A8): `copy` puts the reference line on the clipboard with a toast; MCP
 * `moku_select` passes false. The capture card shows either way.
 */
export type PickOptions = { readonly copy: boolean };

/**
 * What a completed pick wrote and published (A8): the full block, the one line, the card, the
 * crop and the full frame (undefined when not written), the frame of the pick and the selection.
 *
 * @example
 * ```ts
 * const result: PickResult = {
 *   block: "@moku coinPill · row · board/awaitIntent · f1842\n…",
 *   line: "@moku coinPill row · board/awaitIntent · ref 235,74 290×76 · .moku/captures/2026-10-05/coinPill-f1842.md",
 *   card: ".moku/captures/2026-10-05/coinPill-f1842.md",
 *   crop: ".moku/captures/2026-10-05/coinPill-f1842-crop.jpg",
 *   full: ".moku/captures/2026-10-05/f1842-full.jpg",
 *   frame: 1842,
 *   info
 * };
 * ```
 */
export type PickResult = {
  readonly block: string;
  readonly line: string;
  readonly card: string | undefined;
  readonly crop: string | undefined;
  readonly full: string | undefined;
  readonly frame: number;
  /** The SelectionInfo of the pick: its card, crop, line and frame (published while selected). */
  readonly info: SelectionInfo;
};

/**
 * Where the style block of a ui key was found: its file and the 1-based line of the block.
 */
export type BlockAt = { readonly path: string; readonly line: number };

/**
 * Lines of one source file the Element tab and the reference card show (round 2b R12).
 *
 * @example
 * ```ts
 * const jsx: CodeSnippet = { path: "src/hud/Hud.tsx", line: 2, lines: ['<Pill key="coinPill" style={coinPill} />'] };
 * ```
 */
export type CodeSnippet = {
  readonly path: string;
  /** The 1-based line of the first of `lines`. */
  readonly line: number;
  readonly lines: readonly string[];
};

/**
 * The style block a ui element uses: the `defineStyle` block of `style={ident}` named by the
 * identifier, or the text style key block of `style="ui.link"` named by the key (round 2b R17).
 */
export type StyleSnippet = CodeSnippet & { readonly name: string };

/**
 * One component of an entity with its value, shortened to one line ("" without a JSON value).
 */
export type ComponentRow = { readonly name: string; readonly value: string };

/**
 * The code of a picked element (round 2b R12): for a ui element its JSX and the style block it
 * uses; for an entity the projection that spawns it, where that projection is defined, and its
 * components with their values.
 *
 * @example
 * ```ts
 * const code: ElementCode = { kind: "entity", projection: "board.items", spawn: { path: "features/board/items.tsx", line: 40 }, components: [{ name: "Order", value: "value 11" }] };
 * ```
 */
export type ElementCode =
  | {
      readonly kind: "ui";
      /** The element from the line that opens its tag to the line that closes it. */
      readonly jsx: CodeSnippet | undefined;
      /** The `defineStyle` block of `style={ident}`, or the text style key block of `style="ui.link"`. */
      readonly style: StyleSnippet | undefined;
    }
  | {
      readonly kind: "entity";
      /** The projection key of game.projections (the entity's owner). */
      readonly projection: string;
      /** The line that defines the projection, undefined when no source names it. */
      readonly spawn: BlockAt | undefined;
      readonly components: readonly ComponentRow[];
    };

/**
 * A saved screenshot.
 *
 * @example
 * ```ts
 * const shot: CaptureFile = { path: ".moku/captures/2026-10-05/0846-board.jpg", frame: 1841, device: "iPhone 15 portrait", image: "data:image/jpeg;base64,…" };
 * ```
 */
export type CaptureFile = {
  readonly path: string;
  readonly frame: number;
  /** "iPhone 15 portrait". */
  readonly device: string;
  readonly image: string;
};

/**
 * What the capture card shows (round 2b R14): a screenshot; the shot of a pick, with its
 * reference line; or a written series, its folder in `path` and its first shot in `image`.
 *
 * @example
 * ```ts
 * const card: CaptureCardInfo = { path: ".moku/captures/2026-10-05/series-1015/", frame: 1777, device: "iPhone 15 portrait", image: "data:image/png;base64,…", series: { indexPath: ".moku/captures/2026-10-05/series-1015/index.json", shots: 20 } };
 * ```
 */
export type CaptureCardInfo = CaptureFile & {
  /** A series: its index.json ("Open" shows its contact sheet) and the shots written. */
  readonly series?: { readonly indexPath: string; readonly shots: number };
  /** The reference line of the pick that took the shot ("Reference" copies it). */
  readonly reference?: string;
};

/**
 * A written series.
 *
 * @example
 * ```ts
 * const result: SeriesResult = { folder: ".moku/captures/2026-10-05/series-1015/", indexPath: ".moku/captures/2026-10-05/series-1015/index.json", shots: 20 };
 * ```
 */
export type SeriesResult = {
  readonly folder: string;
  readonly indexPath: string;
  readonly shots: number;
};

/**
 * The Game panel's commands (declared on the panel; gameView runs them through panels.run, R9).
 */
export type GameCommands = {
  readonly capture: "editor.capture";
  readonly series: "editor.series";
  readonly seriesStop: "editor.seriesStop";
};

/**
 * gameView state (the api never returns listeners, watching, timers or disposers).
 */
export type GameViewState = {
  tab: "element" | "device";
  zoom: "fit" | "100";
  safeArea: boolean;
  picker: { on: boolean; hover: string | undefined };
  selected: ElementRef | undefined;
  treeHover: ElementRef | undefined;
  sources: { ui?: Json; entities?: Json; projections?: Json };
  watching: (() => void)[];
  scene: SceneSnapshot | undefined;
  calibration: Calibration | undefined;
  /** undefined = not read, null = not found. */
  manifest: TextureCatalogue | null | undefined;
  card: CaptureCardInfo | undefined;
  series: {
    popover: boolean;
    durationMs: number;
    intervalMs: number;
    recording: Recording | undefined;
    sheet: Sheet | undefined;
  };
  styles: StyleCard | undefined;
  overlayRoot: HTMLElement | undefined;
  listeners: Set<() => void>;
  timers: {
    card?: ReturnType<typeof setTimeout>;
    sheetSave?: ReturnType<typeof setTimeout>;
    styleSave?: ReturnType<typeof setTimeout>;
  };
  disposers: (() => void)[];
  /** Kind and session of the last link:status: a new session drops scene, calibration, manifest. */
  link: { status: LinkStatus["kind"] | undefined; session: string | undefined };
  /** True once game.rect was asked for this session and device (calibration may stay undefined). */
  calibrationRead: boolean;
  /** The style search of the selected element while no StyleCard is shown. */
  lookup: StyleLookup | undefined;
  /** The capture card is hovered or focused, so it stays. */
  cardHeld: boolean;
  /** A game reload gameView started has not settled. */
  reloading: boolean;
  /** Bumped by every highlight call; an older pending call is dropped. */
  highlightSeq: number;
  /** The calibration's target, revision and pending reads. */
  calibrationRun: CalibrationRun;
  /** The last source search result per ui key (proxies and Copy reference read it). */
  found: Map<string, StyleSource>;
  /** The components whose definition a full search did not find: never searched again. */
  missedDefinitions: Set<string>;
  /** The source search in flight per ui key: a second ask waits for the same search. */
  searches: Map<string, Promise<StyleSource | undefined>>;
  /** The style block found per ui key (the reference block's `style:` and the proxies). */
  blocks: Map<string, BlockAt>;
  /** The search for the definition of a projection, per projection key (round 2b R12). */
  spawns: Map<string, Promise<BlockAt | undefined>>;
  /**
   * The search for the file that calls `defineTextStyles(` (round 2b R17), once per app; dropped
   * when it finds none or the file is gone.
   */
  textStyles: Promise<string | undefined> | undefined;
  /** The reference card written last per `<node id>@<frame>` (round 2b R13). */
  cards: Map<string, string>;
  /** Reference mode: the proxy layer in the frame overlay. */
  reference: ReferenceState;
  /** The bookmarks of the completed picks, newest first, at most 20. */
  bookmarks: PickBookmark[];
  /** The last completed pick, for the reference block of its element. */
  pick: LastPick | undefined;
  /** The selection published last (`link.notify("selection")`, U4); undefined after a null. */
  selection: SelectionInfo | undefined;
};

/**
 * The gameView api (`app.gameView`, `ctx.require(gameViewPlugin)`).
 *
 * @example
 * ```ts
 * const shot = await app.gameView.capture(); // { path: ".moku/captures/2026-10-05/0846-board.jpg", … }
 * ```
 */
export type GameViewApi = {
  /**
   * Turns the element picker on or off; without an argument it toggles. On shows the Game
   * workspace, the Element tab and the hint pill; off clears the hover box. A click that picks an
   * element bookmarks the game, saves the crop (`<key>-f<frame>-crop.jpg`) and the full frame
   * (`f<frame>-full.jpg`) in today's folder `<capturesDir>/<yyyy-mm-dd>/`, writes the reference
   * card next to them, puts its one reference line on the clipboard (see `copyReference`), shows
   * the capture card with a Reference action and publishes the selection for MCP
   * `moku_selection`. A drag of 4 px or more picks an area instead (`area-f<frame>.md`).
   *
   * @param on - true for on, false for off, omitted to toggle.
   * @example
   * ```ts
   * // The developer wants to pick an element in the running game.
   * app.gameView.pick(true); // app.workspace.active() === "game", picker on
   * ```
   */
  pick(on?: boolean): void;

  /**
   * The picked element.
   *
   * @returns The element ref, undefined when nothing is selected.
   * @example
   * ```ts
   * // After a click on the coin pill in the game.
   * app.gameView.selected(); // { kind: "ui", path: "boardScreen/hudRow/coinPill" }
   * ```
   */
  selected(): ElementRef | undefined;

  /**
   * Selects an element without the picker, or clears the selection. Clears the style card and
   * publishes the selection to the hub (MCP `moku_selection`; null when cleared).
   *
   * @param ref - The element, undefined to clear.
   * @example
   * ```ts
   * // A test selects the first board item by its entity id.
   * app.gameView.select({ kind: "entity", id: 1_048_628 });
   * app.gameView.selected(); // { kind: "entity", id: 1048628 }
   * ```
   */
  select(ref: ElementRef | undefined): void;

  /**
   * Selects an element, opens the Element tab and shows the Game workspace. The
   * `workspace:inspect` hook calls it (renderView's "Inspect in Game", R9).
   *
   * @param ref - The element.
   * @example
   * ```ts
   * // The palette jumps from a render-tree row to the Game workspace.
   * app.gameView.inspect({ kind: "ui", path: "boardScreen/boardSlot" }); // Game shown, Element tab filled
   * ```
   */
  inspect(ref: ElementRef): void;

  /**
   * The scene built with the shared `buildScene` from the watched `game.ui`, `game.entities`
   * and `game.projections` (watched while Game is shown, R6); a calibration in flight is waited
   * for, so the rects are the calibrated ones. While Game is hidden it reads the three once.
   * Rejects with the link's WireError when no game is connected.
   *
   * @returns The scene snapshot.
   * @throws {Error} The link's WireError, or `[moku-editor] game.ui has the wrong shape …`.
   * @example
   * ```ts
   * // merge-game on the inert renderer: one reference unit is one page px.
   * const scene = await app.gameView.scene();
   * scene.nodes.get("ui:boardScreen/boardSlot")?.rect; // { x: 55, y: 801, w: 970, h: 970 }
   * ```
   */
  scene(): Promise<SceneSnapshot>;

  /**
   * The page rect of one element, from `scene()`.
   *
   * @param ref - The element.
   * @returns Its rect in page CSS px, undefined when it is unknown or could not be placed.
   * @throws {Error} What `scene()` throws: the link's WireError, or a wrong game.ui shape.
   * @example
   * ```ts
   * // The first board item of merge-game at board/awaitIntent.
   * await app.gameView.locate({ kind: "entity", id: 1_048_628 }); // { x: 428.5, y: 880.5, w: 223, h: 223 }
   * ```
   */
  locate(ref: ElementRef): Promise<PageRect | undefined>;

  /**
   * Draws the pink box (`--pick-tree`) around an element over the game frame, wherever the frame
   * is docked (stage or pinned preview); undefined clears it. A newer call drops an older one
   * still waiting for the scene.
   *
   * @param ref - The element, undefined to clear.
   * @example
   * ```ts
   * // renderView hovers a row of its tree.
   * app.gameView.highlight({ kind: "ui", path: "boardScreen/hudRow/coinPill" }); // pink ring over the game
   * app.gameView.highlight(undefined); // ring gone
   * ```
   */
  highlight(ref: ElementRef | undefined): void;

  /**
   * The game's texture catalogue: the first readable `manifestPaths` entry parsed with the shared
   * `parseTextureManifest`. Cached for the session.
   *
   * @returns The catalogue, undefined when no manifest was found.
   * @example
   * ```ts
   * // The Element tab shows the GPU size of a picked sprite's texture.
   * (await app.gameView.manifest())?.textures.get("board.cell")?.gpuMb; // 4
   * ```
   */
  manifest(): Promise<TextureCatalogue | undefined>;

  /**
   * One screenshot: runs `editor.capture` through panels (R9), writes the picture into today's
   * folder `<capturesDir>/<yyyy-mm-dd>/` as `<hhmm>-<flow>` with the extension of its type
   * (`.jpg` for the JPEG editor.capture answers by default, D-34), puts `shot: <path>` on the
   * clipboard, toasts, shows the capture card and the shutter flash. Never captures on its own:
   * only a user action or this call does.
   *
   * @returns The saved capture, undefined when no game is connected, the game lacks
   * `editor.capture`, or the capture failed (a toast says which).
   * @example
   * ```ts
   * // The developer saw a glitch on the board and keeps a picture of it.
   * await app.gameView.capture(); // { path: ".moku/captures/2026-10-05/0846-board.jpg", frame: 1841, device: "iPhone 15 portrait", image: "data:image/jpeg;base64,…" }
   * ```
   */
  capture(): Promise<CaptureFile | undefined>;

  /**
   * Records a series with one `editor.series` call (R1, R9): numbered PNGs and `index.json` in a
   * new `<capturesDir>/<yyyy-mm-dd>/series-<hhmm>/` folder, puts `series: <folder> (<n> frames)`
   * on the clipboard, then opens the contact sheet. Shows Game first. Refuses while another
   * series runs.
   *
   * @param options - Length and spacing in ms, and an optional label (default: the flow path).
   * @param options.durationMs - Length of the series.
   * @param options.intervalMs - Time between two shots.
   * @param options.label - Label of the sheet and the index.
   * @returns The folder, its index.json and the number of shots written; undefined when refused
   * or failed.
   * @example
   * ```ts
   * // Watch the merge animation frame by frame.
   * await app.gameView.series({ durationMs: 2000, intervalMs: 100 }); // { folder: ".moku/captures/2026-10-05/series-1015/", indexPath: ".moku/captures/2026-10-05/series-1015/index.json", shots: 20 }
   * ```
   */
  series(options: {
    durationMs: number;
    intervalMs: number;
    label?: string;
  }): Promise<SeriesResult | undefined>;

  /**
   * Stops the running series early: runs `editor.seriesStop` through panels (R2, R9). The
   * pending series then resolves with the shots taken so far; its index gets `stoppedEarly`.
   *
   * @example
   * ```ts
   * // The interesting moment is over long before the 20 s series ends.
   * const recording = app.gameView.series({ durationMs: 20_000, intervalMs: 100 });
   * app.gameView.stopSeries(); // the pending series resolves with the shots taken so far
   * ```
   */
  stopSeries(): void;

  /**
   * Opens a saved series' contact sheet: reads its index.json and every PNG. Shows Game. The
   * `workspace:open-sheet` hook calls it (filesView "Open contact sheet").
   *
   * @param indexPath - Path of the series' index.json.
   * @returns Resolves when the sheet is open (or a toast said why not).
   * @example
   * ```ts
   * // filesView's "Open contact sheet" on a series folder.
   * await app.gameView.openSheet(".moku/captures/2026-10-05/series-1015/index.json");
   * ```
   */
  openSheet(indexPath: string): Promise<void>;

  /**
   * Writes the reference card of the selected element and puts its one line on the clipboard
   * (round 2b R13): `@moku <name> <type> · <flow/node> · <file:line> · ref x,y w×h · <card path>`.
   * The card `<key>-f<frame>.md`, beside the pick's pictures in `<capturesDir>/<yyyy-mm-dd>/`,
   * holds the full reference block (`@moku` head, `path`, `source`, `layout`, `bounds`, `state`,
   * `flow`, `game`, `device`, and after a pick `restore` and `shot`), the JSX and style snippets with their `file:line`, and the links to
   * the pick's crop and full frame. The same node and frame write the same card again. A field
   * that is not known is left out; a card that cannot be written leaves its path out. A clipboard
   * that refuses is toasted; the line is returned all the same.
   *
   * @returns The line, undefined when nothing is selected or the selection is not in the scene.
   * @example
   * ```ts
   * // The developer picked the settings board and asks Claude to move it.
   * app.gameView.select({ kind: "ui", path: "settingsScreen/settingsBoard" });
   * await app.gameView.copyReference();
   * // "@moku settingsBoard panel · settingsPopup/open · features/settings/settings.tsx:301 · ref 65,190 950×1060 · .moku/captures/2026-10-05/settingsBoard-f25.md"
   * ```
   */
  copyReference(): Promise<string | undefined>;

  /**
   * Folds or unfolds a foldable preset (its `fold` screens): the frame switches between the cover
   * and the inner screen live, the game sees a resize and the picker calibrates again. Without an
   * argument it toggles. Does nothing for a preset without `fold`.
   *
   * @param inner - true for the inner (unfolded) screen, false for the cover; omitted toggles.
   * @example
   * ```ts
   * // Check the board on the open Galaxy Z Fold 6.
   * app.workspace.setDevice({ preset: "galaxy-z-fold-6" });
   * app.gameView.fold(true); // app.workspace.device().preset.w === 707
   * ```
   */
  fold(inner?: boolean): void;

  /**
   * The bookmarks of the completed picks, newest first, at most 20. `game.restore` takes a
   * `value` back to the state of its pick.
   *
   * @returns A copy of the list.
   * @example
   * ```ts
   * // The block said "restore: bookmark settingsBoard-f1841": go back there.
   * const bookmark = app.gameView.bookmarks().find(entry => entry.id === "settingsBoard-f1841");
   * if (bookmark) await app.panels.run("game.restore", { bookmark: bookmark.value });
   * ```
   */
  bookmarks(): readonly PickBookmark[];
};

/**
 * Domain context of gameView: the kernel context is assignable to it.
 */
export type GameViewCtx = {
  readonly config: Readonly<GameViewConfig>;
  state: GameViewState;
  readonly emit: EmitFn<Pick<ToolsEvents, "workspace:reveal" | "workspace:open-file">>;
  readonly log: Log.LogApi;
  readonly require: Require;
};

/**
 * gameView's hooks (global tools events, R4, R9).
 */
export type GameViewHooks = {
  readonly "link:status": (payload: ToolsEvents["link:status"]) => void;
  readonly "workspace:changed": (payload: ToolsEvents["workspace:changed"]) => void;
  readonly "workspace:open-sheet": (payload: ToolsEvents["workspace:open-sheet"]) => void;
  readonly "workspace:inspect": (payload: ToolsEvents["workspace:inspect"]) => void;
  readonly "workspace:reference": (payload: ToolsEvents["workspace:reference"]) => void;
};
