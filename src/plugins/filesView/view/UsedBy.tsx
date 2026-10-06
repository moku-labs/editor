/**
 * @file filesView plugin — the Used by row, from the project index (no game needed): flow chips
 * ("flow board", teal) and node chips ("board/merge") of what the file defines, and a "Used in"
 * row of file chips. A flow or node chip emits the global `workspace:select-node` (R4) — flowView
 * shows Flow and focuses the node; a file chip opens the file. An index that is off shows its
 * reason. Hidden under `.moku/`.
 */
import type { VNode } from "preact";
import { linkPlugin } from "../../link";
import { projectOffText } from "../../panels/shared/project";
import type { NodeRef } from "../../registry/protocol";
import { flowStartOf } from "../links/used-by";
import { openOrLog } from "../tabs/open";
import type { FilesViewApi, FilesViewCtx, OpenTab } from "../types";

/**
 * Props of `UsedBy`.
 */
export type UsedByProps = {
  readonly ctx: FilesViewCtx;
  readonly api: FilesViewApi;
  readonly tab: OpenTab;
};

/**
 * Props of the chips row.
 */
type ChipsProps = {
  readonly ctx: FilesViewCtx;
  readonly flows: readonly string[];
  readonly nodes: readonly NodeRef[];
};

/**
 * A one-line Used by: why there are no chips.
 *
 * @param props - The text.
 * @param props.text - What follows "Used by · ".
 * @returns The row.
 */
function UsedByLine(props: { readonly text: string }): VNode {
  return (
    <div data-part="used-by">
      <p data-muted>Used by · {props.text}</p>
    </div>
  );
}

/**
 * The "Used by" row: flow chips select the flow's start node (from the game's graph when it is
 * linked, else the flow), node chips select the node.
 *
 * @param props - Context, flows and nodes.
 * @returns The row.
 */
function DefinedChips(props: ChipsProps): VNode {
  const { ctx, flows, nodes } = props;

  /**
   * Asks flowView to focus a node or a flow.
   *
   * @param id - `"<flow>/<node>"` or a flow name.
   */
  const select = (id: string): void => {
    ctx.emit("workspace:select-node", { id });
  };

  /**
   * Selects a flow at its start node when the graph names one.
   *
   * @param flow - The flow name.
   */
  const selectFlow = (flow: string): void => {
    const start = flowStartOf(ctx.state.graph, flow);
    select(start === undefined ? flow : `${flow}/${start}`);
  };

  return (
    <div data-row="used-by">
      <span data-label>Used by</span>
      {flows.map(flow => (
        <button
          key={`flow:${flow}`}
          type="button"
          data-chip
          data-kind="flow"
          onClick={() => selectFlow(flow)}
        >
          flow {flow}
        </button>
      ))}
      {nodes.map(ref => (
        <button
          key={`${ref.flow}/${ref.node}`}
          type="button"
          data-chip
          data-kind="node"
          onClick={() => select(`${ref.flow}/${ref.node}`)}
        >
          {ref.flow}/{ref.node}
        </button>
      ))}
    </div>
  );
}

/**
 * The "Used in" row: a chip per file that uses what this file defines; a click opens the file.
 *
 * @param props - Context and the files.
 * @param props.ctx - Domain context of filesView.
 * @param props.paths - The using files.
 * @returns The row.
 */
function UsedInChips(props: {
  readonly ctx: FilesViewCtx;
  readonly paths: readonly string[];
}): VNode {
  const { ctx, paths } = props;
  return (
    <div data-row="used-in">
      <span data-label>Used in</span>
      {paths.map(path => (
        <button
          key={path}
          type="button"
          data-chip
          data-kind="file"
          onClick={() => openOrLog(ctx, path, {})}
        >
          {path}
        </button>
      ))}
    </div>
  );
}

/**
 * The Used by row of the active file.
 *
 * @param props - Context, api and the tab.
 * @returns The row, or nothing for files under `.moku/`.
 */
export function UsedBy(props: UsedByProps): VNode | undefined {
  const { ctx, api, tab } = props;
  if (tab.path.startsWith(".moku/")) return undefined;

  const offText = projectOffText(ctx.require(linkPlugin).project());
  if (offText !== undefined) return <UsedByLine text={offText} />;

  const { flows, nodes, usedIn } = api.usedBy(tab.path);
  const defines = flows.length > 0 || nodes.length > 0;
  if (!defines && usedIn.length === 0) return <UsedByLine text="no node, flow or file" />;

  return (
    <div data-part="used-by">
      {defines && <DefinedChips ctx={ctx} flows={flows} nodes={nodes} />}
      {usedIn.length > 0 && <UsedInChips ctx={ctx} paths={usedIn} />}
    </div>
  );
}
