/**
 * @file flowView inspector module — types: tabs, the code and styles slices, the node → file
 * lookup, the inspector actions. Style edit types come from panels/shared/style-edit.
 */
import type { StyleBlock, StyleEditError } from "../../panels/shared/style-edit";
import type { SourceOverrides } from "../../registry/protocol";
import type { NodeId } from "../types";

/**
 * An Inspector tab.
 */
export type InspectorTab = "info" | "code" | "styles" | "notes";

/**
 * The status line of a save.
 */
export type SaveResult = { readonly ok: boolean; readonly text: string };

/**
 * A stepper burst waiting for its debounce.
 */
export type PendingEdit = {
  readonly key: string;
  readonly path: string;
  readonly raw: string;
  readonly next: number;
  readonly timer: ReturnType<typeof setTimeout> | undefined;
};

/**
 * Inputs of the node → file rule for this session (R1).
 */
export type SourceLookup = {
  readonly exists: ReadonlySet<string>;
  readonly overrides: SourceOverrides;
};

/**
 * The Code tab slice.
 */
export type CodeState = {
  path: string;
  text: string;
  version: string;
  line: number;
  draft: string | undefined;
  result: SaveResult | undefined;
  /** The last write failed with version_conflict: "Reload file" / "Save anyway" are offered. */
  conflict: boolean;
  /** Esc with unsaved changes asked "Discard changes?". */
  discard: boolean;
};

/**
 * The Styles tab slice.
 */
export type StylesState = {
  text: string;
  version: string;
  blocks: StyleBlock[];
  key: string | undefined;
  pending: PendingEdit | undefined;
  result: SaveResult | undefined;
  error: StyleEditError | undefined;
};

/**
 * Inspector module state.
 */
export type InspectorState = {
  tab: InspectorTab;
  code: CodeState | undefined;
  /** The placeholder the Code tab shows instead of code ("Source loads from the dev server." …). */
  codeNote: string | undefined;
  styles: StylesState | undefined;
  sources: SourceLookup | undefined;
};

/**
 * The inspector actions (used by the components, the palette items and the hooks).
 */
export type InspectorApi = {
  /** Switches the tab; Code and Styles load their file. */
  setTab(tab: InspectorTab): void;
  /** Reads the node's file into the Code tab. */
  openCode(id: NodeId): Promise<void>;
  /** Starts editing: the draft is the file text. */
  edit(): void;
  /** Replaces the draft. */
  setDraft(text: string): void;
  /** Esc in edit mode: asks "Discard changes?" once when the draft changed; false when not editing. */
  cancelEdit(): boolean;
  /** Drops the draft without asking. */
  discard(): void;
  /** Saves the draft; `force` re-reads the version first ("Save anyway"). */
  saveCode(force?: boolean): Promise<void>;
  /** Reads the file again and drops the draft ("Reload file"). */
  reloadCode(): Promise<void>;
  /** Reads stylesFile into the Styles tab; selects a key's card. */
  openStyles(key?: string): Promise<void>;
  /** Selects a style card. */
  selectStyle(key: string): void;
  /** One stepper press; a burst is written once after styleSaveDelayMs. */
  stepStyle(path: string, direction: 1 | -1, big: boolean): void;
  /** Reads stylesFile and replaces the palette group Styles (no tab change). */
  readStyleKeys(): Promise<void>;
  /** The file and line of a node, or undefined. */
  fileOf(id: NodeId): Promise<{ readonly path: string; readonly line: number } | undefined>;
  /** "Open in Files": emits workspace:open-file (R4). */
  openInFiles(path: string, line?: number): void;
  /** "Open in editor" link from link.boot() (D-08), undefined without boot. */
  editorUrl(path: string, line?: number): string | undefined;
  /** UI nodes whose text style is the key, from one game.ui read (F-G1). */
  usedBy(key: string): Promise<readonly string[]>;
};

/**
 * One outcome row of the Info tab.
 */
export type InfoOutcome = {
  readonly outcome: string;
  /** "tapGenerator", "exit:left → home", "—". */
  readonly target: string;
  readonly targetId: NodeId | undefined;
  readonly back: boolean;
  readonly waiting: boolean;
  /** Frame label of the last fire. */
  readonly frame: string | undefined;
  /** "✕ f1778" when the last fire was a rejection. */
  readonly rejected: string | undefined;
};

/**
 * What the Info tab (C2) shows for one node.
 */
export type InfoView = {
  readonly id: NodeId;
  readonly flow: string;
  readonly node: string;
  readonly kinds: readonly string[];
  readonly scene: string | undefined;
  readonly current: boolean;
  /** "now · waiting since f1840", "f1778", "not in the last 20 edges". */
  readonly lastVisit: string;
  /** Slot contributions: "reward → rewardPopup, order 10". */
  readonly slot: readonly string[];
  readonly subFlow: string | undefined;
  /** The item key of this node on the canvas (expand, collapse, enter). */
  readonly key: string | undefined;
  readonly expanded: boolean;
  readonly outcomes: readonly InfoOutcome[];
  readonly comesFrom: readonly {
    readonly from: NodeId;
    readonly outcome: string;
    readonly via: NodeId | undefined;
  }[];
  /** The node's file when the lookup is loaded. */
  readonly file: string | undefined;
};
