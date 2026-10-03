/**
 * @file flowView render module — the canvas toolbar (B5): Note (N) opens the note editor for a
 * free note at the viewport centre, Follow the game toggles (`aria-pressed`, M9), Reset layout is
 * disabled while nothing visible is pinned (M8).
 */
import type { VNode } from "preact";
import type { FlowActions, FlowCtx } from "../types";
import { useFlowStore } from "../useFlowStore";

/**
 * Props of `CanvasToolbar`.
 */
export type CanvasToolbarProps = { readonly ctx: FlowCtx; readonly actions: FlowActions };

/**
 * The canvas toolbar.
 *
 * @param props - Context and actions.
 * @returns The toolbar.
 * @example
 * ```tsx
 * <CanvasToolbar ctx={ctx} actions={actions} />
 * ```
 */
export function CanvasToolbar(props: CanvasToolbarProps): VNode {
  const { ctx, actions } = props;
  const [pinned, follow] = useFlowStore(ctx, state => [
    actions.layout.pinnedCount(),
    state.camera.follow
  ]);
  const resetDisabled = pinned === 0;
  return (
    <div data-flow="canvas-toolbar" data-chrome="" role="toolbar" aria-label="Canvas">
      <button
        type="button"
        data-action="note"
        title="Note (N)"
        onClick={() => {
          const { cam, viewport } = ctx.state.camera;
          actions.notes.edit({
            anchor: { x: (viewport.w / 2 - cam.x) / cam.z, y: (viewport.h / 2 - cam.y) / cam.z }
          });
        }}
      >
        Note
      </button>
      <button
        type="button"
        data-action="follow"
        aria-pressed={follow}
        onClick={() => actions.camera.follow()}
      >
        Follow the game
      </button>
      <button
        type="button"
        data-action="reset"
        aria-disabled={resetDisabled ? "true" : "false"}
        title={resetDisabled ? "Nothing is pinned in the visible flows" : "Reset layout"}
        onClick={() => {
          if (resetDisabled) return;
          actions.layout.reset().catch((error: unknown) => {
            ctx.log.warn("flowView: reset layout failed", { message: String(error) });
          });
        }}
      >
        Reset layout
      </button>
    </div>
  );
}
