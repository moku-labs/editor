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
  /** Most files indexed by the tree walk. */
  maxFiles: number;
  /** Files longer than this (characters) show without colour. */
  maxHighlightChars: number;
  /** Extensions whose save outside .moku/ runs the D-07 reload. */
  reloadExtensions: readonly string[];
  /** A clean tab is re-read on activation when its last check is older than this. */
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
  saved: string | undefined;
  buffer: string | undefined;
  version: string | undefined;
  image: string | undefined;
  status: "loading" | "ready" | "saving" | "conflict" | "missing" | "error";
  message: string | undefined;
  editing: boolean;
  mode: "preview" | "source";
  line: number | undefined;
  checkedAt: number;
};

/**
 * The file index built by the tree walk.
 */
export type FileIndex = {
  readonly files: Map<string, FileEntry>;
  readonly children: Map<string, readonly string[]>;
  readonly builtAt: number;
  readonly truncated: boolean;
};

/**
 * Flows and nodes whose file is a path.
 */
export type UsedBy = { readonly flows: readonly string[]; readonly nodes: readonly NodeRef[] };

/**
 * A tab as the api lists it.
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
 */
export type SaveResult =
  | { kind: "saved"; path: string; bytes: number; version: string; reload: boolean }
  | { kind: "unchanged" }
  | { kind: "conflict" }
  | { kind: "failed"; code: number | undefined; message: string };

/**
 * The series index.json shape filesView reads (written by gameView; a shape, not an import).
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
 * filesView state.
 */
export type FilesViewState = {
  index: FileIndex | undefined;
  indexing: Promise<void> | undefined;
  expanded: Set<string>;
  tabs: OpenTab[];
  active: string | undefined;
  graph: Json | undefined;
  overrides: SourceOverrides;
  usedBy: Map<string, UsedBy> | undefined;
  confirmClose: string | undefined;
  listeners: Set<() => void>;
  removers: (() => void)[];
  paletteRemover: (() => void) | undefined;
};

/**
 * The filesView api (`app.filesView`).
 *
 * @example
 * ```ts
 * await app.filesView.open("nodes/merge.ts", { line: 12 });
 * ```
 */
export type FilesViewApi = {
  open(path: string, options?: { line?: number; edit?: boolean }): Promise<void>;
  close(path: string, options?: { discard?: boolean }): boolean;
  activate(path: string): void;
  tabs(): readonly TabInfo[];
  active(): string | undefined;
  edit(on: boolean, path?: string): void;
  setBuffer(path: string, text: string): void;
  setMode(path: string, mode: "preview" | "source"): void;
  save(path?: string): Promise<SaveResult>;
  resolveConflict(path: string, choice: "reload" | "overwrite"): Promise<SaveResult>;
  refresh(): Promise<void>;
  files(): readonly FileEntry[];
  fileOf(ref: NodeRef): string | undefined;
  flowFileOf(flow: string): string | undefined;
  usedBy(path: string): UsedBy;
  editorUrl(path: string, line?: number): string | undefined;
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
