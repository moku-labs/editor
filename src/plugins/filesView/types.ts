/**
 * @file filesView plugin — type definitions: config, constants, open tabs, the file index,
 * Used by, save results, the series index shape, state, api, the domain context and the hooks.
 * The node → file rule types come from the protocol (R1).
 */
import type { Log } from "@moku-labs/common/browser";
import type { EmitFn } from "@moku-labs/core";
import type { Require, ToolsEvents } from "../../config";
import type { FileEntry, Json, NodeRef, SourceOverrides } from "../registry/protocol";

/**
 * Parallel folder listings of the tree walk.
 */
export const WALK_CONCURRENCY = 4;

/**
 * Folders deeper than this are not listed.
 */
export const WALK_MAX_DEPTH = 12;

/**
 * An index older than this is rebuilt when Files is shown.
 */
export const INDEX_STALE_MS = 10_000;

/**
 * Above this many lines the viewer renders a window.
 */
export const WINDOW_LINES = 2000;

/**
 * Above this many lines the editor has no colour.
 */
export const EDIT_COLOUR_LINES = 5000;

/**
 * The files server's text read limit (files spec).
 */
export const SERVER_READ_LIMIT_BYTES = 2 * 1024 * 1024;

/**
 * filesView configuration.
 *
 * @example
 * ```ts
 * createApp({ pluginConfigs: { filesView: { maxFiles: 10_000 } } });
 * ```
 */
export type Config = {
  /** Most files indexed by the tree walk; the header then reads "Project · 5000+ files". */
  maxFiles: number;
  /** Files longer than this (characters) show without colour. */
  maxHighlightChars: number;
  /** Extensions whose save outside .moku/ runs the D-07 reload. */
  reloadExtensions: readonly string[];
  /** A clean tab is re-read on activation when its last check is older than this, in ms. */
  revalidateMs: number;
};

/**
 * What a file is shown as.
 */
export type FileKind = "code" | "markdown" | "json" | "series" | "image" | "text";

/**
 * One open tab.
 */
export type OpenTab = {
  readonly path: string;
  readonly kind: FileKind;
  /** Text on disk as last read or written (undefined for images and before load). */
  saved: string | undefined;
  /** Edit buffer; === saved when clean. */
  buffer: string | undefined;
  /** Files version of `saved` (or of the image). */
  version: string | undefined;
  /** Data URL for images. */
  image: string | undefined;
  status: "loading" | "ready" | "saving" | "conflict" | "missing" | "error";
  /** Error text or save note ("✓ No changes"). */
  message: string | undefined;
  editing: boolean;
  /** Markdown and series start in "preview"; every other kind is always "source". */
  mode: "preview" | "source";
  /** Line to reveal and mark (1-based). */
  line: number | undefined;
  /** Date.now() of the last read. */
  checkedAt: number;
};

/**
 * The file index built by the tree walk.
 */
export type FileIndex = {
  /** Path → entry, files only. */
  readonly files: Map<string, FileEntry>;
  /** Dir path ("" = root) → child paths, folders first. */
  readonly children: Map<string, readonly string[]>;
  readonly builtAt: number;
  readonly truncated: boolean;
};

/**
 * One visible row of the project tree.
 */
export type TreeRow = {
  readonly path: string;
  readonly name: string;
  readonly kind: "file" | "dir";
  /** 1 for the root's children. */
  readonly level: number;
  /** Folders only: open in the tree. */
  readonly expanded: boolean;
};

/**
 * Flows and nodes whose file is a path.
 *
 * @example
 * ```ts
 * const usedBy: UsedBy = { flows: ["board"], nodes: [{ flow: "board", node: "merge" }] };
 * ```
 */
export type UsedBy = { readonly flows: readonly string[]; readonly nodes: readonly NodeRef[] };

/**
 * A tab as the api lists it.
 *
 * @example
 * ```ts
 * const info: TabInfo = { path: "nodes/merge.ts", kind: "code", modified: true, editing: true, status: "ready" };
 * ```
 */
export type TabInfo = {
  readonly path: string;
  readonly kind: FileKind;
  readonly modified: boolean;
  readonly editing: boolean;
  readonly status: OpenTab["status"];
};

/**
 * The result of a save.
 *
 * @example
 * ```ts
 * const result: SaveResult = { kind: "saved", path: "nodes/merge.ts", bytes: 812, version: "3f2a…", reload: true };
 * ```
 */
export type SaveResult =
  | { kind: "saved"; path: string; bytes: number; version: string; reload: boolean }
  | { kind: "unchanged" }
  | { kind: "conflict" }
  | { kind: "failed"; code: number | undefined; message: string };

/**
 * The series index.json shape filesView reads (written by gameView; a shape, not an import).
 *
 * @example
 * ```ts
 * const index: SeriesIndex = { durationMs: 3000, intervalMs: 250, fromFrame: 1841, shots: [{ file: "shot-01.png", frame: 1841, atMs: 0 }] };
 * ```
 */
export type SeriesIndex = {
  label?: string;
  durationMs: number;
  intervalMs: number;
  fromFrame: number;
  shots: { file: string; frame: number; atMs: number; bug?: boolean }[];
  device?: Json;
  stoppedEarly?: boolean;
};

/**
 * Any Markdown file split for the preview (`frontMatterParts`): no front matter, or the raw lines
 * of its front matter (shown as one plain `<pre data-front-matter>` block) and the body after it.
 * The name is older than the notes removal; it stays because the public `FilesView` namespace
 * (src/tools.ts) exports it.
 *
 * @example
 * ```ts
 * // The preview of docs/plan.md, a Markdown file with a title in its front matter.
 * const parts: NoteParts = { kind: "raw", lines: ["title: Plan"], body: "# Plan\n" };
 * ```
 */
export type NoteParts =
  | { readonly kind: "none"; readonly body: string }
  | { readonly kind: "raw"; readonly lines: readonly string[]; readonly body: string };

/**
 * filesView state.
 */
export type FilesViewState = {
  index: FileIndex | undefined;
  /** Single flight of buildIndex. */
  indexing: Promise<void> | undefined;
  /** Open folders. */
  expanded: Set<string>;
  /** Tab order. */
  tabs: OpenTab[];
  active: string | undefined;
  /** game.graph of the current session (read once per manifest). */
  graph: Json | undefined;
  /** Parsed SOURCE_OVERRIDES_PATH (flat map, R1); {} when missing. */
  overrides: SourceOverrides;
  /** Reverse map; undefined without a graph. */
  usedBy: Map<string, UsedBy> | undefined;
  /** Tab path whose discard popover is open. */
  confirmClose: string | undefined;
  listeners: Set<() => void>;
  /** Keys, escape layer, manifest listener, beforeunload. */
  removers: (() => void)[];
  /** File items of the palette, replaced on every index build. */
  paletteRemover: (() => void) | undefined;
};

/**
 * The filesView api (`app.filesView`): the view, the palette items, the open-file hook and
 * tests use it. Every path is relative to the project root.
 *
 * @example
 * ```ts
 * await app.filesView.open("nodes/merge.ts", { line: 12 });
 * app.filesView.usedBy("nodes/merge.ts").nodes; // [{ flow: "board", node: "merge" }]
 * ```
 */
export type FilesViewApi = {
  /**
   * Shows Files, activates the tab of `path` or appends one, reveals the path in the tree and
   * loads it (images through readBinary). `line` marks and scrolls to that line; `edit` opens
   * it in edit mode (not for images). Resolves when the file is loaded or its error is shown.
   *
   * @param path - Relative file path.
   * @param options - Where and how to open.
   * @param options.line - 1-based line to mark and reveal.
   * @param options.edit - Open in edit mode.
   * @returns When the tab is loaded.
   * @example
   * ```ts
   * // flowView's Inspector asked for a node's file at its line.
   * await app.filesView.open("nodes/merge.ts", { line: 12 });
   * app.filesView.active(); // "nodes/merge.ts"
   * ```
   */
  open(path: string, options?: { line?: number; edit?: boolean }): Promise<void>;

  /**
   * Removes a tab. A modified tab without `discard: true` stays open: the call returns false
   * and opens the discard popover. The next tab to the right (else to the left) becomes active.
   *
   * @param path - The tab's path.
   * @param options - How to close.
   * @param options.discard - Drop unsaved changes.
   * @returns Whether the tab was closed.
   * @example
   * ```ts
   * app.filesView.close("nodes/merge.ts"); // false: the buffer is modified, the popover opens
   * app.filesView.close("nodes/merge.ts", { discard: true }); // true
   * ```
   */
  close(path: string, options?: { discard?: boolean }): boolean;

  /**
   * Makes an open tab active and re-reads it when its last check is older than `revalidateMs`.
   *
   * @param path - The tab's path.
   * @example
   * ```ts
   * app.filesView.activate("flows/board.ts");
   * app.filesView.active(); // "flows/board.ts"
   * ```
   */
  activate(path: string): void;

  /**
   * The open tabs in tab order.
   *
   * @returns One TabInfo per tab.
   * @example
   * ```ts
   * app.filesView.setBuffer("nodes/merge.ts", "export const merge = 2;\n");
   * app.filesView.tabs()[0]?.modified; // true
   * ```
   */
  tabs(): readonly TabInfo[];

  /**
   * The active tab's path.
   *
   * @returns The path, or undefined with no tab open.
   * @example
   * ```ts
   * await app.filesView.open("flows/board.ts");
   * app.filesView.active(); // "flows/board.ts"
   * ```
   */
  active(): string | undefined;

  /**
   * Enters or leaves edit mode (default: the active tab). Leaving keeps the buffer, so the tab
   * stays modified. Markdown and series switch to `source` first. Images: no-op.
   *
   * @param on - Edit mode on or off.
   * @param path - The tab's path; the active tab when omitted.
   * @example
   * ```ts
   * app.filesView.edit(true);
   * app.filesView.tabs()[0]?.editing; // true
   * ```
   */
  edit(on: boolean, path?: string): void;

  /**
   * Replaces the edit buffer of a tab and notifies the view.
   *
   * @param path - The tab's path.
   * @param text - The new buffer.
   * @example
   * ```ts
   * app.filesView.setBuffer("nodes/merge.ts", "export const merge = 2;\n");
   * app.filesView.tabs()[0]?.modified; // true
   * ```
   */
  setBuffer(path: string, text: string): void;

  /**
   * Preview or source for markdown and series tabs; ignored for other kinds.
   *
   * @param path - The tab's path.
   * @param mode - "preview" or "source".
   * @example
   * ```ts
   * await app.filesView.open("docs/levels.md");
   * app.filesView.setMode("docs/levels.md", "source"); // the tab shows the Markdown as code
   * ```
   */
  setMode(path: string, mode: "preview" | "source"): void;

  /**
   * Saves a tab (default: the active tab) with its version. An unchanged buffer writes nothing;
   * a stale version shows the conflict bar; a game source saved outside `.moku/` while the link
   * is live or paused reloads the game frame and restores the state (D-07). Never rejects.
   *
   * @param path - The tab's path; the active tab when omitted.
   * @returns What happened.
   * @example
   * ```ts
   * app.filesView.setBuffer("nodes/merge.ts", "export const merge = 2;\n");
   * (await app.filesView.save()).kind; // "saved"
   * (await app.filesView.save()).kind; // "unchanged"
   * ```
   */
  save(path?: string): Promise<SaveResult>;

  /**
   * Resolves a conflict: "reload" re-reads the file and drops the buffer; "overwrite" re-reads
   * only the version and writes the buffer over it. Never rejects.
   *
   * @param path - The tab's path.
   * @param choice - "reload" or "overwrite".
   * @returns `{ kind: "unchanged" }` after a reload, else the save result.
   * @example
   * ```ts
   * (await app.filesView.save()).kind; // "conflict": the file changed on disk
   * (await app.filesView.resolveConflict("nodes/merge.ts", "overwrite")).kind; // "saved"
   * ```
   */
  resolveConflict(path: string, choice: "reload" | "overwrite"): Promise<SaveResult>;

  /**
   * Rebuilds the file index (single flight), then the Used-by map and the palette items.
   *
   * @returns When the index is rebuilt.
   * @example
   * ```ts
   * await app.filesView.refresh();
   * app.filesView.files().length; // 24
   * ```
   */
  refresh(): Promise<void>;

  /**
   * The indexed file entries in tree order (folders first at every level).
   *
   * @returns The entries; empty before the first index.
   * @example
   * ```ts
   * app.filesView.files().map(entry => entry.path).slice(0, 2); // ["flows/board.ts", "flows/main.ts"]
   * ```
   */
  files(): readonly FileEntry[];

  /**
   * The source file of a graph node: its own `file` from the graph (F-H2) when it has one, else
   * the protocol rule (R1) against the file index. flowView resolves a node the same way.
   *
   * @param ref - Flow and node name.
   * @returns The path, or undefined (sub-flow and slot nodes have no own file).
   * @example
   * ```ts
   * app.filesView.fileOf({ flow: "board", node: "awaitIntent" }); // "nodes/await-intent.ts"
   * ```
   */
  fileOf(ref: NodeRef): string | undefined;

  /**
   * The source file of a flow by the protocol rule (R1), against the file index.
   *
   * @param flow - The flow name.
   * @returns The path, or undefined.
   * @example
   * ```ts
   * app.filesView.flowFileOf("board"); // "flows/board.ts"
   * ```
   */
  flowFileOf(flow: string): string | undefined;

  /**
   * Flows and nodes of the current game whose file is `path`; empty without a graph.
   *
   * @param path - Relative file path.
   * @returns The flows and nodes.
   * @example
   * ```ts
   * app.filesView.usedBy("nodes/merge.ts").nodes; // [{ flow: "board", node: "merge" }]
   * ```
   */
  usedBy(path: string): UsedBy;

  /**
   * The "Open in editor" link (D-08) from the boot data's `editorUrl` and `root`.
   *
   * @param path - Relative file path.
   * @param line - 1-based line; 1 when omitted.
   * @returns The link, or undefined without boot data.
   * @example
   * ```ts
   * app.filesView.editorUrl("nodes/merge.ts", 12); // "vscode://file/Users/moku/game/nodes/merge.ts:12"
   * ```
   */
  editorUrl(path: string, line?: number): string | undefined;

  /**
   * Listens to every change the view shows (tabs, index, Used by, status).
   *
   * @param fn - Called after each change.
   * @returns An idempotent unsubscribe.
   * @example
   * ```ts
   * const off = app.filesView.subscribe(() => redraw(app.filesView.tabs()));
   * off();
   * ```
   */
  subscribe(fn: () => void): () => void;
};

/**
 * Domain context of filesView: the kernel context is assignable to it.
 */
export type FilesViewCtx = {
  readonly config: Readonly<Config>;
  state: FilesViewState;
  readonly emit: EmitFn<Pick<ToolsEvents, "workspace:select-node" | "workspace:open-sheet">>;
  readonly log: Log.LogApi;
  readonly require: Require;
};

/**
 * filesView's hooks (global tools events, R4).
 */
export type FilesViewHooks = {
  readonly "link:status": (payload: ToolsEvents["link:status"]) => void;
  readonly "workspace:changed": (payload: ToolsEvents["workspace:changed"]) => void;
  readonly "workspace:open-file": (payload: ToolsEvents["workspace:open-file"]) => void;
};
