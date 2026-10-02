/**
 * @file flowView inspector module — types: tabs, the code and styles slices, the node → file
 * lookup, the inspector's internal api. Style edit types come from panels/shared/style-edit.
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
  styles: StylesState | undefined;
  sources: SourceLookup | undefined;
};

/**
 * The inspector's internal api (used by the components and the palette items).
 */
export type InspectorApi = {
  setTab(tab: InspectorTab): void;
  openCode(id: NodeId): Promise<void>;
  saveCode(): Promise<void>;
  openStyles(key?: string): Promise<void>;
  stepStyle(path: string, direction: 1 | -1, big: boolean): void;
};
