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
import { INSPECTOR_PANEL } from "./keys";
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
 * The Inspector width until the person resizes it, when `--inspector-w` cannot be read.
 */
const INSPECTOR_W = 320;

/**
 * The Inspector width for the Code and Styles tabs, until the person resizes it.
 */
const INSPECTOR_WIDE = 400;

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
 * The Inspector's default width: the `--inspector-w` token (it follows the window), 400 px for
 * the Code and Styles tabs. The person's own width, once resized, wins over both (SidePanel).
 *
 * @param wide - Whether the Code or Styles tab shows.
 * @returns The width in px.
 */
function inspectorWidth(wide: boolean): number {
  if (wide) return INSPECTOR_WIDE;
  const root = globalThis.document?.documentElement;
  const token = root === undefined ? "" : getComputedStyle(root).getPropertyValue("--inspector-w");
  const width = Number.parseFloat(token);
  return Number.isFinite(width) && width > 0 ? width : INSPECTOR_W;
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
    const canvas = root.current?.querySelector<HTMLElement>('[data-flow="canvas"]');
    if (canvas === undefined || canvas === null) return;
    return tools.workspace.previewZone("flow", canvas, () => {
      const { width, height } = canvas.getBoundingClientRect();
      return actions.camera.previewZone({ w: width, h: height });
    });
  }, [actions, tools, root, empty]);

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
        defaultWidth={inspectorWidth(tab === "code" || tab === "styles")}
        minWidth={220}
        maxWidth={560}
        overlayBelow={600}
      >
        <Inspector ctx={ctx} actions={actions} shown={shown} info={info} />
      </SidePanel>
      {!empty && <HistoryStrip ctx={ctx} actions={actions} rows={rows} />}
      <ContextMenu ctx={ctx} actions={actions} />
    </div>
  );
}
