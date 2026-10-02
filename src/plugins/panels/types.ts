/**
 * @file panels plugin — type definitions: the definePanel input and its erased form, panel values
 * and tools, config, state, api, the domain context and the hooks.
 */
import type { Log } from "@moku-labs/common/browser";
import type { EmitFn } from "@moku-labs/core";
import type { VNode } from "preact";
import type { Require, ToolsEvents } from "../../config";
import type { FilesClient } from "../link/types";
import type { EditorChannel, Json, LinkStatus, Manifest, RunResult } from "../registry/protocol";
import type { WorkspaceApi, WorkspaceId } from "../workspace/types";
import type { CommandArgs, SourceValue } from "./catalogue";

/**
 * A panel source: an id, or an id with its input.
 */
export type SourceRef = string | readonly [id: string, input: Json];

/**
 * The source id of a source ref.
 */
export type RefId<R> = R extends string
  ? R
  : R extends readonly [infer Id extends string, unknown]
    ? Id
    : string;

/**
 * The values a panel view gets, typed from its source ids.
 */
export type PanelValues<S> = { readonly [K in keyof S]: SourceValue<RefId<S[K]>> };

/**
 * What a panel view gets next to its values. Each `run` call emits `workspace:ran` (origin panel).
 */
export type PanelTools<C> = {
  run: { readonly [K in keyof C]: (...input: CommandArgs<C[K]>) => Promise<RunResult> };
  /** Snapshot at this render; the view re-renders on change. */
  status: LinkStatus;
  /** link's remote channel, for ad hoc reads. */
  channel: EditorChannel;
  /** link.files (R4). */
  files: FilesClient;
  workspace: WorkspaceApi;
};

/**
 * What the in-game overlay host could give a compact view later.
 */
export type CompactTools<C> = Pick<PanelTools<C>, "run" | "status" | "channel">;

/**
 * The input of definePanel.
 *
 * @example
 * ```ts
 * const input: PanelInput<{ position: "game.position" }, {}> = { id: "state", title: "State", workspace: "state", sources: { position: "game.position" }, view };
 * ```
 */
export type PanelInput<
  S extends Readonly<Record<string, SourceRef>>,
  C extends Readonly<Record<string, string>>
> = {
  /** /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)*$/, e.g. "flow.inspector". */
  readonly id: string;
  readonly title: string;
  readonly workspace: WorkspaceId;
  readonly sources: S;
  readonly commands?: C;
  readonly view: (values: PanelValues<S>, tools: PanelTools<C>) => VNode;
  readonly compact?: (values: PanelValues<S>, tools: CompactTools<C>) => VNode;
};

/**
 * The registered, closure-erased panel.
 */
export type PanelSpec = {
  readonly id: string;
  readonly title: string;
  readonly workspace: WorkspaceId;
  readonly sources: Readonly<Record<string, SourceRef>>;
  readonly commands: Readonly<Record<string, string>>;
  readonly view: (
    values: Readonly<Record<string, Json>>,
    tools: PanelTools<Readonly<Record<string, string>>>
  ) => VNode;
  readonly compact:
    | ((
        values: Readonly<Record<string, Json>>,
        tools: CompactTools<Readonly<Record<string, string>>>
      ) => VNode)
    | undefined;
};

/**
 * Panels configuration: empty (contracts §5).
 */
export type PanelsConfig = Record<string, never>;

/**
 * Where a run made outside the top bar started.
 */
export type PanelRunOrigin = "panel" | "key" | "palette";

/**
 * The controller of one mounted panel (mount.ts).
 */
export type MountedPanel = {
  readonly spec: PanelSpec;
  readonly section: HTMLElement;
  values: Record<string, Json>;
  received: Set<string>;
  fresh: Set<string>;
  unwatch: Map<string, () => void>;
  missing: string[];
  scheduled: boolean;
  setStatus(status: LinkStatus): void;
  recheck(manifest: Manifest | undefined): void;
  unmount(): void;
};

/**
 * The panels mounted into one workspace host.
 */
export type MountedWorkspace = { element: HTMLElement; panels: Map<string, MountedPanel> };

/**
 * Panels state.
 */
export type PanelsState = {
  panels: PanelSpec[];
  ids: Set<string>;
  mounted: Map<WorkspaceId, MountedWorkspace>;
  status: LinkStatus;
  started: boolean;
  cleanup: (() => void)[];
};

/**
 * The panels api (`app.panels`, `ctx.require(panelsPlugin)`).
 *
 * @example
 * ```ts
 * panels.register(flowPanel);
 * await panels.run("game.step", { frames: 1 });
 * ```
 */
export type PanelsApi = {
  /** Registers a panel built with definePanel; throws on a duplicate id. */
  register(panel: PanelSpec): void;
  /** Runs a command outside any render: link.run, then workspace:ran with the origin (R9). */
  run(id: string, input?: Json, origin?: PanelRunOrigin): Promise<RunResult>;
  /** Every registered panel, in registration order. */
  list(): readonly PanelSpec[];
  /** Mounts every panel of a workspace into an element; returns the unmount function. */
  mountInto(ws: WorkspaceId, element: HTMLElement): () => void;
};

/**
 * Domain context of panels: the kernel context is assignable to it.
 */
export type PanelsCtx = {
  readonly config: Readonly<PanelsConfig>;
  state: PanelsState;
  readonly emit: EmitFn<Pick<ToolsEvents, "workspace:ran">>;
  readonly log: Log.LogApi;
  readonly require: Require;
};

/**
 * The panels' hooks.
 */
export type PanelsHooks = {
  readonly "link:status": (payload: ToolsEvents["link:status"]) => void;
  readonly "workspace:changed": (payload: ToolsEvents["workspace:changed"]) => void;
};
