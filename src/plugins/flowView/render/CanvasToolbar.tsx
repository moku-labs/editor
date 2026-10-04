/**
 * @file flowView render module — the canvas toolbar (B5): Show where the game is (C), Follow the
 * game toggles (`aria-pressed`, M9), Reset layout is disabled while nothing visible is pinned
 * (M8), and Inspector reopens the closed Inspector panel.
 */
import type { VNode } from "preact";
import { useSidePanel } from "../../panels/shared/side-panel";
import { Icon } from "../../workspace/ui/icons";
import { INSPECTOR_PANEL } from "../keys";
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
 */
export function CanvasToolbar(props: CanvasToolbarProps): VNode {
  const { ctx, actions } = props;
  const [pinned, follow] = useFlowStore(ctx, state => [
    actions.layout.pinnedCount(),
    state.camera.follow
  ]);
  const inspector = useSidePanel(INSPECTOR_PANEL);
  const resetDisabled = pinned === 0;
  return (
    <div data-flow="canvas-toolbar" data-chrome="" role="toolbar" aria-label="Canvas">
      <button
        type="button"
        data-action="find-current"
        title="Show where the game is (C)"
        aria-label="Show where the game is"
        onClick={() => actions.focus.findCurrent()}
      >
        <Icon name="target" />
      </button>
      <button
        type="button"
        data-action="follow"
        aria-pressed={follow}
        onClick={() => actions.camera.follow()}
      >
        <Icon name="follow" />
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
        <Icon name="reset" />
        Reset layout
      </button>
      {inspector.closed && (
        <button
          type="button"
          data-action={`reopen-${INSPECTOR_PANEL}`}
          title="Show Inspector"
          onClick={inspector.show}
        >
          Inspector
        </button>
      )}
    </div>
  );
}
