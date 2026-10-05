/**
 * @file Shared view module — definePanel: a panel is plain data, the host owns subscriptions.
 * Runtime-free (type-only imports, no runtime module), exported from "." (D-01). The one boundary
 * cast of panels (typed view → erased view) lives in `erase`, like registry's one cast in
 * checkInput (contracts §3).
 */
import type { Json } from "../../registry/protocol";
import type { WorkspaceId } from "../../workspace/types";
import type { PanelElement, PanelInput, PanelSpec, SourceRef } from "../types";

/**
 * A panel id: camelCase words joined by dots, one word allowed ("flow", "flow.inspector").
 */
const PANEL_ID = /^[a-z][\dA-Za-z]*(?:\.[a-z][\dA-Za-z]*)*$/;

/**
 * A source or command id: at least two camelCase words joined by dots ("game.position"), the
 * registry's ID_PATTERN (repeated here: define.ts imports no runtime module).
 */
const DOTTED_ID = /^[a-z][\dA-Za-z]*(?:\.[a-z][\dA-Za-z]*)+$/;

/**
 * The six workspaces (repeated from workspace/ids.ts: define.ts imports no runtime module).
 */
const WORKSPACES: ReadonlySet<string> = new Set<WorkspaceId>([
  "flow",
  "game",
  "render",
  "state",
  "files",
  "console"
]);

/**
 * The deepest nesting a tuple-ref input may have.
 */
const MAX_DEPTH = 32;

/**
 * An erased view: values by name, tools of any command map.
 */
type ErasedView<Tools> = (values: Readonly<Record<string, Json>>, tools: Tools) => PanelElement;

/**
 * The two-line startup error of one malformed field.
 *
 * @param what - What is invalid, e.g. `Panel "flow": workspace "nope"`.
 * @param fix - What to use instead.
 * @returns The error, ready to throw.
 * @example
 * ```ts
 * throw invalid('Panel "flow": view', "Pass a function (values, tools) => element");
 * ```
 */
function invalid(what: string, fix: string): Error {
  return new Error(`[moku-editor] ${what} is invalid.\n  ${fix}.`);
}

/**
 * True for an object that is neither null nor an array.
 *
 * @param value - Anything.
 * @returns Whether `value` is a plain record.
 * @example
 * ```ts
 * isRecord({ last: 20 }); // true
 * ```
 */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * True for a JSON value: null, a boolean, a finite number, a string, or arrays and plain objects
 * of those (no deeper than MAX_DEPTH).
 *
 * @param value - Anything.
 * @param depth - Current nesting.
 * @returns Whether `value` is Json.
 * @example
 * ```ts
 * isJsonValue({ last: 20 }, 0); // true
 * ```
 */
function isJsonValue(value: unknown, depth: number): boolean {
  if (value === null || typeof value === "boolean" || typeof value === "string") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (depth >= MAX_DEPTH) return false;
  if (Array.isArray(value)) return value.every(item => isJsonValue(item, depth + 1));
  if (isRecord(value)) return Object.values(value).every(item => isJsonValue(item, depth + 1));
  return false;
}

/**
 * True for a source ref: a dotted id, or a `[dotted id, Json]` pair.
 *
 * @param ref - A declared source.
 * @returns Whether it is well formed (narrows to SourceRef).
 * @example
 * ```ts
 * isSourceRef(["game.history", { last: 20 }]); // true
 * ```
 */
function isSourceRef(ref: unknown): ref is SourceRef {
  if (typeof ref === "string") return DOTTED_ID.test(ref);
  if (!Array.isArray(ref) || ref.length !== 2) return false;

  const [id, input]: readonly unknown[] = ref;
  return typeof id === "string" && DOTTED_ID.test(id) && isJsonValue(input, 0);
}

/**
 * A frozen copy of the sources (tuple pairs frozen too).
 *
 * @param label - `Panel "<id>"`, for the message.
 * @param sources - The declared sources.
 * @returns The frozen copy.
 * @throws {Error} When sources is not an object or a ref is malformed.
 * @example
 * ```ts
 * checkSources('Panel "flow"', { graph: "game.graph" });
 * ```
 */
function checkSources(label: string, sources: unknown): Readonly<Record<string, SourceRef>> {
  if (!isRecord(sources)) {
    throw invalid(`${label}: sources`, "Pass an object of name → source ref, or {}");
  }

  const copy: Record<string, SourceRef> = {};
  for (const [name, ref] of Object.entries(sources)) {
    if (!isSourceRef(ref)) {
      throw invalid(
        `${label}: source "${name}"`,
        'Use a dotted source id like "game.graph", or a pair like ["game.history", { "last": 20 }]'
      );
    }
    copy[name] = typeof ref === "string" ? ref : Object.freeze([ref[0], ref[1]] as const);
  }
  return Object.freeze(copy);
}

/**
 * A frozen copy of the commands; `{}` when absent.
 *
 * @param label - `Panel "<id>"`, for the message.
 * @param commands - The declared commands.
 * @returns The frozen copy.
 * @throws {Error} When commands is not an object or a command id is malformed.
 * @example
 * ```ts
 * checkCommands('Panel "flow"', { step: "game.step" });
 * ```
 */
function checkCommands(label: string, commands: unknown): Readonly<Record<string, string>> {
  if (commands === undefined) return Object.freeze({});
  if (!isRecord(commands)) {
    throw invalid(`${label}: commands`, "Pass an object of name → command id, or leave it out");
  }

  const copy: Record<string, string> = {};
  for (const [name, id] of Object.entries(commands)) {
    if (typeof id !== "string" || !DOTTED_ID.test(id)) {
      throw invalid(`${label}: command "${name}"`, 'Use a dotted command id like "game.step"');
    }
    copy[name] = id;
  }
  return Object.freeze(copy);
}

/**
 * The one boundary cast of panels: a view typed by its sources and commands becomes the erased
 * view the host calls with the values it received (contracts §3, 11-panels).
 *
 * @param view - The typed view.
 * @returns The same function, erased.
 * @example
 * ```ts
 * const erased = erase<PanelTools<Readonly<Record<string, string>>>>(input.view);
 * ```
 */
function erase<Tools>(view: (...args: never[]) => PanelElement): ErasedView<Tools> {
  return view as ErasedView<Tools>;
}

/**
 * Declares a panel: plain data, the host owns subscriptions. Types of `values` flow from the
 * source ids; `run` takes each command's input. Returns the frozen, erased PanelSpec.
 *
 * @param input - Id, title, workspace, sources, commands, view, optional compact view.
 * @returns The frozen, erased PanelSpec to pass to `panels.register`.
 * @throws {Error} When the id, workspace, a source ref or a command id is malformed.
 * @example
 * ```ts
 * export const statePanel = definePanel({
 *   id: "state", title: "State", workspace: "state",
 *   sources: { model: "game.model", position: "game.position", history: ["game.history", { last: 1 }] },
 *   view: (values, tools) => h(StateView, { values, tools })
 * });
 * ```
 */
export function definePanel<
  const S extends Readonly<Record<string, SourceRef>>,
  const C extends Readonly<Record<string, string>> = Readonly<Record<never, string>>
>(input: PanelInput<S, C>): PanelSpec {
  const { id, title, workspace, view, compact } = input;
  if (typeof id !== "string" || !PANEL_ID.test(id)) {
    throw invalid(
      `Panel id ${JSON.stringify(id)}`,
      'Use camelCase words joined by dots, like "flow" or "flow.inspector"'
    );
  }

  const label = `Panel "${id}"`;
  if (!WORKSPACES.has(workspace)) {
    throw invalid(
      `${label}: workspace "${String(workspace)}"`,
      "Use flow, game, render, state, files or console"
    );
  }
  const sources = checkSources(label, input.sources);
  const commands = checkCommands(label, input.commands);
  if (typeof view !== "function") {
    throw invalid(`${label}: view`, "Pass a function (values, tools) => element");
  }
  if (compact !== undefined && typeof compact !== "function") {
    throw invalid(
      `${label}: compact`,
      "Pass a function (values, tools) => element, or leave it out"
    );
  }

  return Object.freeze({
    id,
    title,
    workspace,
    sources,
    commands,
    view: erase<Parameters<PanelSpec["view"]>[1]>(view),
    compact:
      compact === undefined
        ? undefined
        : erase<Parameters<NonNullable<PanelSpec["compact"]>>[1]>(compact)
  });
}
