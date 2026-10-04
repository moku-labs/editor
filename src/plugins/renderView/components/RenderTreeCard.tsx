/**
 * @file renderView plugin — the render tree card (C9): head counts, Expand all and Collapse (one
 * group the header wraps onto its own line in a narrow column), the hover
 * hint (with "Show game" while the preview is hidden) and the keyboard-driven tree.
 */
import type { JSX } from "preact";
import { useState } from "preact/hooks";
import type { WorkspaceApi } from "../../workspace/types";
import { collapseAll, expandAll, moveInTree } from "../actions";
import { treeCounts } from "../derive";
import type { RenderViewCtx, TreeRow as TreeRowData } from "../types";
import { TreeRow } from "./TreeRow";

/**
 * Props of `RenderTreeCard`.
 */
export type RenderTreeCardProps = {
  readonly ctx: RenderViewCtx;
  readonly rows: readonly TreeRowData[];
  readonly workspace: WorkspaceApi;
};

/**
 * The render tree card.
 *
 * @param props - ctx, the visible rows and the workspace api.
 * @returns The card.
 */
export function RenderTreeCard(props: RenderTreeCardProps): JSX.Element {
  const { ctx, rows, workspace } = props;
  const { scene, tree } = ctx.state;
  const [detail, setDetail] = useState(true);
  const counts = treeCounts(scene);
  const hidden = !workspace.preview("render").visible;

  /**
   * ↑↓←→ Home End move through the rows; Enter toggles the detail. Keys on a button are its own.
   *
   * @param event - The key event on the tree.
   */
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.target instanceof HTMLElement && event.target.closest("button") !== null) return;
    if (event.key === "Enter") {
      setDetail(open => !open);
      event.preventDefault();
      return;
    }
    if (moveInTree(ctx, rows, event.key)) {
      setDetail(true);
      event.preventDefault();
    }
  };

  return (
    <section data-render="tree" data-card>
      <header>
        <h2>Render tree</h2>
        <span data-count>
          {counts.nodes} nodes · {counts.textures} with textures · {counts.entities} entities
        </span>
        <div data-actions>
          <button type="button" data-action="expand-all" onClick={() => expandAll(ctx)}>
            Expand all
          </button>
          <button type="button" data-action="collapse-all" onClick={() => collapseAll(ctx)}>
            Collapse
          </button>
        </div>
      </header>
      <p data-hint>
        Hover a row to find it in the game preview.
        {hidden ? (
          <>
            {" The preview is hidden here. "}
            <button
              type="button"
              data-action="show-game"
              onClick={() => workspace.setPreview("render", { visible: true })}
            >
              Show game
            </button>
          </>
        ) : undefined}
      </p>
      {scene === undefined ? (
        <p data-empty>Waiting for the scene · it is read while Render is shown.</p>
      ) : (
        <div role="tree" aria-label="Render tree" tabIndex={0} onKeyDown={onKeyDown}>
          {rows.map(row => (
            <TreeRow
              key={row.id}
              ctx={ctx}
              row={row}
              selected={row.id === tree.selected}
              detail={detail && row.id === tree.selected}
            />
          ))}
        </div>
      )}
    </section>
  );
}
