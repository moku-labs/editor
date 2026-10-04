/**
 * @file flowView render module — the breadcrumb (B8): `main › board`, every segment leaves the
 * entered flows up to its level (M1), the last one bold; then "Stack main/board › board/awaitIntent"
 * as a link that selects the current node; it ends with the current node chip (a click shows
 * where the game is).
 */
import type { VNode } from "preact";
import { Icon } from "../../workspace/ui/icons";
import type { FlowActions, FlowCtx } from "../types";
import { useFlowStore } from "../useFlowStore";

/**
 * Props of `Breadcrumb`.
 */
export type BreadcrumbProps = { readonly ctx: FlowCtx; readonly actions: FlowActions };

/**
 * The breadcrumb.
 *
 * @param props - Context and actions.
 * @returns The navigation.
 */
export function Breadcrumb(props: BreadcrumbProps): VNode {
  const { ctx, actions } = props;
  const segments = useFlowStore(ctx, state => [
    state.data.graph?.main ?? "main",
    ...state.layout.enter.map(entry => entry.flow)
  ]);
  const stack = useFlowStore(ctx, () =>
    actions.focus
      .stack()
      .map(entry => entry.id)
      .join(" › ")
  );
  const current = useFlowStore(ctx, () => actions.focus.current());
  return (
    <nav data-flow="breadcrumb" data-chrome="" aria-label="Flows">
      {segments.map((segment, depth) => (
        <span key={`${depth}:${segment}`} data-part="crumb">
          {depth > 0 && (
            <span data-part="separator" aria-hidden="true">
              ›
            </span>
          )}
          <button
            type="button"
            data-part="segment"
            data-current={depth === segments.length - 1 ? "" : undefined}
            onClick={() => actions.flows.up(depth)}
          >
            {segment}
          </button>
        </span>
      ))}
      {stack !== "" && (
        <button
          type="button"
          data-part="stack"
          onClick={() => actions.focus.select(actions.focus.current())}
        >
          {`Stack ${stack}`}
        </button>
      )}
      {current !== undefined && (
        <button
          type="button"
          data-part="current"
          data-action="find-current"
          title="Show where the game is (C)"
          onClick={() => actions.focus.findCurrent()}
        >
          <Icon name="target" />
          {current.slice(current.indexOf("/") + 1)}
        </button>
      )}
    </nav>
  );
}
