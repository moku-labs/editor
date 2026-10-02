/**
 * @file flowView plugin — the Flow panel (definePanel data, registered in onInit) and the
 * FlowWorkspace root component (composition only).
 */
import type { VNode } from "preact";
import type { PanelSpec, PanelTools } from "../panels/types";
import type { FlowCommands, FlowCtx, FlowValues } from "./types";

/**
 * Props of the Flow workspace root.
 */
export type FlowWorkspaceProps = {
  readonly ctx: FlowCtx;
  readonly values: FlowValues;
  readonly tools: PanelTools<FlowCommands>;
};

/**
 * The Flow panel: sources game.graph, game.position, game.history {last}; commands step, pause,
 * resume.
 *
 * @param _ctx - Domain context of flowView.
 * @example
 * ```ts
 * ctx.require(panelsPlugin).register(createFlowPanel(ctx));
 * ```
 */
export function createFlowPanel(_ctx: FlowCtx): PanelSpec {
  throw new Error("not implemented");
}

/**
 * The Flow workspace root: canvas, Inspector, strip and history, composed from the modules.
 *
 * @param _props - Plugin context, panel values and panel tools.
 * @example
 * ```tsx
 * <FlowWorkspace ctx={ctx} values={values} tools={tools} />
 * ```
 */
export function FlowWorkspace(_props: FlowWorkspaceProps): VNode {
  throw new Error("not implemented");
}
