/**
 * @file panels plugin — definePanel: a panel is plain data, the host owns subscriptions.
 * Runtime-free (type-only imports), exported from "." (D-01). The one boundary cast of panels
 * (typed view → erased view) lands here in wave 4.
 */
import type { PanelInput, PanelSpec, SourceRef } from "./types";

/**
 * Declares a panel. Types of `values` flow from the source ids; `run` takes each command's
 * input. Returns the frozen, erased PanelSpec.
 *
 * @param _input - Id, title, workspace, sources, commands, view, optional compact view.
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
>(_input: PanelInput<S, C>): PanelSpec {
  throw new Error("not implemented");
}
