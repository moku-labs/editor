/**
 * @file flowView render module — a flow frame (G sub-flow frame): the head "# board · sub-flow of
 * main/board · 10 nodes · on the stack" with Collapse and Enter, an accent border while on the
 * stack. The frame background is empty canvas for clicks (M2).
 */
import type { VNode } from "preact";
import type { FlowActions, FlowCtx, Item } from "../types";
import type { FrameView } from "./types";

/**
 * Props of `Frame`.
 */
export type FrameProps = {
  readonly ctx: FlowCtx;
  readonly actions: FlowActions;
  readonly item: Item;
  readonly view: FrameView;
};

/**
 * One frame.
 *
 * @param props - Context, actions, the frame item and its view.
 * @returns The frame.
 */
export function Frame(props: FrameProps): VNode {
  const { actions, item, view } = props;
  return (
    <div
      data-flow="frame"
      data-hit="frame"
      data-key={item.key}
      data-root={view.root ? "" : undefined}
      data-on-stack={view.onStack ? "" : undefined}
      data-dimmed={view.dimmed ? "" : undefined}
      style={{
        left: `${item.x}px`,
        top: `${item.y}px`,
        width: `${item.w}px`,
        height: `${item.h}px`
      }}
    >
      <div data-part="head" data-hit="frame-head" data-key={item.key}>
        <span data-part="title">{view.head}</span>
        {!view.root && (
          <>
            <button
              type="button"
              data-action="collapse"
              onClick={() => actions.flows.collapse(item.key)}
            >
              Collapse
            </button>
            <button type="button" data-action="enter" onClick={() => actions.flows.enter(item.key)}>
              Enter
            </button>
          </>
        )}
      </div>
    </div>
  );
}
