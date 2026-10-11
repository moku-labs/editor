/**
 * @file gameView plugin — type definitions: config, state, recording, contact sheet, style card,
 * pending style edits (U8), capture and series shapes, the api, the domain context and the hooks.
 * The scene types are declared once in panels/shared/scene (R8) and re-exported here for
 * `GameView.ElementRef`.
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
import type {
  FileText,
  Json,
  LinkStatus,
  ProjectFound,
  SelectionInfo,
  StyleEdit,
  StyleValue
} from "../registry/protocol";
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
 * gameView configuration. Where the game's code and asset manifest live is the project index's
 * answer (D-38), not configuration.
 *
 * @example
 * ```ts
 * createApp({ pluginConfigs: { gameView: { captureCardMs: 5000 } } });
 * ```
 */
export type GameViewConfig = {
  /** Folder of screenshots and series, relative to the files root; each in a `<yyyy-mm-dd>/` day folder. */
  capturesDir: string;
  /** The capture card hides after this unless hovered or focused. */
  captureCardMs: number;
  /** Duration chips of the series popover (the longest equals capture's maxDurationMs). */
  seriesDurationsMs: readonly number[];
  /** Interval chips of the series popover (the shortest equals capture's minIntervalMs). */
  seriesIntervalsMs: readonly number[];
  /** Above this many planned shots the popover warns. */
  seriesWarnShots: number;
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
 * The range of a project-index answer: start line, start column, end line, end column (1-based,
 * the end column exclusive). For a JSX key it is the whole element.
 */
export type SourceRange = ProjectFound["range"];

/**
 * Where the project index found a ui key (`find("jsx:<key>")`, its first answer): `ident` with
 * `style={ident}` (the editable card), `call` with `style={call(...)}` (an editable card at the
 * function's `defineStyle({ … })` call when the index knows its `styleKey`, G2; else read-only),
 * `defined` with no style on the element. `line` is the 1-based line the index answers (the key
 * attribute), `range` the whole element. A `defined` with `textStyle` is a text node with
 * `style="ui.link"`: the Code section shows that key's block (round 2b R17).
 *
 * `path`, `line` and `range` are always the first answer (D-47). When that answer is an id prop
 * (`amountKey="giftReward"` on `<Amount>`) with no style on its own tag, the style is read from
 * the element the component draws for it (the `{amountKey}` pattern the prop fills in the
 * component of its name), and `stylePath` names that component file when it is another file. A
 * component file that was looked at and gave no style is kept in `stylelessPaths`: the answer is
 * stale once that file changes.
 *
 * @example
 * ```ts
 * const row: StyleSource = { kind: "defined", path: "features/ui/view.tsx", line: 51, range: [51, 5, 54, 11] };
 * const card: StyleSource = { kind: "call", path: "features/orders/strip.tsx", line: 216, range: [215, 5, 247, 14], call: "orderCardStyle(card.slot)", callLine: 218 };
 * const link: StyleSource = { kind: "defined", path: "features/settings/settings.tsx", line: 318, range: [318, 11, 318, 92], textStyle: "ui.link" };
 * const reward: StyleSource = { kind: "defined", path: "features/gift/popups/daily-gift.tsx", line: 25, range: [23, 9, 29, 11], textStyle: "ui.amount", stylePath: "shared/views/amount.tsx" };
 * const board: StyleSource = { kind: "call", path: "features/settings/settings.tsx", line: 290, range: [289, 7, 310, 19], call: "boardOf(props.width, props.height, props.top ?? BOARD_TOP, hung)", callLine: 833, stylePath: "features/ui/kit.tsx" };
 * // An id prop whose component draws its element without a style: looked at, nothing found.
 * const bare: StyleSource = { kind: "defined", path: "src/hud/Hud.tsx", line: 2, range: [1, 1, 3, 3], stylelessPaths: ["src/kit/pill.tsx"] };
 * ```
 */
export type StyleSource =
  | {
      readonly kind: "ident";
      readonly path: string;
      readonly line: number;
      readonly range: SourceRange;
      readonly ref: Extract<StyleBlockRef, { readonly kind: "const" }>;
      /**
       * Files that may hold the block, in order: the ones the index defines `style:<file>#<name>`
       * in (the file of the style first, then the file it is imported from); the file of the
       * style alone when none.
       */
      readonly files: readonly string[];
      /**
       * The component file the style was read from, when the first answer is an id prop without a
       * style of its own and its component is in another file. Absent: the style is in `path`.
       */
      readonly stylePath?: string;
      /**
       * The other component files looked at for the style of an id prop that gave none: no style
       * on the tag the pattern keys, a file that changed since the index answered, or one that
       * cannot be read. A project change to one of them drops the answer. Absent: there is none.
       */
      readonly stylelessPaths?: readonly string[];
    }
  | {
      readonly kind: "call";
      readonly path: string;
      readonly line: number;
      readonly range: SourceRange;
      /** The call as written: `boardOf(props.width, props.height)`. */
      readonly call: string;
      /** 1-based line of the `style={…}` attribute, in `stylePath` when there is one. */
      readonly callLine: number;
      /**
       * The project-index key of the style the called function builds (G2):
       * `style:<file>#<function>`, or `#<function>.<property>` for `fn(…).property`. Absent when
       * the index has none.
       */
      readonly styleKey?: string;
      /**
       * The component file the style was read from, when the first answer is an id prop without a
       * style of its own and its component is in another file. Absent: the style is in `path`.
       */
      readonly stylePath?: string;
      /**
       * The other component files looked at for the style of an id prop that gave none: no style
       * on the tag the pattern keys, a file that changed since the index answered, or one that
       * cannot be read. A project change to one of them drops the answer. Absent: there is none.
       */
      readonly stylelessPaths?: readonly string[];
    }
  | {
      readonly kind: "defined";
      readonly path: string;
      readonly line: number;
      readonly range: SourceRange;
      /** The text style key of a text node (`style="ui.link"`): the index answers its block. */
      readonly textStyle?: string;
      /**
       * The component file the style was read from, when the first answer is an id prop without a
       * style of its own and its component is in another file. Absent: the style is in `path`.
       */
      readonly stylePath?: string;
      /**
       * The other component files looked at for the style of an id prop that gave none: no style
       * on the tag the pattern keys, a file that changed since the index answered, or one that
       * cannot be read. A project change to one of them drops the answer. Absent: there is none.
       */
      readonly stylelessPaths?: readonly string[];
    };

/**
 * Where the style lookup of the selected element stands while no StyleCard is shown: asking the
 * index, not in the index (or the index is off), found but the shared style edit refused the file
 * (broken, no-file, parse, no-key, ambiguous), a style computed by a call (read-only), or the
 * element found without a style.
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
 * A press on the picker layer (U9, A16): where it started, whether it became an area drag (the
 * pointer moved 4 client px or more) and whether Esc cancelled that drag.
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
 * The area gesture of the picker (U9): the press it started with and the marquee it draws.
 */
export type ReferenceState = {
  /** The press on the picker layer until its release (U9). */
  press: AreaPress | undefined;
  /** The marquee of an area drag in device px; undefined while no drag runs (A16). */
  area: PageRect | undefined;
};

/**
 * The pending style edits of one element (U8, D-67): values the person changed in the Styles
 * fields of the Element tab and the source file does not have yet. They go to the agent as text
 * (`copyEdits`) and in the published selection (`SelectionInfo.edits`); the editor writes no code
 * for them.
 *
 * @example
 * ```ts
 * const homePlay: ElementEdits = {
 *   label: "homePlay",
 *   source: { path: "features/stage/views/home-screen.tsx", line: 199 },
 *   byId: false,
 *   edits: [{ path: "minWidth", from: 556, to: 600 }, { path: "padding.top", from: 25, to: 30 }]
 * };
 * ```
 */
export type ElementEdits = {
  /** The ui key, else the node name: the head of the element's block in the agent text. */
  readonly label: string;
  /** Where the index says the element is written; absent without an answer. */
  readonly source?: { readonly path: string; readonly line: number };
  /** True when the map key is a node id: such an entry does not survive a game reload. */
  readonly byId: boolean;
  /** The edits, in the order the person made them; one per path. */
  readonly edits: readonly StyleEdit[];
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
 * How a completed pick ends (A8): `copy` puts the reference line on the clipboard with a toast;
 * MCP `moku_select` passes false. The capture card shows either way. A picker click completes a
 * pick only while the workspace preference "Copy on select" is on (D-70).
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
 * Where a style block was found: its file and the 1-based line of the block. The `defineStyle`
 * call of a style function (G2) also keeps the range the index answered, so its lines are read
 * again without asking the index.
 */
export type BlockAt = {
  readonly path: string;
  readonly line: number;
  /** The range of the call the index answered for its `style:` key. */
  readonly range?: SourceRange;
};

/**
 * The index asked for the definition of a projection (round 2b R12): the ask, which a second ask
 * while it runs shares, and the place once it answered, so a project change drops it by its file
 * (D-46).
 */
export type SpawnAsk = {
  readonly asked: Promise<BlockAt | undefined>;
  /** The file and line the index answered; undefined while the ask runs. */
  at: BlockAt | undefined;
};

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
  /**
   * Kind and session of the last link:status: a new session drops scene, calibration, manifest.
   * `reloading` is true while that status is an expected reload (`isReloading`, U11).
   */
  link: { status: LinkStatus["kind"] | undefined; session: string | undefined; reloading: boolean };
  /** The gameView reloads in flight (toolbar Reload, style save): the Reload button is busy (U11). */
  reloads: number;
  /** True once game.rect was asked for this session and device (calibration may stay undefined). */
  calibrationRead: boolean;
  /** The style lookup of the selected element while no StyleCard is shown. */
  lookup: StyleLookup | undefined;
  /** The capture card is hovered or focused, so it stays. */
  cardHeld: boolean;
  /** Bumped by every highlight call; an older pending call is dropped. */
  highlightSeq: number;
  /** The calibration's target, revision and pending reads. */
  calibrationRun: CalibrationRun;
  /**
   * The last index answer per ui key (Copy reference and the pending edits read it); a project
   * change drops the answers in the files it changed (D-46).
   */
  found: Map<string, StyleSource>;
  /**
   * The style block found per ui key (the reference block's `style:`), and the call of a style
   * function per `style:` key (the Code section, G2); a project change drops the blocks in the
   * files it changed (D-46).
   */
  blocks: Map<string, BlockAt>;
  /**
   * The index answer for the definition of a projection, per projection key (round 2b R12); a
   * project change drops the answers in the files it changed, of a removed key, and the asks
   * still running (D-46).
   */
  spawns: Map<string, SpawnAsk>;
  /** The reference card written last per `<node id>@<frame>` (round 2b R13). */
  cards: Map<string, string>;
  /** The area gesture of the picker: its press and its marquee. */
  reference: ReferenceState;
  /** The bookmarks of the completed picks, newest first, at most 20. */
  bookmarks: PickBookmark[];
  /** The last completed pick, for the reference block of its element. */
  pick: LastPick | undefined;
  /** The selection published last (`link.notify("selection")`, U4); undefined after a null. */
  selection: SelectionInfo | undefined;
  /**
   * The pending style edits per element (U8): the key is the ui key when the node has one, else
   * the node id. Not persisted: a page load starts without any.
   */
  edits: Map<string, ElementEdits>;
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
   * workspace, the Element tab and the hint pill; off clears the hover box. What a click on an
   * element does next is the workspace preference "Copy on select" (the Copy Ref switch of the
   * game toolbar, on by default).
   *
   * On: the click bookmarks the game, saves the crop (`<key>-f<frame>-crop.jpg`) and the full
   * frame (`f<frame>-full.jpg`) in today's folder `<capturesDir>/<yyyy-mm-dd>/`, writes the
   * reference card next to them, puts its one reference line on the clipboard, shows the capture
   * card with a Reference action and publishes the selection with its `card`, `crop` and `line`
   * for MCP `moku_selection`. A drag of 4 px or more picks an area instead (`area-f<frame>.md`).
   *
   * Off: the click only selects the element for the Element tab and publishes the selection
   * without `card`, `crop` and `line`. Nothing is bookmarked, captured, written or copied, and a
   * drag picks nothing. `copyReference` writes the card and copies its line on demand.
   *
   * @param on - true for on, false for off, omitted to toggle.
   * @example
   * ```ts
   * // The developer wants a reference of an element of the running game for the chat.
   * app.gameView.pick(true); // app.workspace.active() === "game", picker on
   * // After a click on the coin pill: the card is written and its line is on the clipboard.
   *
   * // The developer only wants to look at elements in the Element tab.
   * app.workspace.setCopyOnSelect(false);
   * app.gameView.pick(true);
   * // After a click on the coin pill: app.gameView.selected() names it, no file is written.
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
   * The game's texture catalogue: the manifest the project index names (`ProjectState.manifest`)
   * parsed with the shared `parseTextureManifest`. Cached until the session or the index names
   * another manifest, or the manifest changes on disk.
   *
   * @returns The catalogue, undefined when the index is off, names no manifest, or it does not parse.
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
   * on the clipboard, toasts and shows the capture card of its first shot, like a screenshot
   * (D-69). The contact sheet opens only on request (`openSheet`). Shows Game first. Refuses
   * while another series runs.
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
   * `workspace:open-sheet` hook calls it (filesView "Open contact sheet"), and so does "Open" on
   * the capture card of a series.
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
   * // "@moku settingsBoard panel · settingsPopup/open · features/settings/settings.tsx:290 · ref 65,190 950×1060 · .moku/captures/2026-10-05/settingsBoard-f25.md"
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

  /**
   * Records a pending style edit of the selected element (U8, D-67). `from` is the value the
   * scene has for `path` now. A second edit of the same path replaces `to` and keeps the first
   * `from`. A `to` equal to the scene value removes the edit of that path. Nothing is written to
   * a file and no command is sent: the edit goes to the agent (`copyEdits`, and `edits` of the
   * published selection). Does nothing without a selected element in the scene, or for a path
   * the element's style does not have as a number, a string or a boolean.
   *
   * @param path - The style property, dotted for a nested one (`padding.top`).
   * @param to - The wanted value.
   * @example
   * ```ts
   * // homePlay is 556 wide in the game; the person wants 600 and more room on top.
   * app.gameView.select({ kind: "ui", path: "homeScreen/homePlay" });
   * app.gameView.editStyle("minWidth", 600);
   * app.gameView.editStyle("padding.top", 30);
   * app.gameView.edits()[0]?.edits;
   * // [{ path: "minWidth", from: 556, to: 600 }, { path: "padding.top", from: 25, to: 30 }]
   * app.gameView.editStyle("minWidth", 556); // back to the scene value: that edit is gone
   * ```
   */
  editStyle(path: string, to: StyleValue): void;

  /**
   * Drops pending style edits: the ones of the selected element, or all of them. The selection
   * is published again without them.
   *
   * @param scope - `"selected"` for the selected element only; `"all"` (the default) for every element.
   * @example
   * ```ts
   * // The person changed their mind about homePlay; the edits of the other elements stay.
   * app.gameView.clearEdits("selected");
   * app.gameView.edits().some(entry => entry.label === "homePlay"); // false
   * app.gameView.clearEdits(); // every pending edit is gone
   * ```
   */
  clearEdits(scope?: "selected" | "all"): void;

  /**
   * Every pending style edit, one entry per element, the selected element first. An edit leaves
   * by itself when a scene snapshot shows its `to` value: the agent wrote the code and hot reload
   * brought it in. A game reload drops the entries of elements without a ui key.
   *
   * @returns A copy of the list.
   * @example
   * ```ts
   * // The edits bar of the Element tab counts them: "2 edits".
   * const count = app.gameView.edits().reduce((sum, entry) => sum + entry.edits.length, 0);
   * app.gameView.edits()[0];
   * // { label: "homePlay", source: { path: "features/stage/views/home-screen.tsx", line: 199 }, byId: false, edits: [ … ] }
   * ```
   */
  edits(): readonly ElementEdits[];

  /**
   * Puts the pending edits on the clipboard as text for the agent, toast "✓ 2 edits copied": one
   * block per element, the selected one first, blocks separated by one empty line. The head is
   * `@moku <label>` plus ` · <path>:<line>` when the source is known; then one line per edit.
   * Strings are written in double quotes, numbers and booleans bare.
   *
   * @returns The text; undefined without edits, or when the clipboard refused (toasted).
   * @example
   * ```ts
   * // "Copy for agent" in the Element tab, after the two edits of homePlay.
   * await app.gameView.copyEdits();
   * // "@moku homePlay · features/stage/views/home-screen.tsx:199\nminWidth: 556 -> 600\npadding.top: 25 -> 30"
   * ```
   */
  copyEdits(): Promise<string | undefined>;
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
  readonly "link:project": (payload: ToolsEvents["link:project"]) => void;
};
