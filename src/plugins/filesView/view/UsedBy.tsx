/**
 * @file filesView plugin — the Used by row: flow chips ("flow board", teal) and node chips
 * ("board/merge"); a click emits the global `workspace:select-node` (R4) — flowView shows Flow
 * and focuses the node; filesView shows no workspace itself. Hidden under `.moku/`.
 */
import type { VNode } from "preact";
import type { LinkStatus } from "../../registry/protocol";
import { flowStartOf } from "../links/used-by";
import type { FilesViewApi, FilesViewCtx, OpenTab } from "../types";

/**
 * Props of `UsedBy`.
 */
export type UsedByProps = {
  readonly ctx: FilesViewCtx;
  readonly api: FilesViewApi;
  readonly tab: OpenTab;
  readonly status: LinkStatus;
};

/**
 * The Used by row of the active file.
 *
 * @param props - Context, api, the tab and the link status.
 * @returns The row, or nothing for files under `.moku/`.
 */
export function UsedBy(props: UsedByProps): VNode | undefined {
  const { ctx, api, tab, status } = props;
  if (tab.path.startsWith(".moku/")) return undefined;

  const { graph } = ctx.state;
  if (graph === undefined || status.kind === "empty") {
    return (
      <div data-part="used-by">
        <p data-muted>Used by · connect a game to see nodes</p>
      </div>
    );
  }

  const { flows, nodes } = api.usedBy(tab.path);
  if (flows.length === 0 && nodes.length === 0) {
    return (
      <div data-part="used-by">
        <p data-muted>Used by · no node or flow</p>
      </div>
    );
  }

  /**
   * Asks flowView to focus a node.
   *
   * @param id - `"<flow>/<node>"`.
   */
  const select = (id: string): void => {
    ctx.emit("workspace:select-node", { id });
  };

  return (
    <div data-part="used-by">
      <span data-label>Used by</span>
      {flows.map(flow => {
        const start = flowStartOf(graph, flow);
        return (
          <button
            key={`flow:${flow}`}
            type="button"
            data-chip
            data-kind="flow"
            onClick={() => select(start === undefined ? flow : `${flow}/${start}`)}
          >
            flow {flow}
          </button>
        );
      })}
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
