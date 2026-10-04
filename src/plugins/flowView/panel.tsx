/**
 * @file flowView plugin — the Flow panel (definePanel data, registered in onInit; no sources: the
 * flow values come from flowView's session watches) and the FlowWorkspace root component
 * (composition only).
 */
import type { VNode } from "preact";
import { useEffect, useLayoutEffect } from "preact/hooks";
import { definePanel } from "../panels/define";
import { SidePanel } from "../panels/shared/side-panel";
import type { PanelSpec, PanelTools } from "../panels/types";
import { actionsOf } from "./actions";
import { Minimap } from "./camera/Minimap";
import { ZoomBar } from "./camera/ZoomBar";
import { Inspector } from "./inspector/Inspector";
import { INSPECTOR_MAX_W, INSPECTOR_MIN_W, inspectorWidth } from "./inspector/size";
import { INSPECTOR_PANEL } from "./keys";
import { followPreviewZone } from "./preview-zone";
import { Breadcrumb } from "./render/Breadcrumb";
import { Canvas } from "./render/Canvas";
import { CanvasToolbar } from "./render/CanvasToolbar";
import { ContextMenu } from "./render/ContextMenu";
import { HistoryLabels, HistoryStrip } from "./render/HistoryStrip";
import { Offscreen } from "./render/Offscreen";
import { YouAreHere } from "./render/YouAreHere";
import type { FlowCommands, FlowCtx } from "./types";
import { useElement, useFlowStore } from "./useFlowStore";
import { historyView, infoView, trailEdges, worldView } from "./view-model";

/**
 * Props of the Flow workspace root.
 */
export type FlowWorkspaceProps = {
  readonly ctx: FlowCtx;
  readonly tools: PanelTools<FlowCommands>;
};

/**
 * The Flow panel: no sources (flowView watches game.graph, game.position and game.history for the
 * whole session, watch.ts); commands step, pause, resume (flowView runs them through panels.run,
 * R9).
 *
 * @param ctx - Domain context of flowView.
 * @returns The PanelSpec.
 */
export function createFlowPanel(ctx: FlowCtx): PanelSpec {
  return definePanel({
    id: "flow",
    title: "Flow",
    workspace: "flow",
    sources: {},
    commands: { step: "game.step", pause: "game.pause", resume: "game.resume" },
    /**
     * Renders the Flow workspace with the panel's tools.
     *
     * @param _values - None: the panel declares no sources.
     * @param tools - run, status, channel, files, workspace.
     * @returns The workspace element.
     */
    view: (_values, tools) => <FlowWorkspace ctx={ctx} tools={tools} />
  });
}

/**
 * The Flow workspace root: composes the canvas (world and chrome), the Inspector in its side
 * panel, the history strip and the context menu from the state the session watches fill, passing
 * the view data by props. With the link empty it renders no world, no minimap, no "You are here"
 * and no history dots (M4): the host shows its empty card.
 *
 * @param props - Plugin context and panel tools.
 * @returns The workspace.
 */
export function FlowWorkspace(props: FlowWorkspaceProps): VNode {
  const { ctx, tools } = props;
  const actions = actionsOf(ctx);
  const root = useElement<HTMLDivElement>();
  useFlowStore(ctx, state => state.view.revision);

  useLayoutEffect(() => {
    ctx.state.view.root = root.current;
    actions.camera.apply();
    return () => {
      if (ctx.state.view.root === root.current) ctx.state.view.root = undefined;
    };
  }, [ctx, actions, root]);

  const empty = ctx.state.data.status.kind === "empty";
  useEffect(() => {
    const workspace = root.current;
    const canvas = workspace?.querySelector<HTMLElement>('[data-flow="canvas"]') ?? undefined;
    if (workspace === undefined || canvas === undefined) return;
    return followPreviewZone(ctx, actions, tools.workspace, { root: workspace, canvas });
  }, [ctx, actions, tools, root, empty]);

  const world = empty ? undefined : worldView(ctx, actions);
  const rows = historyView(ctx);
  const selected =
    ctx.state.focus.selected === undefined
      ? undefined
      : ctx.state.layout.result?.byKey[ctx.state.focus.selected];
  const shown =
    selected !== undefined &&
    (selected.kind === "node" || selected.kind === "hub" || selected.kind === "frame")
      ? selected.id
      : actions.focus.current();
  const info = shown === undefined ? undefined : infoView(ctx, actions, shown);
  const tab = ctx.state.inspector.tab;

  return (
    <div data-flow="workspace" ref={root.ref} data-empty={empty ? "" : undefined}>
      {!empty && (
        <Canvas ctx={ctx} actions={actions} world={world}>
          <Breadcrumb ctx={ctx} actions={actions} />
          <CanvasToolbar ctx={ctx} actions={actions} />
          <YouAreHere ctx={ctx} actions={actions} />
          <Offscreen ctx={ctx} actions={actions} />
          <HistoryLabels ctx={ctx} actions={actions} rows={rows} />
          <ZoomBar ctx={ctx} actions={actions} />
          <Minimap ctx={ctx} actions={actions} trail={trailEdges(world)} />
        </Canvas>
      )}
      <SidePanel
        id={INSPECTOR_PANEL}
        side="end"
        title="Inspector"
        defaultWidth={inspectorWidth(tab)}
        minWidth={INSPECTOR_MIN_W}
        maxWidth={INSPECTOR_MAX_W}
        overlayBelow={600}
      >
        <Inspector ctx={ctx} actions={actions} shown={shown} info={info} />
      </SidePanel>
      {!empty && <HistoryStrip ctx={ctx} actions={actions} rows={rows} />}
      <ContextMenu ctx={ctx} actions={actions} />
    </div>
  );
}
