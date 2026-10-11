/**
 * @file flowView inspector module — types: tabs, the code slice, the inspector actions, the Info
 * view. Code locations come from the project index only.
 */
import type { ToolsEvents } from "../../../config";
import type { NodeId } from "../types";

/**
 * An Inspector tab.
 */
export type InspectorTab = "info" | "code";

/**
 * The status line of a save.
 */
export type SaveResult = { readonly ok: boolean; readonly text: string };

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
 * Inspector module state.
 */
export type InspectorState = {
  tab: InspectorTab;
  code: CodeState | undefined;
  /** The placeholder the Code tab shows instead of code ("Source loads from the dev server." …). */
  codeNote: string | undefined;
  /** The node the Code tab was last asked for; link:project reads it again. */
  codeNode: NodeId | undefined;
};

/**
 * The inspector actions (used by the components, the palette items and the hooks).
 */
export type InspectorActions = {
  /** Switches the tab; Code reads the shown node's file. */
  setTab(tab: InspectorTab): void;
  /**
   * Reads the node's file at the line the project index gives into the Code tab; a newer request
   * drops the result of an older one.
   */
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
  /**
   * The file and line of a node from the project index (line 1 when the file cannot be read), or
   * undefined when the index is off or does not know the node.
   */
  fileOf(id: NodeId): Promise<{ readonly path: string; readonly line: number } | undefined>;
  /** "Open in Files": emits workspace:open-file (R4). */
  openInFiles(path: string, line?: number): void;
  /** "Open in editor" link from link.boot() (D-08), undefined without boot. */
  editorUrl(path: string, line?: number): string | undefined;
  /**
   * The link:project hook: the Code tab reads its node again when the change touches its file (no
   * draft).
   */
  followProject(change: ToolsEvents["link:project"]): void;
};

/**
 * One outcome row of the Info tab.
 */
export type InfoOutcome = {
  readonly outcome: string;
  /** The instance edge on the canvas (`focus.followEdge`); undefined when it is not drawn. */
  readonly edgeKey: string | undefined;
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
 * One Comes from row of the Info tab.
 */
export type InfoSource = {
  readonly from: NodeId;
  readonly outcome: string;
  readonly via: NodeId | undefined;
  /** The instance edge on the canvas (`focus.followEdge`); undefined when it is not drawn. */
  readonly edgeKey: string | undefined;
  /** The instance of the source on the canvas; undefined with the edge. */
  readonly sourceKey: string | undefined;
  /** Frame label of the edge's last fire. */
  readonly frame: string | undefined;
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
  readonly comesFrom: readonly InfoSource[];
  /** The file that defines the node in the project index; undefined when off or unknown. */
  readonly file: string | undefined;
};
